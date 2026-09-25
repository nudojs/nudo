/**
 * Agent-facing tool implementations. Wire/protocol names match the CLI
 * product surface from design-cli-semantics.md:
 *   signatures → `nudo check` · cases → `nudo test` · contracts → `nudo contract`
 *   projections → `nudo export` · health → `nudo health`
 * Like validation.ts, this module holds pure logic with injected readers so
 * tests exercise it without a live connection; server.ts supplies the
 * document/disk readers. Also hosts computeInterfaceLenses.
 *
 * **E5 同源契约**：agent 工具与 LSP 命令 / CLI 共享同一底层入口
 * （`AGENT_TOOL_SOURCES`）；`resolveProjectAutoBind` 保证 autoBind 与
 * CLI runCheck / LSP validate / CodeLens 同口径。测试钉住语义一致。
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import {
  analyzeFile,
  buildCaseDirective,
  getHoverAtPosition,
  serializeCaseJson,
  getCasesForFile,
  interfaceSurface,
  draftInterface,
  emitInterface,
  formatEmitSummary,
  formatDraftSummary,
  formatInterfaceSurfaceLine,
  findProjectConfig,
  interfaceConfig,
  checkConfig,
  collectSkipReturns,
  isNudoTargetPath,
  sidecarDraftPath,
  writeInterfaceDraft,
  type EmitInterfaceResult,
} from "@nudojs/service";
import { parse } from "@nudojs/parser";
import {
  abs,
  num,
  str,
  bool,
  formatAbs,
  formatShape,
  checkSource,
  serializeCheckJson,
  pTrue,
  formatInterfaceTierLine,
  generatedExportNames,
  interfaceDiagCount,
  interfaceTierOf,
  localNamedExports,
  isNodeModulesPath,
  sidecarPathOf,
  takeInterfaceDiagsSince,
  type Abs,
  type InterfaceSource,
} from "@nudojs/core";
import type { CheckJson } from "@nudojs/core";
import { collectAbsInlays } from "@nudojs/core/internal";
import { lspLoadModule } from "./validation.ts";

export type TypeBinding = { name: string; type: string };

/** MCP-compatible tool result shape — keeps bridge layers zero-rewrite. */
export type AgentToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean };

export type AgentToolDeps = {
  /** Disk reader for files not open in the editor; defaults to readFileSync. */
  readFile?: (filePath: string) => string;
  /** Open-document lookup by absolute file path; the editor buffer wins over disk. */
  getOpenText?: (filePath: string) => { text: string } | undefined;
  /**
   * LSP client workspace folders（server 注入）。emit 写盘仅允许落在这些根内
   * （fail-closed，realpath 比较）；undefined = 无 bound（CLI/测试）。
   */
  workspaceRoots?: string[];
  /**
   * E5：与 validate/hover 同源的侧车装载（server 注入 buffer-aware loadModule）。
   * 缺省回落 lspLoadModule 读盘。
   */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
};

export function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Parse an agent-facing type expression into an Abs.
 * Ported from packages/mcp/src/tools.ts: primitive names, `|` unions,
 * everything else unknown.
 */
export function parseTypeExpr(expr: string): Abs {
  const trimmed = expr.trim();
  if (trimmed === "number") return num();
  if (trimmed === "string") return str();
  if (trimmed === "boolean") return bool();
  if (trimmed === "null") return abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
  if (trimmed === "undefined") return abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");
  if (trimmed === "bigint") return abs({ k: "prim", type: "bigint" }, undefined, undefined, "exact");
  if (trimmed === "symbol") return abs({ k: "prim", type: "symbol" }, undefined, undefined, "exact");
  if (trimmed.includes("|")) {
    const members = trimmed.split("|").map(parseTypeExpr);
    if (members.length === 1) return members[0]!;
    return abs({ k: "sum", members }, undefined, undefined, "exact");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * Normalize a `file` parameter: strips and percent-decodes a `file://` prefix
 * (mirrors validation.ts uriToFilePath), then resolves to an absolute path.
 */
export function normalizeFilePath(file: string): string {
  const path = file.startsWith("file://") ? decodeURIComponent(file.slice(7)) : file;
  return resolve(path);
}

function tryRealpath(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

function pathInsideRoot(root: string, filePath: string): boolean {
  const rel = relative(root, filePath);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * emit 路径边界：目标必须是可分析的 JS/TS 源（非侧车契约模块本身），
 * 不得落在 node_modules（含侧车路径），且在提供 workspaceRoots 时必须
 * 落在某个 root 内（realpath 防符号链接逃逸）。
 *
 * - workspaceRoots === undefined：CLI/无 bound 场景，只做类型/node_modules 检查。
 * - workspaceRoots 提供（含空数组）：LSP agent 写盘，fail-closed——没有任何
 *   root 能包含目标就拒；不回落到 findProjectConfig 祖先 package.json
 * （那会把 workspace 外的项目根误当成授权根）。
 */
export function assertEmitTargetAllowed(
  filePath: string,
  workspaceRoots?: string[],
): string | undefined {
  if (!isNudoTargetPath(filePath)) {
    return `Error: '${filePath}' is not an analysis target (.js/.mjs/.ts required; sidecar contract modules cannot be emit targets)`;
  }
  if (isNodeModulesPath(filePath) || isNodeModulesPath(sidecarPathOf(filePath))) {
    return `Error: '${filePath}' is inside node_modules; emit never writes contract sidecars there`;
  }
  if (workspaceRoots === undefined) return undefined;

  const realFile = tryRealpath(filePath) ?? filePath;
  const roots: string[] = [];
  for (const r of workspaceRoots) {
    const abs = resolve(r);
    const real = tryRealpath(abs) ?? abs;
    if (!roots.includes(real)) roots.push(real);
  }
  // fail-closed：有 bound 却没有任何可用 root（或 root 不含目标）→ 拒
  if (roots.length === 0) {
    return `Error: emit requires at least one workspace root; '${filePath}' cannot be authorized`;
  }
  const ok = roots.some((root) => pathInsideRoot(root, realFile));
  if (!ok) {
    return `Error: '${filePath}' is outside allowed roots (${roots.join(", ")})`;
  }
  return undefined;
}

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
 * (parser's parseCaseArgExpr language: constraint builders + concrete literals).
 * Bare primitives become `number()` / `string()` / `boolean()`; unions become
 * `union(...)`; structural forms pass through untouched.
 */
export function typeExprToDirective(expr: string): string {
  const members = splitTopLevelUnion(expr);
  if (members.length === 0) return "any()";
  const mapped = members.map((m) => {
    if (m.startsWith("T.")) return "any()"; // legacy T.* removed
    if (m === "number" || m === "string" || m === "boolean") return `${m}()`;
    if (m === "unknown" || m === "any") return "any()";
    if (m === "null" || m === "undefined" || m === "true" || m === "false") return m;
    if (/^-?\d+(\.\d+)?$/.test(m)) return m;
    if (/^["']/.test(m)) return m;
    if (/[([{]|=>/.test(m) && !m.startsWith("T.")) return m;
    if (/^(number|string|boolean|any|array|shape|lit|union|fn)\s*\(/.test(m)) return m;
    return "any()";
  });
  return mapped.length === 1 ? mapped[0] : `union(${mapped.join(", ")})`;
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
  return {
    content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
    isError: true,
  };
}

/** 入参 / 写盘门禁错误：MCP 风格 isError，客户端可分支处理 */
function toolError(message: string): AgentToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * E5：项目级 `package.json#nudo.contract.autoBind`（与 CLI check / LSP
 * validate / CodeLens 同口径）。客户端不能借 agent 工具把项目关闭的
 * autoBind 打开——有效值 = 项目配置 AND 客户端请求。
 */
export function resolveProjectAutoBind(
  filePath: string,
  clientAutoBind?: boolean,
): boolean {
  const projectAutoBind = interfaceConfig(
    findProjectConfig(dirname(filePath))?.config,
  ).autoBind;
  return projectAutoBind && (clientAutoBind ?? true);
}

/** draft 写盘 projectDir：与 CLI runInterfaceDraft 同口径
 * （nudo 配置 → package.json 祖先，上溯到 fs root，无层级上限） */
function resolveDraftProjectDir(filePath: string): string | undefined {
  const proj = findProjectConfig(dirname(filePath));
  if (proj?.projectDir) return proj.projectDir;
  // package.json 祖先回落（与 CLI 对齐：无 nudo 配置时仍用包根约束写盘）
  let dir = dirname(filePath);
  const fsRoot = resolve("/");
  while (dir !== fsRoot) {
    const pkg = resolve(dir, "package.json");
    try {
      if (existsSync(pkg)) return dir;
    } catch {
      /* ignore */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * E5：agent 工具与 LSP 命令 / CLI 共享的数据源表（同源验收钉住此表）。
 * 任一工具改实现时必须继续消费同一底层入口，禁止旁路第二套语义。
 * test/whatIf/trace/suggestCase 将 deps.loadModule 传入 analyzeFile
 * （buffer-aware 侧车可见）。validate/pull 的 analyzeFileAsync 同样接线。
 */
export const AGENT_TOOL_SOURCES = {
  whatIf: "injectBindings + analyzeFile",
  suggestCase: "analyzeFile + buildCaseDirective",
  trace: "analyzeFile cases",
  check: "checkSource + serializeCheckJson",
  hover: "getHoverAtPosition + interfaceTierOf",
  test: "analyzeFile + serializeCaseJson",
  contract: "interfaceSurface + formatInterfaceSurfaceLine",
  "contract.draft": "draftInterface + formatDraftSummary",
  "contract.emit": "emitInterface",
  codeLens: "computeInterfaceLenses + interfaceTierOf",
} as const;

export type CheckToolParams = {
  file: string;
  source?: string;
  /** "json" → CheckJson only；缺省人类可读摘要 + JSON */
  format?: "text" | "json";
  /** 解析 @nudo:import 的相对 .nudo.js（测试可注入） */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** 测试注入；有效值与项目 autoBind AND（客户端不能打开已关闭项） */
  autoBind?: boolean;
};

/**
 * Agent 门禁工具：返回 CheckJson v1 契约（与 CLI `nudo check --json` 同构）。
 * 数据源：checkSource + serializeCheckJson；autoBind 与 CLI runCheck 同口径。
 */
export function checkTool(
  params: CheckToolParams,
  deps: AgentToolDeps = {},
): AgentToolResult {
  try {
    const filePath = normalizeFilePath(params.file);
    const source = params.source ?? readSource(filePath, deps);
    const autoBind = resolveProjectAutoBind(filePath, params.autoBind);
    // 与 CLI runCheck 同源读取 package.json#nudo.check（L2）
    const cCfg = checkConfig(findProjectConfig(dirname(filePath))?.config);
    const projectDir = resolveDraftProjectDir(filePath);
    const report = checkSource(filePath, source, pTrue, {
      loadModule: params.loadModule ?? deps.loadModule ?? lspLoadModule,
      fromFile: filePath,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(projectDir ? { projectDir } : {}),
      entryThrows: cCfg.entryThrows,
      ...(cCfg.ignoreThrows.length > 0 ? { ignoreThrows: cCfg.ignoreThrows } : {}),
      skips: collectSkipReturns(source),
    });
    const json = serializeCheckJson(report);
    if (params.format === "json") {
      return textResult(JSON.stringify(json, null, 2));
    }
    const lines: string[] = [
      json.ok ? "nudo check OK" : "nudo check FAILED",
      `${json.summary.errors} error · ${json.summary.warnings} warning · ${json.summary.functions} fn`,
    ];
    for (const i of json.issues) {
      if (i.severity === "info") continue;
      const loc = i.line != null ? ` L${i.line}` : "";
      lines.push(`[${i.severity}]${loc} ${i.message}`);
      if (i.actual) lines.push(`  actual:   ${i.actual}`);
      if (i.expected) lines.push(`  expected: ${i.expected}`);
    }
    lines.push("");
    lines.push(JSON.stringify(json, null, 2));
    return textResult(lines.join("\n"));
  } catch (err) {
    return analysisError(err);
  }
}

export type HoverToolParams = {
  file: string;
  /** 1-based 行 */
  line: number;
  /** 0-based 列 */
  column: number;
  source?: string;
  /** true 时同时返回该文件全部 Abs inlay */
  includeInlays?: boolean;
  /** 可选：*.nudo.js 加载（契约进 inlay / interface 档） */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** autoBind=false 时 interface 档回落 implicit（与 CodeLens 同口径） */
  autoBind?: boolean;
};

/**
 * Agent hover：无损 Abs（不经 TypeValue bridge）。
 * 与 LSP hover 同一信息源（getHoverAtPosition）；interfaceSource 与
 * CodeLens `● interface` 同源（A7 / E5）。autoBind 与 CLI/LSP 同口径。
 */
export function hoverTool(
  params: HoverToolParams,
  deps: AgentToolDeps = {},
): AgentToolResult {
  try {
    const filePath = normalizeFilePath(params.file);
    const source = params.source ?? readSource(filePath, deps);
    const loadModule = params.loadModule ?? deps.loadModule ?? lspLoadModule;
    const autoBind = resolveProjectAutoBind(filePath, params.autoBind);
    const hover = getHoverAtPosition(filePath, source, params.line, params.column, undefined, {
      loadModule,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(resolveDraftProjectDir(filePath)
        ? { projectDir: resolveDraftProjectDir(filePath)! }
        : {}),
    });
    const payload: Record<string, unknown> = {
      file: filePath,
      line: params.line,
      column: params.column,
      abs: hover?.abs ?? null,
      absMultiline: hover?.absMultiline ?? null,
      intension: hover?.intension ?? null,
      /** 有损外延，仅对照 */
      ext: hover?.typeText ?? null,
      /** CodeLens `● interface` 同源档（A7）；非导出 / 无档 → null */
      interfaceSource: hover?.interfaceSource ?? null,
      interfaceDisplay: hover?.interfaceDisplay ?? null,
      interfaceLine: hover?.interfaceSource
        ? formatInterfaceTierLine(hover.interfaceSource)
        : null,
    };
    if (params.includeInlays) {
      payload.inlays = collectAbsInlays(source, {
        loadModule,
        fromFile: filePath,
        ...(autoBind === false ? { autoBind: false } : {}),
      });
    }
    return textResult(JSON.stringify(payload, null, 2));
  } catch (err) {
    return analysisError(err);
  }
}

export type TestToolParams = {
  file: string;
  source?: string;
  /** "json" → CaseJson only；缺省摘要 + JSON */
  format?: "text" | "json";
  /** 只返回这些函数名（可选过滤） */
  functions?: string[];
  /** buffer-aware loadModule（E5）；缺省 deps.loadModule */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
};

/**
 * Agent test：CaseJson v1 契约（与 CLI `nudo test --json` 同构）。
 * intension 携带无损 Abs；args/result 为 TypeValue 投影。
 * E5：deps.loadModule 传入 analyzeFile（buffer-aware 侧车可见）。
 */
export function testTool(
  params: TestToolParams,
  deps: AgentToolDeps = {},
): AgentToolResult {
  try {
    const filePath = normalizeFilePath(params.file);
    const source = params.source ?? readSource(filePath, deps);
    const result = analyzeFile(
      filePath,
      source,
      undefined,
      undefined,
      params.loadModule ?? deps.loadModule ?? lspLoadModule,
      "all",
    );
    let json = serializeCaseJson(result, filePath);
    if (params.functions && params.functions.length > 0) {
      const keep = new Set(params.functions);
      const filtered = json.functions.filter((f) => keep.has(f.name));
      let cases = 0;
      for (const f of filtered) {
        cases += (f as { cases?: unknown[] }).cases?.length ?? 0;
      }
      const summary = {
        ...json.summary,
        functions: filtered.length,
        cases,
      };
      json = { ...json, functions: filtered, summary } as typeof json;
    }
    if (params.format === "json") {
      return textResult(JSON.stringify(json, null, 2));
    }
    const lines: string[] = [
      `nudo test  ${json.file}`,
      `${json.summary.functions} fn · ${json.summary.cases} case · ${json.summary.diagnostics} diag`,
    ];
    for (const f of json.functions) {
      lines.push("");
      lines.push(`${f.name}${f.entryOnly ? "  [entry-only]" : ""}`);
      for (const c of f.cases) {
        const args = c.args.join(", ");
        lines.push(`  ${c.name}: (${args}) => ${c.result}`);
        if (c.intension?.abs) lines.push(`    abs: ${c.intension.abs}`);
        else if (c.intension?.display) lines.push(`    intension: ${c.intension.display}`);
      }
    }
    lines.push("");
    lines.push(JSON.stringify(json, null, 2));
    return textResult(lines.join("\n"));
  } catch (err) {
    return analysisError(err);
  }
}

export type WhatIfParams = {
  file: string;
  bindings?: TypeBinding[];
  target: string;
  /** Pre-read source (tests / callers that already hold the text). */
  source?: string;
  /** buffer-aware loadModule（E5）；缺省 deps.loadModule */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
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
    const result = analyzeFile(
      filePath,
      source,
      undefined,
      undefined,
      params.loadModule ?? deps.loadModule ?? lspLoadModule,
    );
    const binding = result.bindings.get(params.target);
    // 无损 Abs
    const typeStr = binding ? formatAbs(binding.abs) : "unknown";

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
  /** buffer-aware loadModule（E5）；缺省 deps.loadModule */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
};

/** Suggest @nudo:case directives for a function (ported from MCP). */
export function suggestCase(params: FunctionToolParams, deps: AgentToolDeps = {}): AgentToolResult {
  try {
    const filePath = normalizeFilePath(params.file);
    const source = params.source ?? readSource(filePath, deps);
    const result = analyzeFile(
      filePath,
      source,
      undefined,
      undefined,
      params.loadModule ?? deps.loadModule ?? lspLoadModule,
      "all",
    );
    const fn = result.functions.find((f) => f.name === params.functionName);

    if (!fn) {
      return textResult(`Function "${params.functionName}" not found`);
    }

    if (fn.cases.length > 0) {
      // 手写指令 case 的 source 未标记，合成 case 才带 "callsite"；
      // 全部为合成 case 时可产出直接粘贴回源码的指令文本
      if (fn.cases.every((c) => c.source === "callsite")) {
        const directives = fn.cases
          .map((c) => buildCaseDirective(c.name, c.argAbs ?? []))
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
    const result = analyzeFile(
      filePath,
      source,
      undefined,
      undefined,
      params.loadModule ?? deps.loadModule ?? lspLoadModule,
      "all",
    );
    const fn = result.functions.find((f) => f.name === params.functionName);

    if (!fn) {
      return textResult(`Function "${params.functionName}" not found`);
    }

    if (fn.cases.length === 0) {
      return textResult(`No cases found for "${params.functionName}"`);
    }

    const traces = fn.cases.map((c) => {
      const args = c.argAbs.map(formatShape).join(", ");
      return `Input: (${args}) => Output: ${formatShape(c.abs)}`;
    }).join("\n");

    return textResult(traces);
  } catch (err) {
    return analysisError(err);
  }
}

// ---------------------------------------------------------------------------
// contract 档（design-refine-derivation §7.5/§8）：agent 打印/固化工具 +
// CodeLens 计算纯函数。产品名 contract；case 是 debug 副层。
// ---------------------------------------------------------------------------

export type ContractToolParams = {
  file: string;
  /** 省略 → 打印该文件全部顶层函数 */
  functionName?: string;
  /** .nudo.js 侧车装载（测试注入）；缺省 lspLoadModule 真实读盘 */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /**
   * 测试注入用。客户端不能借此把项目 `autoBind: false` 打开——有效值与
   * 项目配置 AND：`projectAutoBind && (params.autoBind ?? true)`。
   */
  autoBind?: boolean;
  /** 打开 buffer 源（E5）；缺省 deps.getOpenText */
  source?: string;
};

/**
 * executeCommand 位置参数桥接（server.ts onExecuteCommand 特判移出的纯函数
 * 形态，供请求面测试）：`nudo.contract [uri, functionName?]`。
 */
export function contractPositionalArgs(
  args: unknown[],
): ContractToolParams | undefined {
  if (args.length >= 1 && typeof args[0] === "string") {
    return {
      file: args[0],
      ...(args.length >= 2 && typeof args[1] === "string"
        ? { functionName: args[1] }
        : {}),
    };
  }
  return undefined;
}

/**
 * executeCommand 位置参数桥接：`nudo.contract.emit [uri, functionName, mode]`。
 * 非法 mode 由 contractEmitTool 校验（显式错误文本，不静默降级）。
 */
export function contractEmitPositionalArgs(
  args: unknown[],
): { file: string; functionName: string; mode: "add" | "update" } | undefined {
  if (
    args.length >= 3 &&
    typeof args[0] === "string" &&
    typeof args[1] === "string" &&
    typeof args[2] === "string"
  ) {
    return {
      file: args[0],
      functionName: args[1],
      mode: args[2] as "add" | "update",
    };
  }
  return undefined;
}

/**
 * Agent contract 打印：与 CLI `nudo contract` 同一数据源（interfaceSurface），
 * 逐函数展示有效契约分层 handwritten / generated / implicit。
 * E5：优先 open buffer（getOpenText），磁盘回落；loadModule 走 buffer-aware。
 */
export async function contractTool(
  params: ContractToolParams,
  _deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    const filePath = normalizeFilePath(params.file);
    // 有效 autoBind = 项目配置 AND 客户端请求（E5 同源 helper）
    const autoBind = resolveProjectAutoBind(filePath, params.autoBind);
    const open = _deps.getOpenText?.(filePath);
    const source = params.source ?? open?.text;
    const entries = await interfaceSurface(filePath, {
      loadModule: params.loadModule ?? _deps.loadModule ?? lspLoadModule,
      autoBind,
      ...(source !== undefined ? { source } : {}),
    });
    const selected = params.functionName
      ? entries.filter((e) => e.fn === params.functionName)
      : entries;

    const lines: string[] = [filePath];
    if (selected.length === 0) {
      lines.push(
        params.functionName
          ? `  no interface found for '${params.functionName}'`
          : "  (no top-level functions found)",
      );
    }
    for (const line of selected.map(formatInterfaceSurfaceLine)) lines.push(line);
    lines.push("");
    lines.push(JSON.stringify(selected, null, 2));
    return textResult(lines.join("\n"));
  } catch (err) {
    return analysisError(err);
  }
}

export type ContractDraftToolParams = {
  file: string;
  functionName?: string;
  /** true → 写入 *.nudo.draft.js（不碰手写 *.nudo.js） */
  write?: boolean;
  dryRun?: boolean;
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  autoBind?: boolean;
  source?: string;
};

/**
 * Agent contract 草稿：与 CLI `nudo contract --draft` 同源（draftInterface）。
 * 代码优先 / 迁移：返回可审阅 `*.nudo.draft.js` 文本；write 落盘 draft 文件。
 */
export async function contractDraftTool(
  params: ContractDraftToolParams,
  deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    const filePath = normalizeFilePath(params.file);
    // 写盘与 emit 同门禁：目标须为分析文件，且在 workspace roots 内
    if (params.write) {
      const gate = assertEmitTargetAllowed(filePath, deps.workspaceRoots);
      if (gate) return { content: [{ type: "text", text: gate }], isError: true };
    }
    const open = deps.getOpenText?.(filePath);
    const source = params.source ?? open?.text;
    const result = await draftInterface(filePath, {
      ...(params.functionName ? { fnNames: [params.functionName] } : {}),
      // E5：与 validate/hover 同源 loadModule（buffer-aware）；客户端 autoBind
      // 不再用来打开项目关闭项——draft 内部按侧车是否存在探测 handwritten
      ...(params.loadModule ?? deps.loadModule
        ? { loadModule: params.loadModule ?? deps.loadModule }
        : {}),
      ...(source !== undefined ? { source } : {}),
    });
    const draftRel = sidecarDraftPath(filePath);
    const projectDir = resolveDraftProjectDir(filePath);
    // P2：write 路径与 CLI 对齐 fail-closed——无项目根时拒绝写盘
    // （CLI `nudo contract --draft --write`；可用已存在的 NUDO_DRAFT_FORCE=1 放开）
    if (params.write && !projectDir && !process.env.NUDO_DRAFT_FORCE) {
      return toolError(
        `Error: no project root found for '${filePath}'; draft write refused (set NUDO_DRAFT_FORCE=1 to override)`,
      );
    }
    const lines =
      params.write
        ? formatDraftSummary(
            filePath,
            draftRel,
            result,
            writeInterfaceDraft(filePath, result.draftSource, {
              dryRun: params.dryRun === true,
              entries: result.entries,
              ...(projectDir ? { projectDir } : {}),
            }),
          )
        : formatDraftSummary(filePath, draftRel, result);
    return textResult(lines.join("\n"));
  } catch (err) {
    return analysisError(err);
  }
}

export type ContractEmitToolParams = {
  file: string;
  functionName: string;
  mode: "add" | "update";
  /**
   * Preview without writing: same result shape as a real emit (paths,
   * would-change, optional unifiedDiff) but `emitInterface` is called with
   * `dryRun: true` — no sidecar write, no invalidation-as-if-written.
   * VS Code persist command sends this first, then a real write on confirm.
   */
  dryRun?: boolean;
};

/** 每侧车路径写盘串行化：emitInterface 的读-分析-写之间有 await 边界，
 *  连续两次 emit（如连续点击两个 persist lens）都基于同一份旧侧车内容计算，
 *  后写整文件覆盖 → 前一个 @generated 段丢失且首次结果文本虚报 written。
 *  同路径排队后两次 emit 串行，第二次读到第一次的写盘结果。 */
const emitChains = new Map<string, Promise<unknown>>();
function serializedEmit(
  filePath: string,
  fnNames: string[],
  mode: "add" | "update",
  extra: {
    source?: string;
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    dryRun?: boolean;
  } = {},
): Promise<EmitInterfaceResult> {
  const prev = emitChains.get(filePath) ?? Promise.resolve();
  const run = () => emitInterface(filePath, { fnNames, mode, ...extra });
  const next = prev.then(run, run); // 前次失败不阻塞后续
  const settled = next.then(
    () => {},
    () => {},
  );
  emitChains.set(filePath, settled);
  // 链尾落地后清掉，避免长驻 LSP 会话 Map 无界增长
  void settled.then(() => {
    if (emitChains.get(filePath) === settled) emitChains.delete(filePath);
  });
  return next;
}

/**
 * Agent contract 固化：与 CLI `nudo contract --emit` 同一写盘器
 * （emitInterface），把调用点域固化为侧车 `@generated` 段。结果文本含
 * written / skipped(reason) / issues；name-clash（手写优先）明确呈现。
 */
export async function contractEmitTool(
  params: ContractEmitToolParams,
  deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    // 入参校验：非法 mode / 缺 functionName → 显式错误回报（server.ts 的
    // dispatch 对 JSON 请求体只做 as 强转，不校验会静默降级成 add / skipped）
    if (typeof params.functionName !== "string" || params.functionName.trim() === "") {
      return toolError("Error: functionName is required for nudo.contract.emit");
    }
    if (params.mode !== "add" && params.mode !== "update") {
      return toolError(
        `Error: invalid mode '${String(params.mode)}' — expected "add" | "update"`,
      );
    }
    const filePath = normalizeFilePath(params.file);
    const err = assertEmitTargetAllowed(filePath, deps.workspaceRoots);
    if (err) return toolError(err);
    // E5：分析与 validate 同源（open buffer + buffer-aware loadModule）
    const openSource = deps.getOpenText?.(filePath)?.text;
    // 侧车 open buffer 脏：emit 写盘后 save 会覆盖 @generated 段 → 拒绝
    const sidecarPath = sidecarPathOf(filePath);
    const openSidecar = deps.getOpenText?.(sidecarPath)?.text;
    if (openSidecar !== undefined) {
      let diskSidecar: string | undefined;
      try {
        diskSidecar = readFileSync(sidecarPath, "utf-8");
      } catch {
        diskSidecar = undefined;
      }
      if (diskSidecar !== undefined && openSidecar !== diskSidecar) {
        return toolError(
          `Error: sidecar ${sidecarPath} has unsaved buffer changes; save or discard them before emit (otherwise save would overwrite @generated sections)`,
        );
      }
    }
    const dryRun = params.dryRun === true;
    const result = await serializedEmit(filePath, [params.functionName], params.mode, {
      ...(dryRun ? { dryRun: true } : {}),
      ...(openSource !== undefined ? { source: openSource } : {}),
      ...(deps.loadModule ? { loadModule: deps.loadModule } : {}),
    });
    return textResult(formatEmitResult(filePath, result, dryRun));
  } catch (err) {
    return analysisError(err);
  }
}

/**
 * emit 结果文本（与 CLI runInterfaceEmit 共用 formatEmitSummary 骨架；
 * 本包装传绝对路径口径）。
 * dryRun：与 CLI `--emit --dry-run` 同口径的 `[dry-run] would update` 预览
 * （含 unifiedDiff / would-write），绝不声称已写盘。
 */
export function formatEmitResult(
  filePath: string,
  result: EmitInterfaceResult,
  dryRun = false,
): string {
  if (dryRun) {
    const lines: string[] = [];
    if (result.changed) {
      lines.push(`[dry-run] would update ${filePath} → ${result.sidecarPath}`);
      lines.push(`  would write: ${result.written.join(", ") || "(none)"}`);
      if (result.diff) lines.push(result.diff);
    } else {
      lines.push(`${filePath}: no interface changes`);
      if (result.emptyDefaultTargets) {
        lines.push(
          `  tip: default emit only refreshes existing @generated segments; pass functionName to create new ones`,
        );
      }
    }
    for (const s of result.skipped.filter((x) => x.reason !== "no-change")) {
      lines.push(`  skipped ${s.fn} (${s.reason})`);
    }
    for (const i of result.issues) {
      lines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
    }
    lines.push("  (dry-run: no sidecar written)");
    return lines.join("\n");
  }
  return formatEmitSummary(filePath, result.sidecarPath, result).join("\n");
}

// ---------------------------------------------------------------------------
// CodeLens contract 档计算（design-refine-derivation §8）
// ---------------------------------------------------------------------------

/** 默认层 lens：`● interface / handwritten|generated|implicit` */
export type InterfaceLens =
  | { kind: "interface"; fn: string; line: number; source: InterfaceSource }
  /** 固化动作 lens：add=`⚡ persist interface`，update=`↻ update interface` */
  | { kind: "emit"; fn: string; line: number; mode: "add" | "update" }
  /** 代码优先草稿：`⚡ draft interface`（F6；handwritten 不加） */
  | { kind: "draft"; fn: string; line: number };

/** case 副层 lens（debug 层，标题/命令与既有行为一致） */
export type CaseLens = {
  kind: "case";
  fn: string;
  line: number;
  caseIndex: number;
  caseName: string;
  active: boolean;
};

/**
 * 合成观察 lens（call@ / entry@）：把 `nudo test` 的调用点事实直接钉在
 * 源码上。call@ 落在**调用点行**，entry@ 落在**函数声明行**。只读观察。
 */
export type ObservationLens = {
  kind: "callsite" | "entry";
  fn: string;
  /** 1-based：call@=调用点行；entry@/symbolic=函数行 */
  line: number;
  caseName: string;
  /** CLI test 同形标题：`call@L6  (5, 3) => 2` */
  title: string;
};

export type NudoLens = InterfaceLens | CaseLens | ObservationLens;

export type InterfaceLensDeps = {
  /** .nudo.js 侧车装载（effectiveInterface 同一通道）；缺省不加载侧车 */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** fn → 激活 case 下标（●/○ 标题）；缺省全部按 index 0 */
  activeCases?: Map<string, number>;
  /** 侧车 ambient 绑定开关（与 check/validate 同口径；false 时回落 implicit） */
  autoBind?: boolean;
};

/** 顶层函数位（含 export 包裹与箭头/函数表达式 const 声明）——interface 档目标集 */
function topLevelFunctionSlots(source: string): Array<{ name: string; line: number }> {
  const ast = parse(source);
  const out: Array<{ name: string; line: number }> = [];
  for (const stmt of (ast as any).program.body ?? []) {
    const line = stmt.loc?.start?.line;
    if (typeof line !== "number") continue;
    const d = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (!d) continue;
    if (d.type === "FunctionDeclaration" && d.id) {
      out.push({ name: d.id.name, line });
    } else if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations ?? []) {
        if (
          decl.id?.type === "Identifier" &&
          decl.init &&
          (decl.init.type === "ArrowFunctionExpression" || decl.init.type === "FunctionExpression")
        ) {
          out.push({ name: decl.id.name, line });
        }
      }
    }
  }
  return out;
}

/**
 * CodeLens 全量计算（server.ts onCodeLens 的可测纯函数形态）：
 * - interface 默认层：每个**导出**函数一条 `● interface / <source>`——
 *   effectiveInterface 命中 handwritten/generated，否则 implicit
 *   （隐式 interface 始终可算，§7.1）；私有函数不绑定不落盘（§2.1），不加。
 * - 固化动作：handwritten 只读展示；侧车已含同名 @generated 段 → update，
 *   否则 add。
 * - case 副层：跟在本函数 interface 档之后（标题/命令零改动；来源仍是
 *   getCasesForFile 的指令 case）。
 */
export function computeInterfaceLenses(
  source: string,
  filePath: string,
  deps: InterfaceLensDeps = {},
): NudoLens[] {
  // since 锚：lens 探测只排干自身产生的诊断增量——全量 take 会在 validateText
  // 的 await 窗口窃取在途待消费的 interface-load 等诊断（check 通道被饿死）
  const ifaceSince = interfaceDiagCount();
  const lenses: NudoLens[] = [];
  const exported = localNamedExports(source);

  // 固化状态：侧车是否已含同名 @generated 段（与 effectiveInterface 的
  // generatedExportNames 判定同口径；经 loadModule 读侧车，不直接碰盘）
  const sidecarPath = sidecarPathOf(filePath);
  const sidecarSpec = `./${sidecarPath.slice(sidecarPath.lastIndexOf("/") + 1)}`;
  const sidecarSrc = deps.loadModule?.(sidecarSpec, filePath);
  const persisted = sidecarSrc !== undefined ? generatedExportNames(sidecarSrc) : new Set<string>();

  const fnCases = new Map(
    getCasesForFile(filePath, source).map((f) => [f.functionName, f] as const),
  );

  const pushCaseLenses = (fnName: string, line: number): void => {
    const fc = fnCases.get(fnName);
    if (!fc) return;
    const activeIdx = deps.activeCases?.get(fnName) ?? 0;
    for (const c of fc.cases) {
      lenses.push({
        kind: "case",
        fn: fnName,
        line,
        caseIndex: c.index,
        caseName: c.name,
        active: c.index === activeIdx,
      });
    }
  };

  const seen = new Set<string>();
  for (const fn of topLevelFunctionSlots(source)) {
    if (seen.has(fn.name)) continue;
    seen.add(fn.name);

    if (exported.has(fn.name)) {
      // A7：与 hover / semantic tokens / inlay 共用 interfaceTierOf（同源）
      const tier = interfaceTierOf(source, fn.name, filePath, {
        ...(deps.loadModule ? { loadModule: deps.loadModule } : {}),
        // §2.2「整体关闭」：autoBind=false 时侧车 ambient 停用，lens 回落
        // implicit（与 check/validate/print 同口径，避免 UI 仍暗示契约生效）
        ...(deps.autoBind === false ? { autoBind: false } : {}),
      });
      const src: InterfaceSource = tier?.source ?? "implicit";
      lenses.push({ kind: "interface", fn: fn.name, line: fn.line, source: src });
      if (src !== "handwritten") {
        lenses.push({
          kind: "emit",
          fn: fn.name,
          line: fn.line,
          mode: persisted.has(fn.name) ? "update" : "add",
        });
        // F6：代码优先草稿（与 CLI --draft / agent nudo.contract.draft 同源）
        lenses.push({ kind: "draft", fn: fn.name, line: fn.line });
      }
    }

    // case 副层跟随 interface 档之后（同函数同 line，数组序即渲染序）
    pushCaseLenses(fn.name, fn.line);
  }

  // getCasesForFile 宇宙中未被顶层函数扫描覆盖的形态：原样保留 case lens
  for (const fc of fnCases.values()) {
    if (seen.has(fc.functionName)) continue;
    seen.add(fc.functionName);
    pushCaseLenses(fc.functionName, fc.loc.start.line);
  }

  // lens 探测可能积累 interface-load 诊断——只排本次增量，防泄漏进 check 通道
  takeInterfaceDiagsSince(ifaceSince);
  return lenses;
}

/** `call@L6` / `entry@L2` → 行号；`call@symbolic` / `entry@` → undefined */
function observationLineFromName(name: string): number | undefined {
  const m = /@L(\d+)\s*$/.exec(name);
  return m ? Number(m[1]) : undefined;
}

/**
 * 合成 call@ / entry@ 观察 lens（CLI `nudo test` 的源码内投影）。
 * - 跳过 `@nudo:case` 指令 case（已有 case 副层 lens）
 * - call@ 挂调用点行；entry@ / call@symbolic 挂函数声明行
 * - 标题与 test 报告同形：`call@L6  (5, 3) => 2`
 */
export function computeObservationLenses(source: string, filePath: string): ObservationLens[] {
  let analysis: ReturnType<typeof analyzeFile>;
  try {
    analysis = analyzeFile(filePath, source);
  } catch {
    return [];
  }
  const out: ObservationLens[] = [];
  for (const fn of analysis.functions) {
    const fnLine = fn.loc.start.line;
    for (const c of fn.cases) {
      // 指令 case 由 case 副层负责；这里只钉合成观察
      if (c.source === "directive") continue;
      const isEntry = c.name.startsWith("entry@");
      const isCall = c.name.startsWith("call@");
      if (!isEntry && !isCall && c.source !== "callsite") continue;

      const args = c.argAbs.map((a) => {
        try {
          return formatShape(a);
        } catch {
          return "unknown";
        }
      });
      let result: string;
      try {
        result = formatShape(c.abs);
      } catch {
        result = "unknown";
      }
      const argsStr = args.join(", ");
      const title = `${c.name}  (${argsStr}) => ${result}${c.throwsAbs && c.throwsAbs.shape.k !== "never" ? `  throws ${formatShape(c.throwsAbs)}` : ""}`;

      const callLine = observationLineFromName(c.name);
      const line = isEntry ? fnLine : (callLine ?? fnLine);
      out.push({
        kind: isEntry ? "entry" : "callsite",
        fn: fn.name,
        line,
        caseName: c.name,
        title,
      });
    }
  }
  // 稳定序：行号 → 函数名 → case 名
  out.sort((a, b) => a.line - b.line || a.fn.localeCompare(b.fn) || a.caseName.localeCompare(b.caseName));
  return out;
}
