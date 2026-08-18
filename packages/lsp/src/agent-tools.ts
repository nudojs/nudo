/**
 * Agent-facing tool implementations (`nudo.whatIf` / `nudo.suggestCase` /
 * `nudo.trace`), ported from the MCP server (packages/mcp/src/tools.ts) and
 * wired into both LSP channels in server.ts: executeCommand commands
 * (`nudo.*`) and custom requests (`nudo/…`). Like validation.ts, this module
 * holds pure logic with injected readers so tests exercise it without a live
 * connection; server.ts supplies the document/disk readers.
 *
 * Unlike the MCP original, whatIf really applies its bindings: each binding
 * becomes a `// @nudo:as <type>` comment inserted above the declaring
 * statement (source-level injection). The evaluator already honors `as` for
 * variable declarations, expression statements and returns, so the assumed
 * type flows through the whole program like any other directive.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeFile, buildCaseDirective } from "@nudojs/service";
import { parse } from "@nudojs/parser";
import { T, typeValueToString } from "@nudojs/core";
import type { TypeValue } from "@nudojs/core";

export type TypeBinding = { name: string; type: string };

/** MCP-compatible tool result shape — keeps bridge layers zero-rewrite. */
export type AgentToolResult = { content: [{ type: "text"; text: string }] };

export type AgentToolDeps = {
  /** Disk reader for files not open in the editor; defaults to readFileSync. */
  readFile?: (filePath: string) => string;
  /** Open-document lookup by absolute file path; the editor buffer wins over disk. */
  getOpenText?: (filePath: string) => { text: string } | undefined;
};

export function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Parse an agent-facing type expression into a TypeValue.
 * Ported from packages/mcp/src/tools.ts: primitive names, `|` unions,
 * everything else unknown.
 */
export function parseTypeExpr(expr: string): TypeValue {
  const trimmed = expr.trim();
  if (trimmed === "number") return T.number;
  if (trimmed === "string") return T.string;
  if (trimmed === "boolean") return T.boolean;
  if (trimmed === "null") return T.null;
  if (trimmed === "undefined") return T.undefined;
  if (trimmed === "bigint") return T.bigint;
  if (trimmed === "symbol") return T.symbol;
  if (trimmed.includes("|")) {
    const members = trimmed.split("|").map(parseTypeExpr);
    return T.union(...members);
  }
  return T.unknown;
}

/**
 * Normalize a `file` parameter: strips and percent-decodes a `file://` prefix
 * (mirrors validation.ts uriToFilePath), then resolves to an absolute path.
 */
export function normalizeFilePath(file: string): string {
  const path = file.startsWith("file://") ? decodeURIComponent(file.slice(7)) : file;
  return resolve(path);
}

const BARE_PRIMITIVES = new Set(["number", "string", "boolean", "bigint", "symbol"]);

/** Split a type expression on top-level `|`, respecting nesting and strings. */
function splitTopLevelUnion(expr: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inString) {
      if (ch === inString && expr[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      continue;
    }
    if (ch === "|" && depth === 0) {
      members.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  members.push(expr.slice(start));
  return members.map((m) => m.trim()).filter(Boolean);
}

/**
 * Translate an agent-facing type expression into `@nudo:as` directive syntax
 * (parser's parseTypeValueExpr language). Bare primitives gain a `T.` prefix;
 * unions become `T.union(...)`; structural forms pass through untouched.
 */
export function typeExprToDirective(expr: string): string {
  const members = splitTopLevelUnion(expr);
  if (members.length === 0) return "T.unknown";
  const mapped = members.map((m) => {
    if (m.startsWith("T.")) return m;
    if (BARE_PRIMITIVES.has(m)) return `T.${m}`;
    if (m === "null" || m === "undefined" || m === "true" || m === "false") return m;
    if (/^-?\d+(\.\d+)?$/.test(m)) return m;
    if (/^["']/.test(m)) return m;
    if (/[([{]|=>/.test(m)) return m;
    return "T.unknown";
  });
  return mapped.length === 1 ? mapped[0] : `T.union(${mapped.join(", ")})`;
}

/** Collect the names a top-level statement declares (descends into exports). */
function declaredNames(stmt: any, out: Set<string>): void {
  if (stmt.type === "FunctionDeclaration" && stmt.id) {
    out.add(stmt.id.name);
  } else if (stmt.type === "ClassDeclaration" && stmt.id) {
    out.add(stmt.id.name);
  } else if (stmt.type === "VariableDeclaration") {
    for (const decl of stmt.declarations) {
      if (decl.id?.type === "Identifier") out.add(decl.id.name);
    }
  } else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
    declaredNames(stmt.declaration, out);
  }
}

/**
 * Inject each binding as a `// @nudo:as <type>` line above the statement that
 * declares its name. The comment is placed above any existing leading
 * comments, so the assumption takes priority over source-level directives
 * (only the first `as` on a statement wins — hence one binding per statement;
 * siblings of multi-declarator statements share the override, a known
 * limitation of statement-granular `as`).
 */
export function injectBindings(
  source: string,
  bindings: TypeBinding[],
): { source: string; applied: string[]; unapplied: string[] } {
  const applied: string[] = [];
  const unapplied: string[] = [];
  if (bindings.length === 0) return { source, applied, unapplied };

  const ast = parse(source);
  const declLines = new Map<string, number>();
  for (const stmt of ast.program.body as any[]) {
    const names = new Set<string>();
    declaredNames(stmt, names);
    if (names.size === 0 || !stmt.loc) continue;
    // anchor above existing leading comments so the injected `as` wins
    const anchorLine = stmt.leadingComments?.[0]?.loc?.start.line ?? stmt.loc.start.line;
    for (const name of names) {
      if (!declLines.has(name)) declLines.set(name, anchorLine);
    }
  }

  const byLine = new Map<number, TypeBinding[]>();
  for (const binding of bindings) {
    const line = declLines.get(binding.name);
    if (line === undefined) {
      unapplied.push(binding.name);
      continue;
    }
    const group = byLine.get(line) ?? [];
    group.push(binding);
    byLine.set(line, group);
  }

  const insertions: Array<{ index: number; text: string }> = [];
  for (const [line, group] of byLine) {
    insertions.push({
      index: line - 1,
      text: `// @nudo:as ${typeExprToDirective(group[0].type)}`,
    });
    applied.push(`${group[0].name}: ${group[0].type}`);
    for (const shadowed of group.slice(1)) unapplied.push(shadowed.name);
  }
  // bottom-up so earlier indices stay valid
  insertions.sort((a, b) => b.index - a.index);
  const lines = source.split("\n");
  for (const ins of insertions) lines.splice(ins.index, 0, ins.text);

  return { source: lines.join("\n"), applied, unapplied };
}

/**
 * Source resolution for agent tools: open editor buffer first, disk fallback
 * (readFileSync) for files the agent changed without didOpen.
 */
export function readSource(filePath: string, deps: AgentToolDeps = {}): string {
  const open = deps.getOpenText?.(filePath);
  if (open) return open.text;
  return (deps.readFile ?? ((p: string) => readFileSync(p, "utf-8")))(filePath);
}

function analysisError(err: unknown): AgentToolResult {
  return textResult(`Error: ${(err as Error).message}`);
}

export type WhatIfParams = {
  file: string;
  bindings?: TypeBinding[];
  target: string;
  /** Pre-read source (tests / callers that already hold the text). */
  source?: string;
};

/**
 * Set type assumptions and observe the inferred type of `target`. Bindings
 * are genuinely injected via `@nudo:as` before analysis — the inference gap
 * of the original MCP tool.
 */
export function whatIf(params: WhatIfParams, deps: AgentToolDeps = {}): AgentToolResult {
  try {
    const filePath = normalizeFilePath(params.file);
    const original = params.source ?? readSource(filePath, deps);
    const { source, applied, unapplied } = injectBindings(original, params.bindings ?? []);
    // Direct analysis: the injected source never matches the version-keyed
    // editor cache, so bypass it entirely.
    const result = analyzeFile(filePath, source);
    const typeStr = result.bindings.has(params.target)
      ? typeValueToString(result.bindings.get(params.target)!.type)
      : "unknown";

    const notes: string[] = [];
    if (applied.length > 0) notes.push(`Bindings applied: ${applied.join(", ")}`);
    if (unapplied.length > 0) {
      notes.push(`Bindings not applied (no top-level declaration found): ${unapplied.join(", ")}`);
    }
    return textResult(
      `Type of "${params.target}": ${typeStr}${notes.length > 0 ? `\n${notes.join("\n")}` : ""}`,
    );
  } catch (err) {
    return analysisError(err);
  }
}

export type FunctionToolParams = {
  file: string;
  functionName: string;
  /** Pre-read source (tests / callers that already hold the text). */
  source?: string;
};

/** Suggest @nudo:case directives for a function (ported from MCP). */
export function suggestCase(params: FunctionToolParams, deps: AgentToolDeps = {}): AgentToolResult {
  try {
    const filePath = normalizeFilePath(params.file);
    const source = params.source ?? readSource(filePath, deps);
    const result = analyzeFile(filePath, source);
    const fn = result.functions.find((f) => f.name === params.functionName);

    if (!fn) {
      return textResult(`Function "${params.functionName}" not found`);
    }

    if (fn.cases.length > 0) {
      // 手写指令 case 的 source 未标记，合成 case 才带 "callsite"；
      // 全部为合成 case 时可产出直接粘贴回源码的指令文本
      if (fn.cases.every((c) => c.source === "callsite")) {
        const directives = fn.cases
          .map((c) => buildCaseDirective(c.name, c.args))
          .filter((d): d is string => d !== null);
        if (directives.length > 0) {
          const skipped = fn.cases.length - directives.length;
          const lines = [
            `Function "${params.functionName}" has ${fn.cases.length} synthesized case(s); suggested directives:`,
            "/**",
            ...directives,
            "*/",
          ];
          if (skipped > 0) {
            lines.push(`(${skipped} case(s) skipped: not serializable as directives)`);
          }
          return textResult(lines.join("\n"));
        }
        return textResult(
          `Function "${params.functionName}" already has ${fn.cases.length} case(s) (none serializable as directives)`,
        );
      }
      return textResult(`Function "${params.functionName}" already has ${fn.cases.length} case(s)`);
    }

    return textResult(`Suggested: /** @nudo:case */\nfunction ${params.functionName}(...) { ... }`);
  } catch (err) {
    return analysisError(err);
  }
}

/** Trace how a type transforms from input to output across a function's cases (ported from MCP). */
export function trace(params: FunctionToolParams, deps: AgentToolDeps = {}): AgentToolResult {
  try {
    const filePath = normalizeFilePath(params.file);
    const source = params.source ?? readSource(filePath, deps);
    const result = analyzeFile(filePath, source);
    const fn = result.functions.find((f) => f.name === params.functionName);

    if (!fn) {
      return textResult(`Function "${params.functionName}" not found`);
    }

    if (fn.cases.length === 0) {
      return textResult(`No cases found for "${params.functionName}"`);
    }

    const traces = fn.cases.map((c) => {
      const args = c.args.map(typeValueToString).join(", ");
      return `Input: (${args}) => Output: ${typeValueToString(c.result)}`;
    }).join("\n");

    return textResult(traces);
  } catch (err) {
    return analysisError(err);
  }
}
