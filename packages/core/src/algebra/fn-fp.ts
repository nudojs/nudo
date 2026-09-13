/**
 * per-function fingerprint: after-edit only dirty fn + callers miss L0.
 *
 * - own: function declaration slice (incl. leading comments / refine)
 * - deps: transitively referenced sibling own hashes + non-fn top-level context
 * - context change (import/class/const...) -> all miss (conservative)
 */
import type { Node, File } from "@babel/types";

export type FnFp = { own: string; deps: string; nRefs: number };

const fnFpCache = new Map<string, Map<string, FnFp>>();
const MAX_FN_FP_CACHE = 48;

let lastHashSource: string | undefined;
let lastHashOut: string | undefined;

function hashSource(s: string): string {
  if (s === lastHashSource && lastHashOut !== undefined) return lastHashOut;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  lastHashSource = s;
  lastHashOut = (h >>> 0).toString(36);
  return lastHashOut;
}

export function resetFnFpCache(): void {
  fnFpCache.clear();
  lastHashSource = undefined;
  lastHashOut = undefined;
}

function getFnNameAndBody(decl: Node): { name: string; body: Node } | undefined {
  if (decl.type === "FunctionDeclaration" && decl.id) {
    return { name: decl.id.name, body: decl.body };
  }
  if (decl.type === "VariableDeclaration") {
    for (const d of decl.declarations) {
      if (
        d.id.type === "Identifier" &&
        d.init &&
        (d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression")
      ) {
        return { name: d.id.name, body: d.init.body };
      }
    }
  }
  return undefined;
}

function leadingSliceStart(stmt: Node, decl: Node): number {
  const comments =
    (stmt as { leadingComments?: Array<{ start?: number }> }).leadingComments ??
    (decl as { leadingComments?: Array<{ start?: number }> }).leadingComments;
  const first = comments?.[0];
  if (first && typeof first.start === "number") return first.start;
  return stmt.start ?? decl.start ?? 0;
}

/** Conservative: any top-level sibling name appearing in the body is a dep. */
function collectSiblingRefs(node: unknown, known: Set<string>, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown> & { type?: string };
  if (obj.type === "Identifier" && typeof obj.name === "string" && known.has(obj.name)) {
    out.add(obj.name);
  }
  for (const key of Object.keys(obj)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments"
    ) {
      continue;
    }
    if (
      (key === "key" || key === "property") &&
      (obj.type === "MemberExpression" ||
        obj.type === "ObjectProperty" ||
        obj.type === "ObjectMethod" ||
        obj.type === "ClassMethod" ||
        obj.type === "ClassProperty") &&
      obj.computed !== true
    ) {
      continue;
    }
    const v = obj[key];
    if (Array.isArray(v)) {
      for (const x of v) collectSiblingRefs(x, known, out);
    } else if (v && typeof v === "object") {
      collectSiblingRefs(v, known, out);
    }
  }
}

function computeFnFingerprints(source: string, file: File): Map<string, FnFp> {
  const top: Array<{ name: string; slice: string; body: Node }> = [];
  const contextParts: string[] = [];

  for (const stmt of file.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    } else if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    const fnInfo = getFnNameAndBody(decl);
    if (fnInfo) {
      const start = leadingSliceStart(stmt, decl);
      const end = decl.end ?? stmt.end ?? start;
      top.push({
        name: fnInfo.name,
        slice: source.slice(start, Math.max(end, start)),
        body: fnInfo.body,
      });
    } else if (typeof stmt.start === "number" && typeof stmt.end === "number") {
      contextParts.push(source.slice(stmt.start, stmt.end));
    } else {
      contextParts.push(stmt.type);
    }
  }

  const context = hashSource(contextParts.join("\n "));
  const names = new Set(top.map((t) => t.name));
  const own = new Map<string, string>();
  for (const t of top) own.set(t.name, hashSource(t.slice));

  const edges = new Map<string, Set<string>>();
  for (const t of top) {
    const refs = new Set<string>();
    collectSiblingRefs(t.body, names, refs);
    edges.set(t.name, refs);
  }

  const result = new Map<string, FnFp>();
  for (const t of top) {
    const seen = new Set<string>();
    const stack = [...(edges.get(t.name) ?? [])];
    const depParts: string[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      depParts.push(`${cur}=${own.get(cur) ?? "?"}`);
      for (const next of edges.get(cur) ?? []) {
        if (!seen.has(next)) stack.push(next);
      }
    }
    depParts.sort();
    result.set(t.name, {
      own: own.get(t.name)!,
      deps: hashSource(`${depParts.join(",")} ${context}`),
      nRefs: seen.size,
    });
  }
  return result;
}

/** source -> (fnName -> own/deps); LRU */
export function fnFingerprints(source: string, file: File): Map<string, FnFp> {
  const hit = fnFpCache.get(source);
  if (hit !== undefined) {
    fnFpCache.delete(source);
    fnFpCache.set(source, hit);
    return hit;
  }
  const fp = computeFnFingerprints(source, file);
  if (fnFpCache.size >= MAX_FN_FP_CACHE) {
    const oldest = fnFpCache.keys().next().value;
    if (oldest !== undefined) fnFpCache.delete(oldest);
  }
  fnFpCache.set(source, fp);
  return fp;
}

/** L0 source part: per-fn fingerprint when AST available; else full-file hash */
export function generalizeSourceKeyPart(
  source: string,
  fnName: string,
  file?: File,
): string {
  if (!file) return `w:${hashSource(source)}`;
  const fp = fnFingerprints(source, file).get(fnName);
  if (fp) return `f:${fp.own}:${fp.deps}`;
  return `u:${hashSource(source)}`;
}

/**
 * 无 refine、无模块语法、无兄弟调用、无顶层调用 → scanLiteralCalls 可整段跳过。
 * 保守：import/require 字面出现即不 skip。
 */
export function canSkipLiteralCallScan(source: string, file: File): boolean {
  if (source.includes("@nudo:refine")) return false;
  if (source.includes("import ") || source.includes("require(") || source.includes("import(")) {
    return false;
  }
  const fps = fnFingerprints(source, file);
  for (const fp of fps.values()) {
    if (fp.nRefs > 0) return false;
  }
  for (const stmt of file.program.body) {
    if (stmt.type === "ExpressionStatement" && stmt.expression.type === "CallExpression") {
      return false;
    }
  }
  return true;
}
