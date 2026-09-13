/**
 * per-function fingerprint: after-edit only dirty fn + callers miss L0.
 *
 * - own: function declaration slice (incl. leading comments / refine)
 * - deps: transitively referenced sibling own hashes + non-fn top-level context
 * - context change (import/class/const...) -> all miss (conservative)
 *
 * Multi-declarator `const a = fn, b = fn` yields one fingerprint per function;
 * each own-slice is its own declarator (first also carries statement leading comments).
 */
import type { Node, File } from "@babel/types";
import { hashSource } from "./hash-source.ts";

export type FnFp = { own: string; deps: string; nRefs: number };

/** source → per-fn fingerprints. Key is full source (collision-safe); cap keeps
 *  retained text bounded: 24 × 1MB ≈ 24MB worst-case key strings. */
const fnFpCache = new Map<string, Map<string, FnFp>>();
const MAX_FN_FP_CACHE = 24;
/** Cap on cached whole-source keys so large monorepo sessions stay bounded. */
const MAX_FN_FP_SOURCE_CHARS = 1_000_000;

export function resetFnFpCache(): void {
  fnFpCache.clear();
}

type FnDeclInfo = {
  name: string;
  body: Node;
  /** Function/arrow node (own-slice end; also scanned for sibling refs incl. defaults). */
  fnNode: Node;
  /** Declarator start when from a VariableDeclaration; else undefined. */
  declaratorStart?: number;
  /** First leading-comment start on this declarator (multi-decl refine/@nudo). */
  declaratorLeadStart?: number;
};

/** Every top-level function binding in a declaration node (not just the first). */
export function getFnNameAndBodies(decl: Node): FnDeclInfo[] {
  const out: FnDeclInfo[] = [];
  if (decl.type === "FunctionDeclaration" && decl.id) {
    out.push({ name: decl.id.name, body: decl.body, fnNode: decl });
    return out;
  }
  if (decl.type === "VariableDeclaration") {
    for (const d of decl.declarations) {
      if (
        d.id.type === "Identifier" &&
        d.init &&
        (d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression")
      ) {
        const comments = (d as { leadingComments?: Array<{ start?: number }> }).leadingComments;
        const first = comments?.[0];
        out.push({
          name: d.id.name,
          body: d.init.body,
          fnNode: d.init,
          declaratorStart: d.start ?? undefined,
          declaratorLeadStart: typeof first?.start === "number" ? first.start : undefined,
        });
      }
    }
  }
  return out;
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
    // Binding name, not a use: `function id() {}` / `class id {}` must not
    // count as a sibling ref (would make nRefs≥1 for every named decl and
    // permanently disable canSkipLiteralCallScan).
    if (
      key === "id" &&
      (obj.type === "FunctionDeclaration" ||
        obj.type === "FunctionExpression" ||
        obj.type === "ClassDeclaration" ||
        obj.type === "ClassExpression")
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
  const top: Array<{ name: string; slice: string; fnNode: Node }> = [];
  const contextParts: string[] = [];

  for (const stmt of file.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    } else if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    const fnInfos = getFnNameAndBodies(decl);
    if (fnInfos.length > 0) {
      const lead = leadingSliceStart(stmt, decl);
      for (let i = 0; i < fnInfos.length; i++) {
        const info = fnInfos[i]!;
        // First declarator carries statement leading comments; later ones start
        // at their own leading comments so sibling edits do not dirty this own-hash.
        const sliceStart =
          i === 0
            ? lead
            : (info.declaratorLeadStart ??
              info.declaratorStart ??
              info.fnNode.start ??
              lead);
        const end = info.fnNode.end ?? info.declaratorStart ?? decl.end ?? stmt.end ?? sliceStart;
        top.push({
          name: info.name,
          slice: source.slice(sliceStart, Math.max(end, sliceStart)),
          fnNode: info.fnNode,
        });
      }
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
    // Whole fn node (params defaults + body), not body alone
    collectSiblingRefs(t.fnNode, names, refs);
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
  if (source.length > MAX_FN_FP_SOURCE_CHARS) {
    return computeFnFingerprints(source, file);
  }
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

/** Any CallExpression / NewExpression / dynamic import in the AST. */
function hasAnyCallLike(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== "object") return false;
  // Depth cap: unexplored subtree must be treated as "may contain a call"
  // (return true). Returning false would let canSkipLiteralCallScan skip
  // scanLiteralCalls and miss constraint violations in deep expressions.
  if (depth > 80) return true;
  const obj = node as Record<string, unknown> & { type?: string };
  if (
    obj.type === "CallExpression" ||
    obj.type === "NewExpression" ||
    obj.type === "OptionalCallExpression" ||
    obj.type === "ImportExpression"
  ) {
    return true;
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
    const v = obj[key];
    if (Array.isArray(v)) {
      for (const x of v) if (hasAnyCallLike(x, depth + 1)) return true;
    } else if (v && typeof v === "object") {
      if (hasAnyCallLike(v, depth + 1)) return true;
    }
  }
  return false;
}

function hasModuleSyntax(file: File): boolean {
  for (const stmt of file.program.body) {
    if (stmt.type === "ImportDeclaration") return true;
    if (stmt.type === "ExportAllDeclaration") return true;
    if (stmt.type === "ExportNamedDeclaration" && stmt.source) return true;
  }
  return false;
}

/**
 * 无 refine、无模块语法、无兄弟调用、无任何调用表达式 → scanLiteralCalls 可整段跳过。
 * 必须保守：`const x = f(-1)` / `if (f(-1))` / `require("x")` 都含 CallExpression，
 * 只认顶层 ExpressionStatement 会漏报约束违规。
 */
export function canSkipLiteralCallScan(source: string, file: File): boolean {
  if (source.includes("@nudo:refine")) return false;
  if (hasModuleSyntax(file)) return false;
  if (hasAnyCallLike(file)) return false;
  const fps = fnFingerprints(source, file);
  for (const fp of fps.values()) {
    if (fp.nRefs > 0) return false;
  }
  return true;
}
