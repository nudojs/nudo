import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Node } from "@babel/types";
import traverse from "@babel/traverse";
import {
  type TypeValue,
  T,
  typeValueToString,
  simplifyUnion,
  collapseLiteralUnion,
  createEnvironment,
  isSubtypeOf,
  type Environment,
  generalizeFromAst,
  termToString,
  predToString,
  analyzeFnFull,
  evalProgramAbs,
  callFunctionFull,
  setAbsCallCollector,
  setBCallCollector,
  getBCallCollector,
  unknown as absUnknown,
  setAbsNodeCollector,
  absFunction,
  checkInjectedDomainEvidence,
  type AbsCallRecord,
  typeValueToAbs,
  absToTypeValue,
  joinAbs,
  formatAbs,
  formatAbsMultiline,
  formatShape,
  leqAbs,
  numLit,
  strLit,
  boolLit,
  abs as makeAbsVal,
  type Abs,
  stableAnalyzeKeySource,
  fnFingerprints,
} from "@nudojs/core";
import { parse, extractDirectives, extractFileDirectives, parseTypeValueExpr } from "@nudojs/parser";
import type { FunctionWithDirectives, SinonExpression } from "@nudojs/parser";
import {
  type CallRecord,
  absStructureKey,
  collapseAbsLits,
  isLeakedCallRecord,
  isOversizedCallRecord,
  joinAllAbs,
  neverAbs,
  undefAbs,
  widenJoinAbs,
  widenAbsPrim,
} from "./evaluator/call-record.ts";
import { loadEnvs, preloadPathEnvs } from "./evaluator/env-loader.ts";
import { findProjectConfig, interfaceConfig } from "./evaluator/config.ts";
import { resolveNpmNudo } from "./evaluator/resolve-npm.ts";
import { mockDirectivesToAbsSeeds, mockSeedsToAbsMocks } from "./mock-abs.ts";
import { defaultLoadModule } from "./load-module.ts";
import { autoHarvestModules } from "./harvest-auto.ts";
import { evalAbsModuleGraph, collectAbsBindingsFromGraph, evalProgramAbsWithModules } from "./abs-modules-graph.ts";
import { tryBPathCall, tryBPathCallFull, tryRunBPath, isBPathCapable, mockSeedFingerprint, collectEnvGlobals, collectEnvModules } from "./bpath-run.ts";
import { collectBPathDiagnostics } from "./bpath-diagnostics.ts";
import { setAbsTruncationCollector } from "@nudojs/core";
import {
  analysisCacheGet,
  analysisCacheSet,
} from "./analysis-file-cache.ts";
import {
  fnAnalysisCacheGet,
  fnAnalysisCacheSet,
  caseDirectiveKey,
  type CachedFnAnalysis,
} from "./fn-analysis-cache.ts";
export { clearFnAnalysisCache } from "./fn-analysis-cache.ts";

export type SourceLocation = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticTag = "unnecessary";

export type Diagnostic = {
  range: SourceLocation;
  severity: DiagnosticSeverity;
  message: string;
  tags?: DiagnosticTag[];
  code?: string;
  suggestions?: string[];
  data?: unknown;
  /** provenance of the receiver value (callsite argument that flowed into the error) */
  origin?: { line: number; column: number };
};

export type CaseResult = {
  name: string;
  /** 无损参数 Abs */
  argAbs: Abs[];
  /** 无损结果 Abs */
  abs: Abs;
  /** 无损抛出 Abs（未抛为 never） */
  throwsAbs: Abs;
  throwLoc?: SourceLocation;
  source?: "directive" | "callsite";
  /** `@nudo:case "name" (…) => expected` — presence means the case is a test assertion */
  expected?: Abs;
  /** number of additional call sites folded into a symbolic case */
  aggregatedFrom?: number;
  /**
   * 内涵摘要（代数 generalize）：无损 Abs + term/pred/conf。
   */
  intension?: {
    display?: string;
    term?: string;
    pred?: string;
    conf?: string;
    /** 无损 Abs 单行（formatAbs） */
    abs?: string;
    /** 无损 Abs 多行（formatAbsMultiline） */
    absMultiline?: string;
  };
};

export type FunctionAnalysis = {
  name: string;
  loc: SourceLocation;
  paramNames: string[];
  cases: CaseResult[];
  /** cases 结果 Abs 的 join；dts 返回位源 */
  combinedAbs?: Abs;
  entryOnly?: boolean;
  skipped?: boolean;
  /**
   * True for functions collected from CJS-style bindings/assignments
   * (`exports.X = fn`, `module.exports = fn`, `const f = fn`): their name has
   * no declaration-level stability, so .d.ts generation skips them while
   * infer/JSON output still reports them.
   */
  noDeclaration?: boolean;
  /** absolute path of the module this function is imported from (externalFunctions only) */
  fromModule?: string;
};

export type BindingInfo = {
  /** 无损 Abs */
  abs: Abs;
  loc?: SourceLocation;
};

export type CaseHint = {
  line: number;
  label: string;
  ok: boolean;
};

export type AnalysisResult = {
  functions: FunctionAnalysis[];
  diagnostics: Diagnostic[];
  bindings: Map<string, BindingInfo>;
  /**
   * Node identity is from the analysis-time parse. A later re-parse of the
   * same source returns a *different* File (new Nodes) if the AST LRU evicted
   * the original — lookups must use the File that produced this result, not a
   * freshly parsed one. getTypeAtPosition rebuilds its own map and is unaffected.
   */
  /** 无损节点 Abs */
  nodeAbsMap: Map<Node, Abs>;
  caseHints: CaseHint[];
  /** functions imported from other modules, synthesized from cross-file call sites observed while analyzing this file */
  externalFunctions?: FunctionAnalysis[];
};

export type CompletionItem = {
  label: string;
  kind: "property" | "method" | "variable";
  detail?: string;
};

export type SymbolInfo = {
  name: string;
  kind: "function" | "variable" | "class" | "parameter";
  loc: SourceLocation;
  uri?: string;
};

export type ReferenceInfo = {
  name: string;
  loc: SourceLocation;
  uri?: string;
};

export type SymbolTable = {
  definitions: Map<string, SymbolInfo>;
  references: ReferenceInfo[];
};

export function resolveModule(source: string, fromDir: string): { ast: ReturnType<typeof parse>; filePath: string; json?: unknown } | null {
  const extensions = [".js", ".ts", ".mjs"];

  const nudoPath = resolveNpmNudo(source, fromDir);
  if (nudoPath) {
    const src = readFileSync(nudoPath, "utf-8");
    return { ast: parse(src), filePath: nudoPath };
  }

  const basePath = resolve(fromDir, source);
  for (const ext of ["", ...extensions]) {
    const candidate = basePath + ext;
    if (!existsSync(candidate)) continue;
    // 目录：按 package.json main / index.js 解析（require('..') 模式）
    if (statSync(candidate).isDirectory()) {
      let entry: string | null = null;
      const pkgPath = resolve(candidate, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const main = JSON.parse(readFileSync(pkgPath, "utf-8")).main;
          if (typeof main === "string") {
            for (const e of ["", ...extensions]) {
              const p = resolve(candidate, main + e);
              if (existsSync(p) && statSync(p).isFile()) { entry = p; break; }
            }
          }
        } catch { /* 无效 package.json → fallback index */ }
      }
      if (!entry) {
        for (const e of ["", ...extensions]) {
          const p = resolve(candidate, "index" + e);
          if (existsSync(p) && statSync(p).isFile()) { entry = p; break; }
        }
      }
      if (!entry) return null;
      const src = readFileSync(entry, "utf-8");
      return { ast: parse(src), filePath: entry };
    }
    // .json 模块：require('../package.json') 等模式——按 JSON 求值而非 JS parse
    if (candidate.endsWith(".json")) {
      try {
        return { ast: parse("module.exports = undefined;"), filePath: candidate, json: JSON.parse(readFileSync(candidate, "utf-8")) };
      } catch {
        return null;
      }
    }
    const src = readFileSync(candidate, "utf-8");
    return { ast: parse(src), filePath: candidate };
  }
  return null;
}

/** Resolve a relative import specifier to an existing file (extension rules identical to CLI resolveModule: ''/'.js'/'.ts'/'.mjs'); null when unresolvable. */
function resolveImportPath(specifier: string, fromDir: string): string | null {
  const basePath = resolve(fromDir, specifier);
  for (const ext of ["", ".js", ".ts", ".mjs"]) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** mtime 边缓存：key 为文件路径，edges 为已抽取的相对 import 边（与 buildModuleGraph 返回语义一致）。 */
export type ModuleGraphCache = Map<string, { mtimeMs: number; size: number; edges: string[] }>;

/** Statically extract each file's relative import edges (extension resolution identical to CLI resolveModule: ''/'.js'/'.ts'/'.mjs'; bare npm specifiers skipped). */
export function buildModuleGraph(
  files: string[],
  cache?: ModuleGraphCache,
): {
  imports: Map<string, Set<string>>;
  dependents: Map<string, Set<string>>;
} {
  const imports = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const edge = (from: string, to: string) => {
    if (!imports.has(from)) imports.set(from, new Set());
    if (!dependents.has(to)) dependents.set(to, new Set());
    imports.get(from)!.add(to);
    dependents.get(to)!.add(from);
  };
  for (const file of files) {
    if (!imports.has(file)) imports.set(file, new Set());
    if (!dependents.has(file)) dependents.set(file, new Set());
    let edges: string[];
    if (cache) {
      // stat 仅取元数据不读内容；mtimeMs+size 均一致视为命中，复用边并跳过磁盘读取与解析
      let stat: ReturnType<typeof statSync> | null = null;
      try {
        stat = statSync(file);
      } catch {
        /* stat 失败（文件被删等）按未命中处理，走直读兜底 */
      }
      const cached = stat ? cache.get(file) : undefined;
      if (stat && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        edges = cached.edges;
      } else {
        edges = extractImportEdges(file);
        if (stat) cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, edges });
      }
    } else {
      edges = extractImportEdges(file);
    }
    for (const to of edges) edge(file, to);
  }
  return { imports, dependents };
}

/** 磁盘直读并解析单个文件，抽取其相对 import 边（读取/解析失败返回空数组）。 */
function extractImportEdges(file: string): string[] {
  const edges: string[] = [];
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(readFileSync(file, "utf-8"));
  } catch {
    return edges;
  }
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const specifier = stmt.source.value;
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue;
    const resolved = resolveImportPath(specifier, dirname(file));
    if (resolved) edges.push(resolved);
  }
  return edges;
}

/** changed plus its transitive dependents (reverse-edge BFS); cycle-safe via visited. */
export function computeDirtySet(dependents: Map<string, Set<string>>, changedFile: string): string[] {
  const dirty: string[] = [];
  const visited = new Set<string>();
  const queue = [changedFile];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    dirty.push(file);
    for (const dep of dependents.get(file) ?? []) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }
  return dirty;
}

/** Topological order with dependencies before dependents (only imports edges internal to dirty; cycles tolerated — remaining files appended in arbitrary order). */
export function topoSortDirty(imports: Map<string, Set<string>>, dirty: string[]): string[] {
  const inSet = new Set(dirty);
  const pending = new Map<string, number>();
  for (const file of dirty) {
    let count = 0;
    for (const dep of imports.get(file) ?? []) {
      if (inSet.has(dep)) count++;
    }
    pending.set(file, count);
  }
  const ordered: string[] = [];
  const ready = dirty.filter((f) => pending.get(f) === 0);
  while (ready.length > 0) {
    const file = ready.shift()!;
    ordered.push(file);
    for (const other of dirty) {
      if (pending.get(other) === undefined) continue;
      if ((imports.get(other) ?? new Set<string>()).has(file)) {
        const next = pending.get(other)! - 1;
        pending.set(other, next);
        if (next === 0) ready.push(other);
      }
    }
  }
  for (const file of dirty) {
    if (pending.has(file) && pending.get(file)! > 0) ordered.push(file);
  }
  return ordered;
}

/** mock 指令静态校验（B hosted 也要报 mock-invalid） */
function validateMockDirectives(
  directives: FunctionWithDirectives["directives"],
  diagnostics: Diagnostic[],
): void {
  for (const d of directives) {
    if (d.kind !== "mock" || !d.expression) continue;
    const expr = d.expression.trim();
    if (expr.includes("(") && expr.includes(")") && !expr.startsWith("T.")) {
      // 已被 parser 识别为 nudoMock/sinon/arrow 时不会带 raw expression
      diagnostics.push({
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
        severity: "warning",
        message: `Mock expression "${expr}" could not be parsed as a known pattern`,
        code: "nudo:mock-invalid",
        suggestions: [
          "Supported formats: stub(), stub().returns(value), spy(), mock()",
          "Arrow functions: (args) => expression or (args) => { statements; return value; }",
        ],
      });
    }
  }
}

function rangeKey(r: SourceLocation): string {
  return `${r.start.line}:${r.start.column}-${r.end.line}:${r.end.column}`;
}

function findCommonUnreachable(perCase: SourceLocation[][]): SourceLocation[] {
  if (perCase.length === 0) return [];
  const counts = new Map<string, { count: number; range: SourceLocation }>();
  for (const ranges of perCase) {
    for (const r of ranges) {
      const key = rangeKey(r);
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { count: 1, range: r });
      }
    }
  }
  return [...counts.values()]
    .filter((v) => v.count === perCase.length)
    .map((v) => v.range);
}

export function locFromNode(node: Node): SourceLocation {
  return {
    start: { line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 0 },
    end: { line: node.loc?.end.line ?? 1, column: node.loc?.end.column ?? 0 },
  };
}

function extractParamNames(node: Node): string[] {
  const fn = node.type === "ExportDefaultDeclaration" ? node.declaration : node;
  if (fn.type === "FunctionDeclaration" || fn.type === "FunctionExpression" || fn.type === "ArrowFunctionExpression") {
    return fn.params.map((p: any) => {
      if (p.type === "Identifier") return p.name;
      if (p.type === "AssignmentPattern" && p.left.type === "Identifier") return p.left.name;
      if (p.type === "RestElement" && p.argument.type === "Identifier") return `...${p.argument.name}`;
      return "_";
    });
  }
  if (fn.type === "VariableDeclaration") {
    const decl = fn.declarations[0];
    if (decl.init?.type === "FunctionExpression" || decl.init?.type === "ArrowFunctionExpression") {
      return decl.init.params.map((p: any) => {
        if (p.type === "Identifier") return p.name;
        if (p.type === "AssignmentPattern" && p.left.type === "Identifier") return p.left.name;
        if (p.type === "RestElement" && p.argument.type === "Identifier") return `...${p.argument.name}`;
        return "_";
      });
    }
  }
  return [];
}

function resolveFunctionNode(node: Node): Node {
  if (node.type === "ExportNamedDeclaration" && node.declaration) return resolveFunctionNode(node.declaration);
  if (node.type === "ExportDefaultDeclaration") return resolveFunctionNode(node.declaration);
  if (node.type === "VariableDeclaration") {
    const init = (node as any).declarations[0]?.init;
    if (init && (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")) return init;
  }
  return node;
}

/** 函数声明名的标识符定位（无 id 的箭头函数回退声明节点）——诊断高亮
 *  应落函数名 token，而非 function 关键字 / 参数表起点 */
function fnNameLoc(node: Node, fallback: SourceLocation): SourceLocation {
  const unwrap = (n: Node): Node =>
    n.type === "ExportNamedDeclaration" && n.declaration
      ? n.declaration
      : n.type === "ExportDefaultDeclaration"
        ? n.declaration
        : n;
  const d = unwrap(node);
  if (d.type === "VariableDeclaration") {
    const id = (d as any).declarations[0]?.id;
    if (id?.type === "Identifier" && id.loc) return id.loc;
  }
  if ((d as any).id?.loc) return (d as any).id.loc;
  return fallback;
}

function isFnExprValue(node: Node | null | undefined): node is Node {
  return !!node && (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression");
}

function namedFnExprId(node: Node): string | null {
  return node.type === "FunctionExpression" && node.id ? node.id.name : null;
}

/** `module.exports` — the only assignment target carrying no stable name of its own. */
function isModuleExportsTarget(node: Node): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    (node as any).object?.type === "Identifier" &&
    (node as any).object.name === "module" &&
    (node as any).property?.type === "Identifier" &&
    (node as any).property.name === "exports"
  );
}

function memberPropertyKey(member: Node): string | null {
  if (member.type !== "MemberExpression" || member.computed) return null;
  const prop = (member as any).property;
  if (prop?.type === "Identifier") return prop.name;
  if (prop?.type === "StringLiteral") return String(prop.value);
  return null;
}

/** Rightmost value of a chained assignment (`a = b = fn` → fn). */
function deepestAssignValue(expr: Node): Node | null {
  let cur: any = expr;
  while (cur?.type === "AssignmentExpression") cur = cur.right;
  return cur ?? null;
}

/**
 * First stable name on an assignment chain, left to right: an identifier
 * binding, or a member property that is not `module.exports` itself. Returns
 * null for chains ending in a bare `module.exports = fn` or in computed
 * members (`exports[k] = fn`) — callers fall back to "default".
 */
function assignmentChainName(expr: Node): string | null {
  let cur: any = expr;
  while (cur?.type === "AssignmentExpression") {
    const target = cur.left;
    if (target.type === "Identifier") return target.name;
    if (target.type === "MemberExpression") {
      if (isModuleExportsTarget(target)) {
        cur = cur.right;
        continue;
      }
      return memberPropertyKey(target);
    }
    return null;
  }
  return null;
}

/**
 * Top-level functions eligible for case synthesis. Besides FunctionDeclarations
 * this collects CJS-style function bindings:
 *
 *   const f = function () {};                           // declarator init
 *   exports.applyToDefaults = function (a, b) {};       // namespace property
 *   module.exports = internals.clone = function () {};  // chained export
 *
 * Naming: identifier bindings win (call sites dispatch on them, and the
 * evaluator's call records key on the callee identifier); a named function
 * expression's own id beats a member property name; a bare
 * `module.exports = fn` becomes "default" (ESM default-export analogue).
 * Collected non-declaration entries carry `noDeclaration` — see FunctionAnalysis.
 *
 * v1 limitation: `internals.clone()`-style member calls go through method
 * dispatch and never produce call records, so such functions fall back to the
 * entry@ evaluation; same-file `X(...)` calls after `exports.X = fn` are not
 * tracked either.
 */
function collectTopLevelFunctions(ast: Node): { name: string; node: Node; stmt: Node; noDeclaration: boolean }[] {
  const results: { name: string; node: Node; stmt: Node; noDeclaration: boolean }[] = [];
  if (ast.type !== "File") return results;
  for (const stmt of (ast as any).program.body) {
    const decl = resolveFunctionNode(stmt);
    if (decl.type === "FunctionDeclaration" && decl.id) {
      results.push({ name: decl.id.name, node: decl, stmt, noDeclaration: false });
      continue;
    }
    if (stmt.type === "VariableDeclaration") {
      for (const declarator of (stmt as any).declarations) {
        if (declarator.id?.type === "Identifier" && isFnExprValue(declarator.init)) {
          results.push({ name: declarator.id.name, node: declarator.init, stmt, noDeclaration: true });
        }
      }
      continue;
    }
    if (stmt.type === "ExpressionStatement" && (stmt as any).expression?.type === "AssignmentExpression") {
      const expr = (stmt as any).expression as Node;
      const fn = deepestAssignValue(expr);
      if (isFnExprValue(fn)) {
        const name = namedFnExprId(fn) ?? assignmentChainName(expr) ?? "default";
        results.push({ name, node: fn, stmt, noDeclaration: true });
      }
    }
  }
  return results;
}

/** The function value of the file's single `module.exports = <function>`
 * top-level assignment, when there is exactly one. Assigning module.exports
 * replaces the whole exports object, so such a file exports exactly that one
 * function and usage-site records may reach it under any re-export name —
 * matching by targetModule alone is then unambiguous. Returns null for
 * multi-export shapes (no such assignment, several, or `module.exports =
 * {...}`), where a name/alias match is still required so sibling functions
 * don't get misattributed. */
function findSingleModuleExportsFunction(ast: Node): Node | null {
  if (ast.type !== "File") return null;
  let found: Node | null = null;
  for (const stmt of (ast as any).program.body) {
    if (stmt.type !== "ExpressionStatement") continue;
    const expr = (stmt as any).expression;
    if (expr?.type !== "AssignmentExpression") continue;
    const fn = deepestAssignValue(expr);
    if (!isFnExprValue(fn)) continue;
    let targetsModuleExports = false;
    let cur: any = expr;
    while (cur?.type === "AssignmentExpression") {
      if (isModuleExportsTarget(cur.left)) {
        targetsModuleExports = true;
        break;
      }
      cur = cur.right;
    }
    if (!targetsModuleExports) continue;
    if (found) return null; // a second `module.exports = fn` → ambiguous
    found = fn;
  }
  return found;
}

function typeStructureKey(tv: TypeValue): string {
  // Self-referential structures (x.y = x surviving a clone) would recurse
  // infinitely: a seen-set renders revisits as a cycle token.
  return typeStructureKeyUncached(tv, new Set());
}

function typeStructureKeyUncached(tv: TypeValue, seen: Set<object>): string {
  // Path-scoped seen-set (backtracked after each expansion): a node renders
  // as a cycle token only while its own expansion is on the stack, so
  // shared singletons keep their full key.
  const enter = (inner: TypeValue): string => {
    if (inner && typeof inner === "object") {
      if (seen.has(inner)) return "«cycle»";
      seen.add(inner);
      const out = typeStructureKeyUncached(inner, seen);
      seen.delete(inner);
      return out;
    }
    return typeStructureKeyUncached(inner, seen);
  };
  switch (tv.kind) {
    case "literal":
      return `lit(${typeof tv.value}:${String(tv.value)})`;
    case "primitive":
      return `prim(${tv.type})`;
    case "array":
      return `arr(${enter(tv.element)})`;
    case "tuple":
      return `tup(${tv.elements.map(enter).join(",")})`;
    case "object":
      return `obj(${Object.keys(tv.properties).sort().map((k) => `${k}:${enter(tv.properties[k])}`).join(",")})`;
    case "function":
      return `fn(${tv.params.join(",")})`;
    case "promise":
      return `prom(${enter(tv.value)})`;
    case "instance":
      return `inst(${tv.className})`;
    case "refined":
      return `ref(${enter(tv.base)})`;
    case "union":
      return `uni(${tv.members.map(enter).sort().join("|")})`;
    default:
      return tv.kind;
  }
}

const MAX_PRECISE_CALLSITE_CASES = 3;
const COLLAPSE_LITERAL_THRESHOLD = 4;

function dedupeCallRecords(records: CallRecord[]): CallRecord[] {
  const seen = new Set<string>();
  const out: CallRecord[] = [];
  for (const rec of records) {
    // Abs DAG 共享会指数膨胀树形 key；超大记录在 key 前丢弃。
    if (isOversizedCallRecord(rec)) continue;
    // key 必须含结果形态：同实参形状但不同结果（错误路径 never+throws vs
    // 成功路径 Promise<...>）是不同的 case，只按实参去重会把成功记录吞进
    // 首条错误记录里（parseChunked 的 Promise 记录曾被 L203 的 throw 吞掉）。
    const key =
      rec.argAbs.map(absStructureKey).join(",") +
      "=>" +
      absStructureKey(rec.resultAbs) +
      "!" +
      absStructureKey(rec.throwsAbs);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

function locFromCallLoc(loc: { line: number; column: number } | undefined): SourceLocation {
  const p = loc ?? { line: 0, column: 0 };
  return { start: { line: p.line, column: p.column }, end: { line: p.line, column: p.column } };
}

/**
 * Cross-file call-site aggregation: call records whose callee is a function
 * exported by another module (tagged by the evaluator's export side table)
 * are grouped by (targetModule, targetExport) and synthesized directly into
 * FunctionAnalysis entries — no re-evaluation needed, each CallRecord already
 * carries the resultAbs/throwsAbs computed when this file was evaluated.
 *
 * v1 limitation: only named-import direct calls are recorded by the
 * evaluator; `import * as ns` member calls go through the method path and
 * never reach this synthesis.
 */
function synthesizeExternalFunctions(records: CallRecord[], currentFile: string): FunctionAnalysis[] {
  const groups = new Map<string, { module: string; exportName: string; records: CallRecord[] }>();
  for (const rec of records) {
    if (!rec.targetModule || !rec.targetExport) continue;
    if (rec.targetModule === currentFile) continue;
    const key = `${rec.targetModule}\0${rec.targetExport}`;
    let group = groups.get(key);
    if (!group) {
      group = { module: rec.targetModule, exportName: rec.targetExport, records: [] };
      groups.set(key, group);
    }
    group.records.push(rec);
  }

  const out: FunctionAnalysis[] = [];
  for (const { module, exportName, records } of groups.values()) {
    const deduped = dedupeCallRecords(records);
    const arity = Math.max(...deduped.map((r) => r.argAbs.length));
    const analysis: FunctionAnalysis = {
      name: exportName,
      loc: locFromCallLoc(deduped[0].callLoc),
      paramNames: Array.from({ length: arity }, (_, i) => `arg${i}`),
      cases: [],
      fromModule: module,
    };

    // Same capping as local synthesis: at most MAX_PRECISE_CALLSITE_CASES
    // precise cases. The symbolic aggregate cannot re-evaluate the foreign
    // function (its AST belongs to another file's analysis), so it unions the
    // observed argument/result/throws Abs of the remaining records instead.
    const precise = deduped.slice(0, MAX_PRECISE_CALLSITE_CASES);
    for (const rec of precise) {
      analysis.cases.push({
        name: `call@L${rec.callLoc?.line ?? 0}`,
        argAbs: [...rec.argAbs],
        abs: rec.resultAbs,
        throwsAbs: rec.throwsAbs,
        source: "callsite",
      });
    }
    const remaining = deduped.slice(MAX_PRECISE_CALLSITE_CASES);
    if (remaining.length > 0) {
      const symArgsAbs = Array.from({ length: arity }, (_, i) =>
        // 缺参按真实 JS 语义 widen 成 undefined 而非 unknown——可选参守卫
        // （target || [] 等）对 unknown 全塌，对 undefined 正常走默认分支
        widenJoinAbs(remaining.map((rec) => rec.argAbs[i] ?? undefAbs)),
      );
      const symResultAbs = collapseAbsLits(
        remaining.map((r) => r.resultAbs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
      const symThrowsAbs = joinAllAbs(remaining.map((r) => r.throwsAbs));
      analysis.cases.push({
        name: "call@symbolic",
        argAbs: symArgsAbs,
        abs: symResultAbs,
        throwsAbs: symThrowsAbs,
        source: "callsite",
        aggregatedFrom: remaining.length,
      });
    }

    if (deduped.length > 1) {
      analysis.combinedAbs = collapseAbsLits(
        deduped.map((r) => r.resultAbs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
    } else {
      analysis.combinedAbs = deduped[0].resultAbs;
    }
    out.push(analysis);
  }
  return out;
}

function receiverTypeToDisplay(tv: TypeValue): string {
  switch (tv.kind) {
    case "literal": {
      const v = tv.value;
      if (v === null) return "null";
      if (v === undefined) return "undefined";
      return typeof v;
    }
    case "union":
      return tv.members.map(receiverTypeToDisplay).join(" | ");
    default:
      return typeValueToString(tv);
  }
}

function receiverIsConcrete(tv: TypeValue): boolean {
  if (tv.kind === "unknown") return false;
  if (tv.kind === "union") return tv.members.every((m) => m.kind !== "unknown");
  return true;
}

export function collectEnvNames(filePath: string, source: string, includeProject: boolean): string[] {
  const ast = parse(source);
  const fileDirectives = extractFileDirectives(ast);
  const fileEnvNames = fileDirectives
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);
  if (!includeProject) return fileEnvNames;
  const projectConfig = findProjectConfig(dirname(filePath));
  const projectEnvNames = projectConfig?.config.env ?? [];
  return [...new Set([...projectEnvNames, ...fileEnvNames])];
}

/**
 * Async entry to analyzeFile: preloads path-based env files
 * (`/// @nudo:env ./nudo-harvest-node.ts`) via dynamic import — impossible
 * synchronously in ESM — then runs the sync analysis, which picks the
 * preloaded factories up from the env-loader cache. The sync analyzeFile
 * signature is unchanged for existing consumers (LSP, MCP, vite-plugin).
 */
export async function analyzeFileAsync(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
): Promise<AnalysisResult> {
  const envNames = collectEnvNames(filePath, source, true);
  if (envNames.length > 0) {
    await preloadPathEnvs(envNames, dirname(filePath));
  }
  return analyzeFile(filePath, source, activeCases, externalCallRecords);
}

/**
 * 调用点发现（阶段一）：在"使用现场"文件（测试 / 上层应用）中求值
 * 顶层代码，收集它对（外部模块导出的）函数的调用记录。每条记录带
 * 真实的实参类型与结果类型——后续 analyzeFile 将其注入合成 case，
 * 使被使用方从 entry-only（参数全 unknown）升级为真实调用形态。
 *
 * Abs 路径（TypeValue evaluateProgram 已删）：evalProgramAbs + AbsCallRecord。
 * 只做求值与记录，不产出诊断；求值异常不抛出（使用现场文件可能
 * 依赖未 mock 的全局，收集不到就收集不到，不能拖垮主分析）。
 */
export function collectCallRecords(filePath: string, source: string): CallRecord[] {
  // CJS require 使用现场：B-path transpile+exec（Abs ast-eval 不建模 require）
  if (/\brequire\s*\(/.test(source) && filePath) {
    try {
      const run = tryRunBPath(source, filePath, { mode: "exec" });
      if (run?.calls?.length) {
        const importLocals = buildAbsImportLocalMap(source, filePath);
        return run.calls.map((r) => callRecordFromAbsCall(r, importLocals));
      }
    } catch {
      /* fall through to Abs path */
    }
  }

  // 使用现场可能是老 CJS（八进制字面量等历史语法）——宽松恢复模式
  let ast: ReturnType<typeof parse> | undefined;
  try {
    ast = parse(source, { errorRecovery: true });
  } catch {
    return [];
  }
  const absCalls: AbsCallRecord[] = [];
  const prevCollector = setAbsCallCollector((r) => absCalls.push(r));
  let importLocals: Map<string, { modulePath: string; exportName: string }> | undefined;
  try {
    importLocals = buildAbsImportLocalMap(source, filePath);
    let modules: Record<string, import("@nudojs/core").AbsModuleExports> | undefined;
    try {
      modules = evalAbsModuleGraph(source, filePath).modules;
    } catch {
      modules = undefined;
    }
    const { env } = evalProgramAbs(source, { file: ast as never, modules });
    // 测试框架语义近似：it/describe/test 的回调在顶层求值中不会执行，
    // 但它们的函数体正是真实调用点所在。以 unknown 参数手动执行每个
    // 回调体；describe 回调体内嵌的 it(...) 继续展开（测试常嵌套）。
    const runCallbacks = (statements: Node[]): void => {
      for (const stmt of statements) {
        if (stmt.type !== "ExpressionStatement" || !("expression" in stmt)) continue;
        const expr = (stmt as { expression: Node }).expression;
        if (expr.type !== "CallExpression") continue;
        const callee = (expr as Node & { callee: Node }).callee;
        if (callee.type !== "MemberExpression" && callee.type !== "Identifier") continue;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.property.type === "Identifier"
              ? callee.property.name
              : null;
        if (!name || !TEST_CALLBACK_NAMES.has(name)) continue;
        const args = (expr as { arguments: Node[] }).arguments;
        const cb = args.find((a) => a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression") as
          | (Node & { body: Node; params?: Node[] })
          | undefined;
        if (!cb) continue;
        try {
          const params = (cb.params ?? []).map((p) =>
            p.type === "Identifier" ? p.name : `_arg${Math.random().toString(36).slice(2, 6)}`,
          );
          const tmpName = `__nudo_test_cb_${absCalls.length}`;
          env.fns.set(tmpName, {
            params,
            body: cb.body as never,
            async: false,
          });
          callFunctionFull(env, tmpName, params.map(() => absUnknown));
        } catch {
          /* 单个回调失败不影响其余 */
        }
        // describe 回调体是语句列表——递归展开嵌套的 it/describe
        if (name === "describe" && cb.body.type === "BlockStatement") {
          runCallbacks((cb.body as unknown as { body: Node[] }).body);
        }
      }
    };
    runCallbacks(ast.program.body as unknown as Node[]);
  } catch {
    /* 收集尽力而为 */
  } finally {
    setAbsCallCollector(prevCollector);
  }
  return absCalls.map((r) => callRecordFromAbsCall(r, importLocals));
}

/** 测试框架的回调注册函数：回调体里是真实调用点 */
const TEST_CALLBACK_NAMES = new Set(["it", "test", "describe"]);

// --- 整文件 AnalysisResult memo（warm analyzeFile / LSP 重复文档） ---

const externalRecordIds = new WeakMap<object, number>();
let nextExternalRecordId = 1;

function analysisFileCacheKey(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
): { filePath: string; source: string; auxKey: string } {
  let cases = "-";
  if (activeCases && activeCases.size > 0) {
    cases = [...activeCases.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
  }
  let ext = "-";
  if (externalCallRecords && externalCallRecords.length > 0) {
    let id = externalRecordIds.get(externalCallRecords);
    if (id === undefined) {
      id = nextExternalRecordId++;
      externalRecordIds.set(externalCallRecords, id);
    }
    ext = `n${externalCallRecords.length}#id${id}`;
  }
  return {
    filePath,
    // 尾部无 @nudo 注释/空行不进键：comment-only 编辑命中 AnalysisResult
    source: stableAnalyzeKeySource(source),
    auxKey: `${cases}\0${ext}`,
  };
}

function cloneAnalysisResult(r: AnalysisResult): AnalysisResult {
  return {
    functions: r.functions.map(cloneFunctionAnalysis),
    diagnostics: r.diagnostics.map((d) => ({ ...d })),
    bindings: new Map(r.bindings),
    // Node 键与 AST LRU 共享身份；Map 浅拷贝即可
    nodeAbsMap: new Map(r.nodeAbsMap),
    caseHints: r.caseHints.map((h) => ({ ...h })),
    ...(r.externalFunctions
      ? { externalFunctions: r.externalFunctions.map(cloneFunctionAnalysis) }
      : {}),
  };
}

// --- 函数级 FunctionAnalysis 缓存（body-edit：只重算脏函数及其调用者） ---

function cloneFunctionAnalysis(a: FunctionAnalysis): FunctionAnalysis {
  return {
    ...a,
    paramNames: [...a.paramNames],
    cases: a.cases.map((c) => ({
      ...c,
      argAbs: [...c.argAbs],
      ...(c.intension ? { intension: { ...c.intension } } : {}),
    })),
    loc: { start: { ...a.loc.start }, end: { ...a.loc.end } },
  };
}

function shiftSourceLoc(loc: SourceLocation, lineDelta: number): SourceLocation {
  return {
    start: { line: loc.start.line + lineDelta, column: loc.start.column },
    end: { line: loc.end.line + lineDelta, column: loc.end.column },
  };
}

function shiftDiagnosticLines(d: Diagnostic, lineDelta: number): Diagnostic {
  if (lineDelta === 0) return { ...d };
  const out: Diagnostic = { ...d, range: shiftSourceLoc(d.range, lineDelta) };
  if (d.origin) {
    out.origin = { line: d.origin.line + lineDelta, column: d.origin.column };
  }
  return out;
}

function shiftCallRecordLines(r: CallRecord, lineDelta: number): CallRecord {
  if (lineDelta === 0 || !r.callLoc) return { ...r };
  return {
    ...r,
    callLoc: { line: r.callLoc.line + lineDelta, column: r.callLoc.column },
  };
}

/**
 * 整文件分析。同 (path, source, cases, external) 命中 memo → O(1)。
 * 不再每次 clearBPathCache：B 路径按本文件 source 键控。
 *
 * 宿主契约：入口 source 未变但依赖模块内容变了时，必须调用
 * `evictBPathCacheForFiles` / `evictAnalysisFileCacheForFiles` /
 * `evictFnAnalysisCacheForFiles`（LSP 已接好）。非 LSP 宿主
 * （CLI watch / vite-plugin）在 dep 变更时应 `clearBPathCache()` 或上述逐出。
 */
export function analyzeFile(filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[]): AnalysisResult {
  const k = analysisFileCacheKey(filePath, source, activeCases, externalCallRecords);
  const hit = analysisCacheGet<AnalysisResult>(k.filePath, k.source, k.auxKey);
  if (hit !== undefined) {
    return cloneAnalysisResult(hit);
  }
  const result = analyzeFileUncached(filePath, source, activeCases, externalCallRecords);
  analysisCacheSet(k.filePath, k.source, k.auxKey, result);
  return cloneAnalysisResult(result);
}

function analyzeFileUncached(filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[]): AnalysisResult {
  const ast = parse(source);
  const functions = extractDirectives(ast);
  const diagnostics: Diagnostic[] = [];
  const bindings = new Map<string, BindingInfo>();
  const nodeAbsMap = new Map<Node, Abs>();
  const functionResults: FunctionAnalysis[] = [];
  const caseHints: CaseHint[] = [];

  const fileDirectives = extractFileDirectives(ast);
  const fileEnvNames = fileDirectives
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);

  const projectConfig = findProjectConfig(dirname(filePath));
  const projectEnvNames = projectConfig?.config.env ?? [];
  const envNames = [...new Set([...projectEnvNames, ...fileEnvNames])];

  const callRecords: CallRecord[] = [];
  // TypeValue env 仅作 BindingInfo.type 的外延占位（Abs 绑定另走 absBinds）
  const globalEnv = createEnvironment();

  /** B 路径已报告的 method/property 名（避免 TypeValue 双报） */
  const bMemberDiagNames = new Set<string>();
  const bMemberDiagSeen = new Set<string>();
  const pushBMemberDiag = (d: { kind: string; name: string; receiver: string; line?: number; column?: number; origin?: { line: number; column: number } }, fallbackLine: number) => {
    bMemberDiagNames.add(d.name);
    const key = `${d.kind}:${d.name}:${d.receiver}:${d.line ?? fallbackLine}:${d.column ?? 0}`;
    if (bMemberDiagSeen.has(key)) return;
    bMemberDiagSeen.add(key);
    // unknown 接收者 → unknown-recv（与 TypeValue 口径一致，warning）
    if (d.receiver === "unknown") {
      diagnostics.push({
        range: {
          start: { line: d.line ?? fallbackLine, column: d.column ?? 0 },
          end: { line: d.line ?? fallbackLine, column: (d.column ?? 0) + d.name.length },
        },
        severity: "warning",
        message: `Cannot resolve '${d.name}' on unknown value`,
        code: "nudo:unknown-recv",
        ...(d.origin ? { origin: d.origin } : {}),
      });
      return;
    }
    diagnostics.push({
      range: {
        start: { line: d.line ?? fallbackLine, column: d.column ?? 0 },
        end: { line: d.line ?? fallbackLine, column: (d.column ?? 0) + d.name.length },
      },
      severity:
        d.receiver === "number" || d.receiver === "boolean" || d.receiver === "bigint" || d.receiver === "symbol"
          ? "error"
          : "warning",
      message:
        d.kind === "method"
          ? `Method '${d.name}' does not exist on type '${d.receiver}'`
          : `Property '${d.name}' does not exist on type '${d.receiver}'`,
      code: "nudo:no-method",
      ...(d.origin ? { origin: d.origin } : {}),
    });
  };

  // @nudo:mock 静态校验始终执行（B hosted 也要报 mock-invalid）
  for (const fn of functions) {
    validateMockDirectives(fn.directives, diagnostics);
  }

  // @nudo:mock 已编译为 Abs seed 注入（mockDirectivesToAbsSeeds）；无 TypeValue applyMocks。
  const selfContained = isSelfContainedSource(source, envNames);
  const canAbsModules = absModulesOk(source, envNames);
  const bCapable = isBPathCapable(source, envNames);

  /** B 已上报的模块加载问题种类 + 递归截断函数名（压 TypeValue 叠报） */
  const bModuleIssueKinds = new Set<"cycle" | "depth" | "missing">();
  const bTruncatedFns = new Set<string>();
  /** B 静态 builtin-unknown 名（压 TypeValue unknown-global 叠报） */
  const bBuiltinUnknownNames = new Set<string>();
  /** B 成功跑通本文件 → TypeValue method/property 诊断整类让位 */
  let bHostedEval = false;

  const pushBModuleIssues = (
    issues: Array<{ kind: "cycle" | "depth" | "missing"; label: string; reason: string }> | undefined,
  ) => {
    if (!issues) return;
    for (const iss of issues) {
      bModuleIssueKinds.add(iss.kind);
      const code =
        iss.kind === "cycle"
          ? "nudo:module-cycle"
          : iss.kind === "depth"
            ? "nudo:module-depth"
            : "nudo:module-missing";
      diagnostics.push({
        range: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
        severity: iss.kind === "missing" ? "error" : "warning",
        message: iss.reason,
        code,
      });
    }
  };

  const seeds = mockDirectivesToAbsSeeds(functions);
  let absCallRecords: CallRecord[] = [];
  /** B 顶层 $callNamed 记录（call@ 合成；TypeValue skip 后的主源） */
  let bTopCallRecords: CallRecord[] = [];
  /** 一次模块图 + 一次 evalProgramAbs 的共享产物（避免 B 路径 4+ 次重求值） */
  let absGraphModules: Record<string, import("@nudojs/core").AbsModuleExports> | undefined;
  let absBindsShared: Map<string, Abs> | undefined;
  let absNodesShared: Map<Node, Abs> | undefined;

  // B 模块图：cycle/depth/missing + 顶层 memberDiags（注入 @nudo:mock，
  // 避免缩进 const 调到真 fetch；$callNamed 实参 loc 提供参数级 provenance）
  if (bCapable && filePath) {
    try {
      const g = evalAbsModuleGraph(source, filePath, {
        seedVars: seeds.seedVars,
        seedFns: seeds.seedFns as never,
      });
      // env modules 必须并入图：@nudo:env 的 node:* / 裸包由 loadEnvs 提供，
      // 模块图只处理相对 import 与 harvest 裸包（跳过 node: 前缀）
      absGraphModules = { ...collectEnvModules(envNames), ...g.modules };
      pushBModuleIssues(g.issues);
    } catch {
      /* 模块图失败交还 TypeValue */
    }
    const bRun = tryRunBPath(source, filePath, {
      envNames,
      mocks: mockSeedsToAbsMocks(seeds),
    });
    if (bRun) {
      bHostedEval = true;
      if (bRun.memberDiags?.length) {
        for (const d of bRun.memberDiags) {
          pushBMemberDiag(d, 1);
        }
      }
      if (bRun.truncatedFns) {
        for (const fn of bRun.truncatedFns) bTruncatedFns.add(fn);
      }
      if (bRun.calls?.length) {
        const impMap = buildAbsImportLocalMap(source, filePath);
        for (const c of bRun.calls) {
          bTopCallRecords.push(callRecordFromAbsCall(c, impMap));
        }
      }
    }
  }
  if (selfContained || canAbsModules) {
    // Abs 程序求值的递归截断（call@ 记录路径）；modules 已预计算时不再重跑模块图
    setAbsTruncationCollector((label) => bTruncatedFns.add(label));
    try {
      absCallRecords = collectAbsCallRecords(source, seeds, filePath, absGraphModules, envNames);
    } finally {
      setAbsTruncationCollector(null);
    }
  }

  // B hosted：跳过 TypeValue evaluateProgram。一次 eval 同时产出 bindings + nodeTypes。
  if (bHostedEval) {
    try {
      const collected = collectAbsBindsAndNodes(source, seeds, absGraphModules);
      absBindsShared = collected.binds;
      absNodesShared = collected.nodes;
      for (const [name, absVal] of absBindsShared) {
        if (absVal?.shape?.k === "fn") continue;
        if (!globalEnv.has(name)) {
          globalEnv.bind(name, absVal);
        }
      }
      for (const [node, absVal] of absNodesShared) {
        nodeAbsMap.set(node, absVal);
      }
    } catch {
      /* Abs 补齐失败仍以 B 诊断为准 */
    }
  }
  // TypeValue evaluateProgram / applyMocks 已删除：非 B-hosted 源不跑全程序求值；
  // 绑定/节点靠 Abs 宿主（collectAbsBindsAndNodes）。case 兜底 Abs-first。

  // Abs / B 顶层调用记录优先；再空才保留 TypeValue
  if ((selfContained || canAbsModules) && absCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...absCallRecords);
  } else if (bTopCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...bTopCallRecords);
  }

  const unreachableRanges: SourceLocation[] = [];
  if (bCapable) {
    // B 路径静态诊断接管 unreachable + builtin-unknown
    // env/mock 已覆盖的全局不在 builtin-unknown 之列（B 注入后不再是裸原生调用）
    const bKnownGlobals = new Set<string>([
      ...Object.keys(collectEnvGlobals(envNames)),
      ...Object.keys(mockSeedsToAbsMocks(seeds)),
    ]);
    const bDiag = collectBPathDiagnostics(source, bKnownGlobals);
    for (const ur of bDiag.unreachable) {
      diagnostics.push({
        range: ur.range,
        severity: "info",
        message: "Code after return/throw statement is unreachable",
        tags: ["unnecessary"],
        code: "nudo-unreachable",
        suggestions: ["Remove the unreachable code after the return/throw statement"],
      });
    }
    for (const b of bDiag.builtinUnknown) {
      bBuiltinUnknownNames.add(b.name);
      diagnostics.push({
        range: b.range,
        severity: "warning",
        message: `Built-in API "${b.name}" is not covered by Nudo's type inference`,
        code: "nudo:builtin-unknown",
        suggestions: [
          `Use @nudo:mock to define the type: @nudo:mock ${b.name} = stub().returns(...)`,
          `Or use @nudo:refine return <constraint> to declare the return contract`,
        ],
      });
    }
  } else {
    for (const ur of unreachableRanges) {
      diagnostics.push({
        range: ur,
        severity: "info",
        message: "Code after return/throw statement is unreachable",
        tags: ["unnecessary"],
        code: "nudo-unreachable",
        suggestions: ["Remove the unreachable code after the return/throw statement"],
      });
    }
  }

  // Abs 宿主补齐（T15）：B 未成功宿主时仍收集 Abs 绑定/节点表——
  // BindingInfo.abs / nodeAbsMap / hover / completions 不必等 B 成功。
  if (!absNodesShared && !bHostedEval && (selfContained || canAbsModules)) {
    try {
      const collected = collectAbsBindsAndNodes(source, seeds, absGraphModules);
      if (!absBindsShared) absBindsShared = collected.binds;
      absNodesShared = collected.nodes;
    } catch {
      /* Abs 补齐失败仍以 TypeValue 为准 */
    }
  }

  collectBindings(ast, globalEnv, bindings, absBindsShared);

  // B 路径可分析：用 Abs 模块图补全/覆盖绑定（含相对 import）
  if (isBPathCapable(source, envNames)) {
    try {
      const absBinds =
        absBindsShared ??
        collectAbsBindingsFromGraph(source, filePath, {
          seedVars: seeds.seedVars,
          seedFns: seeds.seedFns as never,
        });
      for (const [name, absVal] of absBinds) {
        const prev = bindings.get(name);
        bindings.set(name, {
          abs: absVal,
          loc: prev?.loc,
        });
      }
    } catch {
      /* keep TypeValue bindings */
    }
  }

  const synthCandidates: { name: string; node: Node; analysis: FunctionAnalysis }[] = [];

  // 函数级指纹：body-edit 时未引用的兄弟函数可命中缓存
  let fnFpMap: Map<string, { own: string; deps: string }> | undefined;
  try {
    fnFpMap = fnFingerprints(source, ast as never);
  } catch {
    fnFpMap = undefined;
  }
  const envKeyFn = envNames.join(",");
  const mockKeyFn = mockSeedFingerprint(seeds.seedVars, seeds.seedFns);

  for (const fn of functions) {
    const isPure = fn.directives.some((d) => d.kind === "pure");
    const skipDirective = fn.directives.find((d) => d.kind === "skip");

    const fnLoc = locFromNode(fn.node);
    const paramNames = extractParamNames(fn.node);
    const analysis: FunctionAnalysis = { name: fn.name, loc: fnLoc, paramNames, cases: [] };

    if (skipDirective && skipDirective.kind === "skip") {
      analysis.skipped = true;
      if (skipDirective.returns) {
        analysis.combinedAbs = typeValueToAbs(skipDirective.returns);
      }
      functionResults.push(analysis);
      continue;
    }

    const caseDirectives = fn.directives.filter((d) => d.kind === "case");
    const activeCaseIdx = activeCases?.get(fn.name) ?? 0;

    // Per-fn cache is intentionally case-scoped: synthesized cases (no
    // @nudo:case) are built from whole-file call records observed while
    // evaluating *other* functions — own/deps fingerprints cannot see those
    // call sites, so caching a synthesis result under own/deps would be
    // unsound (sibling body-edit that changes a call to this fn would miss
    // the fingerprint). Case-directive results are self-contained.
    const fp = fnFpMap?.get(fn.name);
    const fnCacheKey =
      fp && caseDirectives.length > 0
        ? [
            filePath,
            fp.own,
            fp.deps,
            String(activeCaseIdx),
            caseDirectiveKey(caseDirectives, formatAbs),
            envKeyFn,
            mockKeyFn,
          ].join("\0")
        : undefined;
    const dLen0 = diagnostics.length;
    const hLen0 = caseHints.length;
    const cLen0 = callRecords.length;

    if (fnCacheKey) {
      const hitFn = fnAnalysisCacheGet(fnCacheKey);
      if (hitFn) {
        const cached = cloneFunctionAnalysis(hitFn.analysis as FunctionAnalysis);
        // own-hash is position-free: sibling inserts shift lines. Rewrite loc
        // onto the current AST and shift any cached line-relative fields.
        const lineDelta = fnLoc.start.line - cached.loc.start.line;
        cached.loc = fnLoc;
        if (lineDelta !== 0) {
          for (const c of cached.cases) {
            if (c.throwLoc) c.throwLoc = shiftSourceLoc(c.throwLoc, lineDelta);
          }
        }
        if (lineDelta === 0) {
          diagnostics.push(...(hitFn.diagnostics as Diagnostic[]));
          caseHints.push(...(hitFn.caseHints as CaseHint[]));
          callRecords.push(...(hitFn.callRecords as CallRecord[]));
        } else {
          for (const d of hitFn.diagnostics as Diagnostic[]) {
            diagnostics.push(shiftDiagnosticLines(d, lineDelta));
          }
          for (const h of hitFn.caseHints as CaseHint[]) {
            caseHints.push({ ...h, line: h.line + lineDelta });
          }
          for (const r of hitFn.callRecords as CallRecord[]) {
            callRecords.push(shiftCallRecordLines(r, lineDelta));
          }
        }
        functionResults.push(cached);
        continue;
      }
    }

    if (isPure) {
      const fnVal = globalEnv.has(fn.name) ? globalEnv.lookup(fn.name) : null;
      if (fnVal && fnVal.shape.k === "fn") {
        (fnVal as any)._memoize = fn.name;
      }
    }

    const sampleDirective = fn.directives.find((d) => d.kind === "sample");
    void sampleDirective; // TypeValue setSampleCount 已删

    if (caseDirectives.length === 0) {
      synthCandidates.push({ name: fn.name, node: fn.node, analysis });
    }

    for (let ci = 0; ci < caseDirectives.length; ci++) {
      const directive = caseDirectives[ci];

      let caseAbs: Abs | undefined;
      let caseThrowsAbs: Abs | undefined;
      let caseThrowLoc: SourceLocation | undefined;
      let caseUnreachable: SourceLocation[] = [];

      const bCapable = isBPathCapable(source, envNames);
      const bPrimary = bCapable;
      if (bCapable && filePath) {
        const caseArgsAbs = directive.argsAbs;
        const bFull = tryBPathCallFull(
          source,
          filePath,
          fn.name,
          caseArgsAbs,
          { collectCalls: true, envNames, mocks: mockSeedsToAbsMocks(seeds) },
        );
        const res = bFull?.result;
        const weakUnknown =
          !!res &&
          res.shape.k === "unknown" &&
          (!res.term || (res.term.op === "lit" && res.term.value === undefined));
        const bOk = !!res && (bHostedEval || (!weakUnknown && res.conf !== "opaque"));
        if (bOk && bFull && bPrimary) {
          caseAbs = bFull.result;
          caseThrowsAbs = bFull.throws;
          for (const d of bFull.memberDiags ?? []) {
            pushBMemberDiag(d, fnLoc.start.line);
          }
          if (bFull.calls?.length) {
            const impMap = buildAbsImportLocalMap(source, filePath);
            for (const c of bFull.calls) {
              callRecords.push(callRecordFromAbsCall(c, impMap));
            }
          }
        }
      }

      if (!caseAbs) {
        if (bHostedEval) {
          caseAbs = absUnknown;
          caseThrowsAbs = neverAbs;
        } else {
          const caseArgsAbs = directive.argsAbs;
          const absFull = (selfContained || canAbsModules)
            ? tryEvalAbsFull(
                source,
                fn.name,
                caseArgsAbs,
                filePath,
                mockSeedsToAbsMocks(seeds),
              )
            : undefined;
          const weak =
            !!absFull &&
            absFull.result.shape.k === "unknown" &&
            (!absFull.result.term ||
              (absFull.result.term.op === "lit" && absFull.result.term.value === undefined));
          const absOk =
            !!absFull &&
            !weak &&
            absFull.result.conf !== "opaque" &&
            absFull.throws.shape.k === "never";
          const absThrew =
            !!absFull &&
            !weak &&
            absFull.result.shape.k === "never" &&
            absFull.throws.shape.k !== "never";
          if (absOk) {
            caseAbs = absFull.result;
            caseThrowsAbs = neverAbs;
          } else if (absThrew) {
            caseAbs = absFull!.result; // never
            caseThrowsAbs = absFull!.throws;
            const tl = absFull!.throwLoc;
            if (tl) caseThrowLoc = { start: { ...tl }, end: { ...tl } };
          } else {
            caseAbs = absUnknown;
            caseThrowsAbs = neverAbs;
          }
        }
      }
      if (!caseThrowsAbs) caseThrowsAbs = neverAbs;

      const caseEntry: CaseResult = {
        name: directive.name,
        argAbs: directive.argsAbs,
        abs: caseAbs,
        throwsAbs: caseThrowsAbs,
        throwLoc: caseThrowLoc,
        expected: directive.expected,
        source: "directive",
      };
      tryAttachIntension(caseEntry, source, fn.name);
      attachAbsToIntension(caseEntry, caseAbs, fn.name);
      analysis.cases.push(caseEntry);

      if (directive.commentLine) {
        const hasThrow = caseThrowsAbs.shape.k !== "never";
        const resultStr = caseAbs.shape.k !== "never" ? formatShape(caseAbs) : "";
        const throwStr = hasThrow ? `throws ${formatShape(caseThrowsAbs)}` : "";
        const label = [resultStr, throwStr].filter(Boolean).join(" ");
        const hintLabel = `=> ${label}`;

        let ok = true;
        if (directive.expected) {
          ok = leqAbs(caseAbs, directive.expected).ok;
          if (!ok) {
            diagnostics.push({
              range: { start: { line: directive.commentLine, column: 0 }, end: { line: directive.commentLine, column: 999 } },
              severity: "error",
              message: `Case "${directive.name}": expected ${formatShape(directive.expected)}, got ${formatShape(caseAbs)}. The inferred return type does not match the expected type declared in the @nudo:case directive`,
              code: "nudo:case-expected",
            });
          }
        }

        caseHints.push({ line: directive.commentLine, label: hintLabel, ok });
      }

      const isActive = ci === Math.min(activeCaseIdx, caseDirectives.length - 1);

      if (isActive) {
        if (caseThrowsAbs.shape.k !== "never") {
          const throwRange = caseThrowLoc ?? fnLoc;
          diagnostics.push({
            range: throwRange,
            severity: "warning",
            message: `Function "${fn.name}" case "${directive.name}" may throw: ${formatShape(caseThrowsAbs)}. Consider adding a try-catch block or using @nudo:refine return <constraint>`,
            code: "nudo-may-throw",
          });
        }

        // B 路径可分析时文件级静态收集已报 unreachable，跳过 case 级
        if (!isBPathCapable(source, envNames)) {
          for (const ur of caseUnreachable) {
            diagnostics.push({
              range: ur,
              severity: "info",
              message: "Code after return/throw statement is unreachable",
              tags: ["unnecessary"],
              code: "nudo-unreachable",
              suggestions: ["Remove the unreachable code after the return/throw statement"],
            });
          }
        }
      }
    }

    if (analysis.cases.length > 0) {
      analysis.combinedAbs = collapseAbsLits(
        analysis.cases.map((c) => c.abs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
    }

    if (fnCacheKey) {
      fnAnalysisCacheSet(fnCacheKey, {
        analysis: cloneFunctionAnalysis(analysis),
        diagnostics: diagnostics.slice(dLen0),
        caseHints: caseHints.slice(hLen0),
        callRecords: callRecords.slice(cLen0),
      });
    }

    functionResults.push(analysis);
  }

  // Whole-program call inference: functions without @nudo:case directives
  // get cases synthesized from observed call sites; functions with no call
  // sites at all get a single entry evaluation with unknown parameters.
  const directiveFnNames = new Set(functions.map((f) => f.name));
  const directiveFnStmts = new Set(functions.map((f) => f.node));
  for (const { name, node, stmt, noDeclaration } of collectTopLevelFunctions(ast)) {
    if (directiveFnNames.has(name)) continue;
    // A statement carrying @nudo directives is already analyzed through the
    // directive path above (possibly under its "<anonymous>" name).
    if (directiveFnStmts.has(stmt)) continue;
    const analysis: FunctionAnalysis = { name, loc: locFromNode(node), paramNames: extractParamNames(node), cases: [] };
    if (noDeclaration) analysis.noDeclaration = true;
    functionResults.push(analysis);
    synthCandidates.push({ name, node, analysis });
  }

  // 模块路匹配的前置量：本文件绝对路径（realpath 对齐符号链接后再比，
  // 双侧同一归一化函数，避免单侧 realpath 造成不一致），以及
  // `module.exports = function` 单导出形态的目标函数。
  const modulePathCache = new Map<string, string>();
  const normalizeModulePath = (p: string): string => {
    let n = modulePathCache.get(p);
    if (n === undefined) {
      try {
        n = realpathSync(p);
      } catch {
        n = p;
      }
      modulePathCache.set(p, n);
    }
    return n;
  };
  const currentModulePath = normalizeModulePath(resolve(filePath));
  const singleExportFn = findSingleModuleExportsFunction(ast);

  // T10b：跨文件注入的调用点域证据 ⊄ 手写契约 → nudo:interface-domain-exceeds
  // （error）。带 @nudo:case 的函数同样检查——case 路径只覆盖本文件内 case
  // 实参 vs 契约；跨文件注入证据此前是执法盲区。
  const reportInjectedDomainExceeds = (
    name: string,
    node: Node,
    fallbackLoc: SourceLocation,
  ): void => {
    if (!externalCallRecords || externalCallRecords.length === 0) return;
    const singleExportHit = singleExportFn !== null && node === singleExportFn;
    const nameRoutes = (r: CallRecord): boolean =>
      r.fnName === name ||
      r.targetExport === name ||
      (r.targetAliases?.includes(name) ?? false) ||
      (singleExportHit && (r.fnModule !== undefined || r.targetModule !== undefined));
    const matchingExternal = (r: CallRecord): boolean => {
      const attributed =
        (r.fnModule !== undefined && normalizeModulePath(r.fnModule) === currentModulePath) ||
        (r.targetModule !== undefined && normalizeModulePath(r.targetModule) === currentModulePath);
      if (!attributed) return false;
      return nameRoutes(r);
    };
    const injected = externalCallRecords.filter(matchingExternal);
    if (injected.length === 0) return;
    const nameLoc = fnNameLoc(node, fallbackLoc);
    const fnNode = resolveFunctionNode(node);
    // §2.2 kill-switch：与 CLI check / LSP validate 同口径，从项目配置解析
    // autoBind；漏接会让 analyze 旁路在 autoBind=false 时仍 ambient 执行侧车
    const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;
    const domainIssues = checkInjectedDomainEvidence(name, source, injected, {
      paramNames: extractParamNames(fnNode),
      loadModule: defaultLoadModule,
      fromFile: filePath,
      loc: { line: nameLoc.start.line, column: nameLoc.start.column },
      ...(autoBind === false ? { autoBind: false } : {}),
    });
    for (const issue of domainIssues) {
      const line = issue.line ?? nameLoc.start.line;
      const column = issue.column ?? nameLoc.start.column;
      diagnostics.push({
        range: { start: { line, column }, end: { line, column: column + name.length } },
        severity: issue.severity,
        message: issue.message,
        code: issue.code,
        suggestions: issue.suggestion ? [issue.suggestion] : undefined,
        data: { actual: issue.actual, expected: issue.expected },
      });
    }
  };

  // 带 @nudo:case 的指令函数：同样走跨文件注入证据执法（盲区补齐）
  for (const fn of functions) {
    if (fn.directives.some((d) => d.kind === "case")) {
      reportInjectedDomainExceeds(fn.name, fn.node, locFromNode(fn.node));
    }
  }

  for (const candidate of synthCandidates) {
    // 调用点来源有两路：本文件求值中观察到的调用，以及外部注入的
    // （使用现场文件——如测试——对本文导出函数的真实调用，CLI 经
    // --callsites 收集后传入）。带 targetModule 的记录先判归属：只有
    // 指向本文件的记录才允许参与匹配——导出名/别名离开模块单独无意义
    // （单导出文件的 targetExport 全是 "default"，不判模块会跨文件误染，
    // 如 clone.js 的记录命中 applyToDefaults.js 的 "default" candidate）。
    // 归属本文件（或无模块信息的本地记录）后再走三路：
    //  1. 名字路：fnName（调用处可见名）或 targetExport（定义处导出名）
    //  2. 别名路：re-export 链上后来出现的导出名（evaluator 的
    //     targetAliases，如 barrel / CJS 转发 shim 下的属性名）
    //  3. 模块路：本文件以 `module.exports = function` 单导出时直接收
    //     ——使用方可能以任意转发名调用它；多导出文件不走模块路，
    //     避免同文件多函数误染。
    const singleExportHit = singleExportFn !== null && candidate.node === singleExportFn;
    const nameRoutes = (r: CallRecord): boolean =>
      r.fnName === candidate.name ||
      r.targetExport === candidate.name ||
      (r.targetAliases?.includes(candidate.name) ?? false) ||
      (singleExportHit && (r.fnModule !== undefined || r.targetModule !== undefined));
    // 本地记录：来自本文件求值。带 targetModule 的（本文件导出被调用）
    // 判归属；无 tag 的内部调用按名字匹配（一直以来的行为）。
    const matchingLocal = (r: CallRecord): boolean => {
      const targetsThisFile =
        r.targetModule === undefined || normalizeModulePath(r.targetModule) === currentModulePath;
      if (!targetsThisFile) return false;
      return nameRoutes(r);
    };
    // 外部记录（使用现场收集）必须可归因到本文件：fnModule（定义位点——
    // require 传递求值中库内部调用的记录）或 targetModule（导出 tag）。
    // 无归因的记录是测试本地函数或裸内置名，按名字撞库属跨文件污染
    // （实测：测试局部 compare() 撞 contain.js internals.compare）。
    const matchingExternal = (r: CallRecord): boolean => {
      const attributed =
        (r.fnModule !== undefined && normalizeModulePath(r.fnModule) === currentModulePath) ||
        (r.targetModule !== undefined && normalizeModulePath(r.targetModule) === currentModulePath);
      if (!attributed) return false;
      return nameRoutes(r);
    };
    // resultAbs=never 且 throwsAbs=never 是求值中断的信号泄漏（如
    // `new Promise(async …)` 高阶 async 中 await 切断求值），无信息量，
    // 注入会产出误导 case；本地与注入记录一致跳过，全部被跳过的
    // candidate 自然落入下方 entry@ 回退。resultAbs=never 但 throws≠never
    // 是真实的抛出调用（argAbs + throws 都有信息），保留。
    const records = dedupeCallRecords(
      [
        ...callRecords.filter(matchingLocal),
        ...(externalCallRecords ?? []).filter(matchingExternal),
      ].filter((r) => !isLeakedCallRecord(r)),
    );
    // T10b：跨文件注入的调用点域证据 ⊄ 手写契约 → nudo:interface-domain-exceeds
    reportInjectedDomainExceeds(candidate.name, candidate.node, candidate.analysis.loc);
    if (records.length > 0) {
      // 案例选择偏好：结果有信息量的记录优先（精确/字面量/结构化），
      // unknown 结果的排后——收集顺序里错误路径或 undefined 形态的测试
      // 常排在前面，slice 截断会把 concrete-precise 记录挤掉（hoek clone
      // 的 682 条记录曾由 3 条 undefined 形态占满前 3 席）。
      const informativeness = (r: CallRecord): number => {
        if (r.resultAbs.shape.k === "unknown") return 2;
        if (r.resultAbs.shape.k === "never") return 1;
        return 0;
      };
      const ordered = records
        .map((r, i) => ({ r, i }))
        .sort((a, b) => informativeness(a.r) - informativeness(b.r) || a.i - b.i)
        .map(({ r }) => r);
      const precise = ordered.slice(0, MAX_PRECISE_CALLSITE_CASES);
      for (const rec of precise) {
        // Abs 重求值仅在更有信息量时覆盖（不破坏 mock/callsite 精确结构）
        let absRaw: Abs | undefined;
        let absResult: Abs | undefined;
        if (rec.resultAbs.shape.k !== "never" && rec.argAbs.length > 0) {
          absRaw = tryEvalAbsRaw(source, candidate.name, rec.argAbs, filePath, mockSeedsToAbsMocks(seeds));
          if (absRaw) {
            if (absIsBetter(absToTypeValue(absRaw), safeAbsToTv(rec.resultAbs))) {
              absResult = absRaw;
            }
          }
        }
        // 记录自带的无损结果 Abs：重求值失败/跳过时作兜底（B-path 产物）
        if (!absRaw && rec.resultAbs.shape.k !== "never") {
          absRaw = rec.resultAbs;
        }
        const caseAbs = absResult ?? rec.resultAbs;
        const caseResult: CaseResult = {
          name: `call@L${rec.callLoc?.line ?? candidate.analysis.loc.start.line}`,
          argAbs: [...rec.argAbs],
          abs: caseAbs,
          throwsAbs: rec.throwsAbs,
          source: "callsite",
        };
        tryAttachIntension(caseResult, source, candidate.name);
        if (absRaw) attachAbsToIntension(caseResult, absRaw, candidate.name);
        candidate.analysis.cases.push(caseResult);
      }
      // symbolic 聚合只用全已知实参的记录：含 unknown 分量的记录不可重求值
      // （unknown 吸收整个 union，一条循环引用 fixture 的记录就能毒化全部
      // 剩余聚合——clone 704 条中的 53 条 unknown 实参曾拖垮其余 651 条）。
      // 排除不声明覆盖，sound；全部不可求值时不产 symbolic case（诚实）。
      const remaining = ordered
        .slice(MAX_PRECISE_CALLSITE_CASES)
        .filter((rec) => !rec.argAbs.some((a) => a.shape.k === "unknown" && !a.term));
      if (remaining.length > 0) {
        const fnNode = resolveFunctionNode(candidate.node);
        const paramCount = extractParamNames(fnNode).length;
        const widenedArgsAbs = Array.from({ length: paramCount }, (_, i) =>
          // 缺参按真实 JS 语义 widen 成 undefined 而非 unknown——可选参守卫
          // （target || [] 等）对 unknown 全塌，对 undefined 正常走默认分支
          widenJoinAbs(remaining.map((rec) => rec.argAbs[i] ?? undefAbs)),
        );
        // B 路径优先（capable）；否则 Abs 优先
        let symAbs: Abs | undefined;
        if (isBPathCapable(source, envNames) && filePath) {
          const bSym = tryBPathCall(
            source,
            filePath,
            candidate.name,
            widenedArgsAbs,
            { envNames, mocks: mockSeedsToAbsMocks(seeds) },
          );
          if (bSym && (bHostedEval || !(bSym.shape.k === "unknown" && !bSym.term))) {
            symAbs = bSym;
          }
        }
        if (!symAbs && !bHostedEval) {
          const absTry = tryEvalAbsRaw(
            source,
            candidate.name,
            widenedArgsAbs,
            filePath,
            mockSeedsToAbsMocks(seeds),
          );
          const weak =
            !!absTry &&
            absTry.shape.k === "unknown" &&
            (!absTry.term || (absTry.term.op === "lit" && absTry.term.value === undefined));
          if (absTry && !weak && absTry.shape.k !== "never" && absTry.conf !== "opaque") {
            symAbs = absTry;
          }
        }
        const symCase: CaseResult = {
          name: "call@symbolic",
          argAbs: widenedArgsAbs,
          abs: symAbs ?? absUnknown,
          throwsAbs: neverAbs,
          source: "callsite",
          aggregatedFrom: remaining.length,
        };
        tryAttachIntension(symCase, source, candidate.name);
        if (symAbs) attachAbsToIntension(symCase, symAbs, candidate.name);
        candidate.analysis.cases.push(symCase);
      }
      // Combined covers every observed call site (not just the retained
      // cases), so a large set of same-base literal results collapses to
      // the widened base type instead of a 20-literal union.
      candidate.analysis.combinedAbs = collapseAbsLits(
        records.map((r) => r.resultAbs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
      continue;
    }

    const fnNode = resolveFunctionNode(candidate.node);
    const argAbsEntry = extractParamNames(fnNode).map(() => absUnknown);
    // B 路径主求值（capable）；失败再 Abs ast-eval
    let entryAbs: Abs | undefined;
    let entryThrowsAbs: Abs = neverAbs;
    if (isBPathCapable(source, envNames) && filePath) {
      const bEntryFull = tryBPathCallFull(
        source,
        filePath,
        candidate.analysis.name,
        argAbsEntry,
        { envNames, mocks: mockSeedsToAbsMocks(seeds), collectMemberDiags: true },
      );
      if (bEntryFull?.memberDiags?.length) {
        for (const d of bEntryFull.memberDiags) {
          pushBMemberDiag(d, candidate.analysis.loc.start.line);
        }
      }
      const bEntry = bEntryFull?.result;
      if (bEntry && (bHostedEval || !(bEntry.shape.k === "unknown" && !bEntry.term))) {
        entryAbs = bEntry;
        if (bEntryFull?.throws) entryThrowsAbs = bEntryFull.throws;
      }
    }
    if (!entryAbs) {
      if (bHostedEval) {
        entryAbs = absUnknown;
        entryThrowsAbs = neverAbs;
      } else {
        const absEntry = tryEvalEntryAbs(source, candidate.analysis.name, argAbsEntry.map(absToTypeValue), filePath, seeds.seedVars);
        if (absEntry) {
          entryAbs = absEntry;
          entryThrowsAbs = neverAbs;
        } else {
          entryAbs = absUnknown;
          entryThrowsAbs = neverAbs;
        }
      }
    }
    const caseResult: CaseResult = {
      name: `entry@L${candidate.analysis.loc.start.line}`,
      argAbs: argAbsEntry,
      abs: entryAbs,
      throwsAbs: entryThrowsAbs,
    };
    // display 来自 generalize；attachAbs 补无损 abs 字段（后写覆盖 abs/conf）
    tryAttachIntension(caseResult, source, candidate.analysis.name);
    attachAbsToIntension(caseResult, entryAbs, candidate.analysis.name);
    candidate.analysis.cases.push(caseResult);
    candidate.analysis.entryOnly = true;
    candidate.analysis.combinedAbs = entryAbs;
  }

  if (!bHostedEval) {
    buildNodeTypeMap(ast, globalEnv, nodeAbsMap);
  }

  const externalFunctions = synthesizeExternalFunctions(callRecords, filePath);

  return {
    functions: functionResults,
    diagnostics,
    bindings,
    nodeAbsMap,
    caseHints,
    ...(externalFunctions.length > 0 ? { externalFunctions } : {}),
  };
}

function collectBindings(
  ast: Node,
  env: Environment,
  bindings: Map<string, BindingInfo>,
  absBinds?: Map<string, Abs>,
): void {
  if (ast.type !== "File") return;
  const setBinding = (name: string, loc: SourceLocation): void => {
    const absVal = absBinds?.get(name) ?? absUnknown;
    bindings.set(name, {
      abs: absVal,
      loc,
    });
  };
  for (const stmt of (ast as any).program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) {
      setBinding(stmt.id.name, locFromNode(stmt));
    }
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations) {
        if (decl.id.type === "Identifier") {
          setBinding(decl.id.name, locFromNode(decl));
        }
      }
    }
    if (stmt.type === "ClassDeclaration" && stmt.id) {
      setBinding(stmt.id.name, locFromNode(stmt));
    }
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      collectBindings({ type: "File", program: { type: "Program", body: [stmt.declaration] } } as any, env, bindings, absBinds);
    }
  }
}

function nullLitAbs(): Abs {
  return makeAbsVal({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
}

export function buildNodeTypeMap(
  ast: Node,
  env: Environment,
  nodeAbsMap: Map<Node, Abs>,
): void {
  const traverseFn = (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
  try {
    traverseFn(ast, {
      enter(path) {
        const node = path.node;
        try {
          const setAbs = (a: Abs): void => {
            nodeAbsMap.set(node, a);
          };
          if (
            node.type === "Identifier" &&
            node.name !== "undefined" &&
            path.parentPath?.node.type !== "FunctionDeclaration" &&
            path.parentPath?.node.type !== "VariableDeclarator"
          ) {
            if (env.has(node.name)) {
              setAbs(env.lookup(node.name));
            }
          }
          if (node.type === "NumericLiteral") {
            setAbs(numLit(node.value));
          }
          if (node.type === "StringLiteral") {
            setAbs(strLit(node.value));
          }
          if (node.type === "BooleanLiteral") {
            setAbs(boolLit(node.value));
          }
          if (node.type === "NullLiteral") {
            setAbs(nullLitAbs());
          }
        } catch {
          // skip nodes that fail
        }
      },
    });
  } catch {
    // traverse may fail on partial ASTs
  }
}

/**
 * Abs 是否比 TypeValue 求值结果更有信息量。
 * 仅在 TypeValue 侧 unknown / 裸 number 且 Abs 带约束时替换，
 * 避免用 Abs 的粗结果盖掉 mock/callsite 已精确投影的结构。
 */
function absIsBetter(absTv: TypeValue, prev: TypeValue): boolean {
  if (prev.kind === "unknown") return absTv.kind !== "unknown";
  if (absTv.kind === "unknown" || absTv.kind === "never") return false;
  // 保留结构化结果（object/array/tuple/union/literal）
  if (
    prev.kind === "literal" ||
    prev.kind === "object" ||
    prev.kind === "array" ||
    prev.kind === "tuple" ||
    prev.kind === "union" ||
    prev.kind === "function" ||
    prev.kind === "instance" ||
    prev.kind === "promise"
  ) {
    return false;
  }
  // Abs refined vs 裸 primitive：约束更有信息
  if (absTv.kind === "refined" && prev.kind === "primitive") return true;
  return false;
}
/**
 * 自包含 = 无 import/require、无 @nudo:env。
 * @nudo:mock 不阻断 Abs：已编译为 seedVars/seedFns 注入 evalProgramAbs。
 * 相对 import 经 Abs 模块图注入后，也不再阻断 Abs 路径。
 */
function isSelfContainedSource(source: string, envNames: string[]): boolean {
  if (envNames.length > 0) return false;
  return !/\brequire\s*\(|\bimport\s*[{'"*]/.test(source);
}

/** Abs 模块图可处理：env 由 loadEnvs 处理（内置 + 预加载路径型） */
function absModulesOk(source: string, envNames: string[]): boolean {
  void source;
  void envNames;
  return true;
}

/**
 * Abs 程序级求值收集调用记录（类型即计算）。
 * filePath 存在时经模块图注入相对 import / 裸包 harvest；
 * import 局部名 → targetModule/targetExport（供 externalFunctions）。
 */
function collectAbsCallRecords(
  source: string,
  seeds?: {
    seedVars?: Record<string, Abs>;
    seedFns?: Record<string, { params: string[]; body: Node; async?: boolean }>;
  },
  filePath?: string,
  precomputedModules?: Record<string, import("@nudojs/core").AbsModuleExports>,
  envNames: string[] = [],
): CallRecord[] {
  const absCalls: AbsCallRecord[] = [];
  let modules: Record<string, import("@nudojs/core").AbsModuleExports> | undefined =
    precomputedModules;
  let importLocals = new Map<string, { modulePath: string; exportName: string }>();
  if (filePath && absModulesOk(source, envNames)) {
    if (!modules) {
      try {
        const graph = evalAbsModuleGraph(source, filePath, {
          seedVars: seeds?.seedVars,
          seedFns: seeds?.seedFns,
        });
        modules = graph.modules;
      } catch {
        modules = undefined;
      }
    }
    // 无预计算 modules 时也要并入 env（@nudo:env node / es / web）
    if (envNames.length > 0) {
      modules = { ...collectEnvModules(envNames), ...(modules ?? {}) };
    }
    try {
      importLocals = buildAbsImportLocalMap(source, filePath);
    } catch {
      importLocals = new Map();
    }
  }
  setAbsCallCollector((r) => absCalls.push(r));
  try {
    evalProgramAbs(source, { ...seeds, modules });
  } catch {
    // Abs 求值失败：交还 TypeValue 路径
  } finally {
    setAbsCallCollector(null);
  }
  return absCalls.map((r) => callRecordFromAbsCall(r, importLocals));
}

/**
 * 一次 evalProgramAbs 同时收集顶层绑定 + 节点 Abs（B-hosted 补齐 hover/bindings）。
 * modules 可预计算，避免再跑一遍模块图。
 */
function collectAbsBindsAndNodes(
  source: string,
  seeds?: {
    seedVars?: Record<string, Abs>;
    seedFns?: Record<string, { params: string[]; body: Node; async?: boolean }>;
  },
  modules?: Record<string, import("@nudojs/core").AbsModuleExports>,
): { binds: Map<string, Abs>; nodes: Map<Node, Abs> } {
  const binds = new Map<string, Abs>();
  const nodes = new Map<Node, Abs>();
  setAbsNodeCollector((node, value) => {
    nodes.set(node, value);
  });
  try {
    const { env } = evalProgramAbs(source, {
      ...seeds,
      modules,
    });
    for (const [k, v] of env.vars) binds.set(k, v);
    for (const [name, impl] of env.fns) {
      if (!binds.has(name)) {
        binds.set(
          name,
          absFunction(impl.params, { body: impl.body, async: impl.async, env }),
        );
      }
    }
  } catch {
    /* ignore */
  } finally {
    setAbsNodeCollector(null);
  }
  return { binds, nodes };
}

/** 入口 import 局部绑定 → 解析后的模块路径 + 导出名 */
function buildAbsImportLocalMap(
  source: string,
  fromFile: string,
): Map<string, { modulePath: string; exportName: string }> {
  const out = new Map<string, { modulePath: string; exportName: string }>();
  try {
    const file = parse(source);
    for (const stmt of file.program.body) {
      if (stmt.type === "ImportDeclaration") {
        const spec = stmt.source.value;
        let modulePath: string | null = null;
        if (spec.startsWith(".") || spec.startsWith("/")) {
          modulePath = resolveImportAbs(spec, fromFile);
        } else if (!spec.startsWith("node:")) {
          // 裸包：用说明符本身作 module 标（externalFunctions 可显示）
          modulePath = spec;
        }
        if (!modulePath) continue;
        for (const s of stmt.specifiers) {
          if (s.type === "ImportSpecifier") {
            const imported =
              s.imported.type === "Identifier" ? s.imported.name : String(s.imported);
            out.set(s.local.name, { modulePath, exportName: imported });
          } else if (s.type === "ImportDefaultSpecifier") {
            out.set(s.local.name, { modulePath, exportName: "default" });
          }
        }
        continue;
      }
      // CJS: const { double } = require("./util.js")
      if (stmt.type === "VariableDeclaration") {
        for (const d of stmt.declarations) {
          if (d.init?.type !== "CallExpression") continue;
          const callee = d.init.callee;
          if (callee.type !== "Identifier" || callee.name !== "require") continue;
          const arg0 = d.init.arguments[0];
          if (!arg0 || arg0.type !== "StringLiteral") continue;
          const spec = arg0.value;
          let modulePath: string | null = null;
          if (spec.startsWith(".") || spec.startsWith("/")) {
            modulePath = resolveImportAbs(spec, fromFile);
          } else if (!spec.startsWith("node:")) {
            modulePath = spec;
          }
          if (!modulePath) continue;
          if (d.id.type === "ObjectPattern") {
            for (const p of d.id.properties) {
              if (p.type !== "ObjectProperty" || p.computed) continue;
              if (p.key.type !== "Identifier" || p.value.type !== "Identifier") continue;
              out.set(p.value.name, { modulePath, exportName: p.key.name });
            }
          } else if (d.id.type === "Identifier") {
            out.set(d.id.name, { modulePath, exportName: "default" });
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function resolveImportAbs(spec: string, fromFile: string): string | null {
  const base = dirname(resolve(fromFile));
  const p = resolve(base, spec);
  for (const cand of [p, `${p}.js`, `${p}.mjs`, `${p}.ts`, resolve(p, "index.js")]) {
    if (existsSync(cand) && !statSync(cand).isDirectory()) return cand;
  }
  return null;
}

/** Abs 原生重求值（无损）；B 路径 transpile+exec 优先，失败回退 ast-eval */
function tryEvalAbsRaw(
  source: string,
  fnName: string,
  args: TypeValue[] | Abs[],
  filePath?: string,
  mocks?: Record<string, Abs>,
): Abs | undefined {
  return tryEvalAbsFull(source, fnName, args, filePath, mocks)?.result;
}

/**
 * Abs 原生重求值 + throws（T19）：B-path 已带 throws；ast-eval 走 analyzeFnFull。
 * 失败返回 undefined。require 源码不走 Abs。
 */
function tryEvalAbsFull(
  source: string,
  fnName: string,
  args: TypeValue[] | Abs[],
  filePath?: string,
  mocks?: Record<string, Abs>,
): { result: Abs; throws: Abs; throwLoc?: { line: number; column: number } } | undefined {
  if (/\brequire\s*\(/.test(source)) return undefined;
  try {
    const absArgs: Abs[] = args.map((a) =>
      a && typeof a === "object" && "shape" in a && "conf" in a
        ? (a as Abs)
        : typeValueToAbs(a as TypeValue),
    );

    if (filePath) {
      const viaB = tryBPathCallFull(source, filePath, fnName, absArgs, { mocks });
      if (viaB) {
        const r = viaB.result;
        if (r && !(r.shape.k === "unknown" && !r.term)) {
          const throws = viaB.throws ?? { shape: { k: "never" }, conf: "exact" };
          // B 无 throwLoc：threw 时用 ast-eval 补 loc（不改 result/throws）
          if (throws.shape.k !== "never") {
            try {
              let modules: Record<string, import("@nudojs/core").AbsModuleExports> | undefined;
              if (/\bimport\s*[{'"*]/.test(source)) {
                modules = evalAbsModuleGraph(source, filePath).modules;
              }
              const viaAst = analyzeFnFull(source, fnName, absArgs, { modules });
              return {
                result: r,
                throws,
                ...(viaAst.throwLoc ? { throwLoc: viaAst.throwLoc } : {}),
              };
            } catch {
              return { result: r, throws };
            }
          }
          return { result: r, throws };
        }
      }
    }

    let modules: Record<string, import("@nudojs/core").AbsModuleExports> | undefined;
    if (filePath && /\bimport\s*[{'"*]/.test(source)) {
      modules = evalAbsModuleGraph(source, filePath).modules;
    }
    const full = analyzeFnFull(source, fnName, absArgs, { modules });
    if (full.result.shape.k === "unknown" && !full.result.term) {
      return undefined;
    }
    return full;
  } catch {
    return undefined;
  }
}

/**
 * entry@ 的 Abs 原生路径：自包含源码用 ast-eval（类型即计算）。
 * 含 import/require 或求值失败时返回 undefined。
 */
function tryEvalEntryAbs(
  source: string,
  fnName: string,
  args: TypeValue[],
  filePath?: string,
  mocks?: Record<string, Abs>,
): Abs | undefined {
  return tryEvalAbsRaw(source, fnName, args, filePath, mocks);
}

/**
 * entry@ 附加内涵摘要（代数 generalize + 无损 Abs）。
 * 失败静默——不改变外延 TypeValue。
 */
function tryAttachIntension(
  caseResult: CaseResult,
  source: string,
  fnName: string,
): void {
  try {
    const g = generalizeFromAst(fnName, source);
    if (!g) return;
    const sym = g.symbolic;
    const intension: NonNullable<CaseResult["intension"]> = {
      display: g.display,
      abs: formatAbs(sym),
      absMultiline: formatAbsMultiline(sym, fnName),
    };
    if (sym.term && sym.term.op !== "lit") {
      intension.term = termToString(sym.term);
    }
    if (sym.pred && sym.pred.op !== "true") {
      intension.pred = predToString(sym.pred);
    }
    intension.conf = sym.conf;
    caseResult.intension = intension;
  } catch {
    // ignore
  }
}

/** 把一次 Abs 求值结果挂到 case 的 intension（无损） */
function attachAbsToIntension(
  caseResult: CaseResult,
  absVal: Abs,
  label?: string,
): void {
  const prev = caseResult.intension ?? {};
  caseResult.abs = absVal;
  caseResult.intension = {
    ...prev,
    abs: formatAbs(absVal),
    absMultiline: formatAbsMultiline(absVal, label ?? caseResult.name),
    conf: absVal.conf,
  };
}

/** TypeValue → Abs（dts / argAbs 用；失败落 opaque unknown，诚实缺口） */
function safeArgAbs(v: TypeValue): Abs {
  try {
    return typeValueToAbs(v);
  } catch {
    return { shape: { k: "unknown" }, conf: "opaque" };
  }
}

function safeAbsOrUnknown(a: Abs | undefined): Abs {
  if (!a || typeof a !== "object" || !("shape" in a) || !a.shape) {
    return { shape: { k: "unknown" }, conf: "opaque" };
  }
  return a;
}

function safeAbsToTv(a: Abs | undefined): TypeValue {
  if (!a || typeof a !== "object" || !("shape" in a) || !a.shape) {
    return T.unknown;
  }
  try {
    return absToTypeValue(a);
  } catch {
    return T.unknown;
  }
}

/**
 * B-path / Abs program 调用记录 → CallRecord（Abs 唯一）。
 * threw 时 result 位为 never、throws 位为抛出值。
 */
function callRecordFromAbsCall(
  r: {
    fnName: string;
    args: Abs[];
    result: Abs;
    callLoc?: { line: number; column: number };
    threw?: boolean;
  },
  impMap?: Map<string, { modulePath: string; exportName: string }>,
): CallRecord {
  const argAbs = r.args.map(safeAbsOrUnknown);
  const threw = !!r.threw;
  const thrownOrResult = safeAbsOrUnknown(r.result);
  const rec: CallRecord = {
    fnName: r.fnName,
    argAbs,
    resultAbs: threw ? neverAbs : thrownOrResult,
    throwsAbs: threw ? thrownOrResult : neverAbs,
    callLoc: r.callLoc,
  };
  const imp = impMap?.get(r.fnName);
  if (imp) {
    rec.targetModule = imp.modulePath;
    rec.targetExport = imp.exportName;
  }
  return rec;
}

/** cases 实参 → argAbs（与 args 对齐；缺位不填） */
function argAbsFromTypeValues(args: TypeValue[]): Abs[] {
  return args.map(safeArgAbs);
}

/**
 * combinedAbs：优先 join 全部 case 结果 Abs；否则桥 combined TypeValue。
 * throwing case 的 result 是 never，join 时被吸收（与 TypeValue simplifyUnion 一致）。
 */
function computeCombinedAbs(
  cases: CaseResult[],
  combined: TypeValue | undefined,
): Abs | undefined {
  const withAbs = cases.filter((c) => c.abs !== undefined);
  if (cases.length > 0 && withAbs.length === cases.length) {
    try {
      return withAbs.map((c) => c.abs!).reduce((a, b) => joinAbs(a, b));
    } catch {
      /* fall through */
    }
  }
  if (combined) {
    try {
      return typeValueToAbs(combined);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export type { CallRecord } from "./evaluator/evaluator-api.ts";
