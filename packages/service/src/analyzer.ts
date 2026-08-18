import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Node } from "@babel/types";
import traverse from "@babel/traverse";
import {
  type TypeValue,
  T,
  typeValueToString,
  simplifyUnion,
  widenLiteral,
  collapseLiteralUnion,
  createEnvironment,
  isSubtypeOf,
  type Environment,
  mockHelperToTypeValue,
} from "@nudojs/core";
import { parse, extractDirectives, extractFileDirectives, parseTypeValueExpr } from "@nudojs/parser";
import type { FunctionWithDirectives, SinonExpression } from "@nudojs/parser";
import {
  evaluate,
  evaluateFunction,
  evaluateFunctionFull,
  memberMayExistOn,
  setUsageSiteTag,
  USAGE_SITE_MODULE,
  evaluateProgram,
  setModuleResolver,
  setCurrentFileDir,
  resetMemo,
  getUnreachableRanges,
  resetUnreachableRanges,
  setNodeTypeCollector,
  setCallCollector,
  type CallRecord,
  setUnknownCollector,
  setProvenanceTracking,
  type UnknownRecord,
  setSampleCount,
  setUnknownBuiltinHandler,
  setEnvModules,
  resetEnvModules,
  setMockModules,
  resetMockModules,
  setCurrentSource,
  loadEnvs,
  preloadPathEnvs,
  findProjectConfig,
  resolveNpmNudo,
} from "@nudojs/cli/evaluator";

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
  args: TypeValue[];
  result: TypeValue;
  throws: TypeValue;
  throwLoc?: SourceLocation;
  source?: "directive" | "callsite";
  /** number of additional call sites folded into a symbolic case */
  aggregatedFrom?: number;
};

export type FunctionAnalysis = {
  name: string;
  loc: SourceLocation;
  paramNames: string[];
  cases: CaseResult[];
  combined?: TypeValue;
  assertionErrors?: string[];
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
  type: TypeValue;
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
  nodeTypeMap: Map<Node, TypeValue>;
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

function applyMocks(
  directives: FunctionWithDirectives["directives"],
  env: Environment,
  filePath: string,
  diagnostics: Diagnostic[],
): void {
  for (const d of directives) {
    if (d.kind !== "mock") continue;
    if (d.arrowFn) {
      const fnType = T.fn(d.arrowFn.params, d.arrowFn.body, env);
      (fnType as any)._paramPatterns = d.arrowFn.paramPatterns;
      env.bind(d.name, fnType);
    } else if (d.nudoMock) {
      const typeVal = mockHelperToTypeValue(d.nudoMock, env);
      env.bind(d.name, typeVal);
    } else if (d.sinonExpr) {
      const sinonType = createSinonTypeValue(d.sinonExpr, env);
      env.bind(d.name, sinonType);
    } else if (d.expression) {
      const expr = d.expression.trim();
      if (expr.includes("(") && expr.includes(")") && !expr.startsWith("T.")) {
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
      env.bind(d.name, parseTypeValueExpr(d.expression));
    } else if (d.fromPath) {
      const mockPath = resolve(dirname(filePath), d.fromPath);
      const mockSource = readFileSync(mockPath, "utf-8");
      const mockAst = parse(mockSource);
      const mockEnv = createEnvironment();
      evaluateProgram(mockAst, mockEnv);
      const mockVal = mockEnv.lookup(d.name);
      env.bind(d.name, mockVal);
    }
  }
}

function createSinonTypeValue(sinonExpr: SinonExpression, env: Environment): TypeValue {
  // For stub and spy, create a function that returns the specified value
  if (sinonExpr.type === "stub" || sinonExpr.type === "spy") {
    const body = { type: "BlockStatement", body: [] } as any;
    const fn = T.fn(["...args"], body, env);

    if (sinonExpr.returnValue) {
      // Store the return value directly on the function
      (fn as any)._directReturn = sinonExpr.returnValue;
    } else if (sinonExpr.resolvedValue) {
      // Store as promise
      (fn as any)._directReturn = T.promise(sinonExpr.resolvedValue);
    } else if (sinonExpr.rejectedValue) {
      // Store as never (rejected promise)
      (fn as any)._directReturn = T.never;
    } else {
      // Default: return unknown
      (fn as any)._directReturn = T.unknown;
    }
    return fn;
  }
  // For mock, return unknown for now
  return T.unknown;
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

function locFromNode(node: Node): SourceLocation {
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

/** widenLiteral for unions: widen each member, then dedupe (1|2|…|20 → number). */
function widenType(tv: TypeValue): TypeValue {
  if (tv.kind === "union") return simplifyUnion(tv.members.map(widenLiteral));
  return widenLiteral(tv);
}

function dedupeCallRecords(records: CallRecord[]): CallRecord[] {
  const seen = new Set<string>();
  const out: CallRecord[] = [];
  for (const rec of records) {
    // 类型值是重共享的 DAG（同一 JSON fixture 字面量流入多个参数/记录），
    // 下方树形 key 会随共享度指数膨胀。超大记录与 resultType=never 一样
    // 没有逐调用信息量（其 widen 后的形态才有），在 key 计算前统一丢弃。
    if (isOversizedRecord(rec)) continue;
    // key 必须含结果形态：同实参形状但不同结果（错误路径 never+throws vs
    // 成功路径 Promise<...>）是不同的 case，只按实参去重会把成功记录吞进
    // 首条错误记录里（parseChunked 的 Promise 记录曾被 L203 的 throw 吞掉）。
    const key =
      rec.argTypes.map(typeStructureKey).join(",") +
      "=>" +
      typeStructureKey(rec.resultType) +
      "!" +
      typeStructureKey(rec.throws);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

/** DAG node budget for a usable call record; tree-shaped renderings of a
 * type (the dedup key, the synthesized case output) grow exponentially with
 * substructure sharing, so records whose argument/result DAGs exceed the
 * budget are dropped rather than blown up. */
const MAX_RECORD_TYPE_NODES = 2000;

/** Linear-in-DAG-size node count (a `seen` set makes shared subtrees count
 * once, so this stays cheap where a naive tree walk is exponential). */
function typeNodeCount(tv: TypeValue, seen: Set<object>): number {
  if (tv === null || typeof tv !== "object") return 1;
  if (seen.has(tv)) return 0;
  seen.add(tv);
  switch (tv.kind) {
    case "array":
      return 1 + typeNodeCount(tv.element, seen);
    case "tuple":
      return 1 + tv.elements.reduce((acc, e) => acc + typeNodeCount(e, seen), 0);
    case "object": {
      let n = 1;
      for (const v of Object.values(tv.properties)) n += typeNodeCount(v, seen);
      return n;
    }
    case "promise":
      return 1 + typeNodeCount(tv.value, seen);
    case "union":
      return 1 + tv.members.reduce((acc, e) => acc + typeNodeCount(e, seen), 0);
    case "refined":
      return 1 + typeNodeCount(tv.base, seen);
    default:
      return 1;
  }
}

function isOversizedRecord(rec: CallRecord): boolean {
  const seen = new Set<object>();
  for (const a of rec.argTypes) {
    if (typeNodeCount(a, seen) > MAX_RECORD_TYPE_NODES) return true;
  }
  return typeNodeCount(rec.resultType, seen) > MAX_RECORD_TYPE_NODES;
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
 * carries the resultType/throws computed when this file was evaluated.
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
    const arity = Math.max(...deduped.map((r) => r.argTypes.length));
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
    // observed argument/result/throws types of the remaining records instead.
    const precise = deduped.slice(0, MAX_PRECISE_CALLSITE_CASES);
    for (const rec of precise) {
      analysis.cases.push({
        name: `call@L${rec.callLoc?.line ?? 0}`,
        args: rec.argTypes,
        result: rec.resultType,
        throws: rec.throws,
        source: "callsite",
      });
    }
    const remaining = deduped.slice(MAX_PRECISE_CALLSITE_CASES);
    if (remaining.length > 0) {
      analysis.cases.push({
        name: "call@symbolic",
        args: Array.from({ length: arity }, (_, i) =>
          // 缺参按真实 JS 语义 widen 成 undefined 而非 unknown——可选参守卫
          // （target || [] 等）对 unknown 全塌，对 undefined 正常走默认分支
          widenType(simplifyUnion(remaining.map((rec) => rec.argTypes[i] ?? T.undefined))),
        ),
        result: collapseLiteralUnion(simplifyUnion(remaining.map((r) => r.resultType)), COLLAPSE_LITERAL_THRESHOLD),
        throws: simplifyUnion(remaining.map((r) => r.throws)),
        source: "callsite",
        aggregatedFrom: remaining.length,
      });
    }

    if (deduped.length > 1) {
      analysis.combined = collapseLiteralUnion(
        simplifyUnion(deduped.map((r) => r.resultType)),
        COLLAPSE_LITERAL_THRESHOLD,
      );
    } else {
      analysis.combined = deduped[0].resultType;
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

function unknownRecordsToDiagnostics(records: UnknownRecord[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const line = r.loc?.line ?? 0;
    const column = r.loc?.column ?? 0;
    const key = `${line}:${column}:${r.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const range = {
      start: { line, column },
      end: { line, column: column + r.name.length },
    };

    if (r.kind === "global") {
      // 递归截断记录（name 形如 "recursion:fnName"）来自求值预算，非未知全局
      if (r.name.startsWith("recursion:")) {
        out.push({
          range,
          severity: "warning",
          message: `Recursive evaluation of '${r.name.slice("recursion:".length)}' was truncated (depth/size budget); result widened to unknown`,
          code: "nudo:recursion-truncated",
        });
        continue;
      }
      // 模块加载守卫记录（evaluator.ts loadModuleEnv / mock-module 路径）：
      // reason 自带环链 / 链深 / 完整候选路径，直接作为诊断文案。
      if (r.name.startsWith("module-cycle:")) {
        out.push({
          range,
          severity: "warning",
          message: r.reason ?? "Circular module load detected",
          code: "nudo:module-cycle",
        });
        continue;
      }
      if (r.name.startsWith("module-depth:")) {
        out.push({
          range,
          severity: "warning",
          message: r.reason ?? "Module load chain too deep",
          code: "nudo:module-depth",
        });
        continue;
      }
      if (r.name.startsWith("module-missing:")) {
        out.push({
          range,
          severity: "error",
          message: r.reason ?? "Module file not found",
          code: "nudo:module-missing",
        });
        continue;
      }
      out.push({
        range,
        severity: "warning",
        message: `Unknown global identifier '${r.name}'`,
        code: "nudo:unknown-global",
      });
      continue;
    }

    const receiver = r.receiverType;
    if (receiver && receiverIsConcrete(receiver)) {
      // instance 类型的方法集是声明的近似（未列出 ≠ 运行时不存在），
      // 只有基类型（number/string 等）上的方法缺失才是确定错误。
      // union 混合（Set | [] | {}）同理：部分 member 可能有该方法，
      // 缺失不确定 → warning。
      const isApprox = (() => {
        const members =
          receiver.kind === "union" ? receiver.members : [receiver];
        return members.some(
          (m) =>
            m.kind === "instance" ||
            m.kind === "function" ||
            m.kind === "tuple" ||
            m.kind === "array" ||
            m.kind === "object" ||
            m.kind === "refined" ||
            // wrapper/instance 近似表上可能持有该成员（'x'.charCodeAt 于
            // number|string：string 侧存在，number 侧缺失 → 不确定 → warning）
            memberMayExistOn(m, r.name),
        );
      })();
      const kindLabel = r.kind === "method" ? "Method" : "Property";
      out.push({
        range,
        severity: isApprox ? "warning" : "error",
        message: `${kindLabel} '${r.name}' does not exist on type '${receiverTypeToDisplay(receiver)}'`,
        code: "nudo:no-method",
        ...(r.origin ? { origin: r.origin } : {}),
      });
    } else {
      out.push({
        range,
        severity: "warning",
        message: `Cannot resolve '${r.name}' on unknown value`,
        code: "nudo:unknown-recv",
        ...(r.origin ? { origin: r.origin } : {}),
      });
    }
  }
  return out;
}

function collectEnvNames(filePath: string, source: string, includeProject: boolean): string[] {
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
 * 只做求值与记录，不产出诊断；求值异常不抛出（使用现场文件可能
 * 依赖未 mock 的全局，收集不到就收集不到，不能拖垮主分析）。
 */
export function collectCallRecords(filePath: string, source: string): CallRecord[] {
  const records: CallRecord[] = [];
  // 使用现场可能是老 CJS（八进制字面量等历史语法）——宽松恢复模式，
  // 收集尽力而为；主分析的 parse 不受影响
  const ast = parse(source, { errorRecovery: true });
  resetMemo();
  resetUnreachableRanges();
  resetEnvModules();
  resetMockModules();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));
  setCurrentSource(source);
  setCallCollector((record) => records.push(record));
  try {
    const env = createEnvironment();
    evaluateProgram(ast, env);
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
        const args = (expr as Node & { arguments: Node[] }).arguments;
        const cb = args.find((a) => a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression") as
          | (Node & { body: Node })
          | undefined;
        if (!cb) continue;
        try {
          // 以 unknown 参数执行回调体（evaluate 只构造函数类型不执行）
          const params = (cb as unknown as { params?: Node[] }).params ?? [];
          evaluateFunction(cb, params.map(() => T.unknown), env);
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
    setCallCollector(null);
    setModuleResolver(null);
    setUnknownBuiltinHandler(null);
  }
  return records;
}

/** 测试框架的回调注册函数：回调体里是真实调用点 */
const TEST_CALLBACK_NAMES = new Set(["it", "test", "describe"]);

export function analyzeFile(filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[]): AnalysisResult {
  // 外部实参里的闭包在使用现场文件定义——先打 usage-site 标记再进入任何
  // 求值（case 合成重求值会执行它们，泄漏的错误记录靠此标记丢弃）。
  for (const rec of externalCallRecords ?? []) {
    for (const a of rec.argTypes) setUsageSiteTag(a);
  }
  const ast = parse(source);
  const functions = extractDirectives(ast);
  const diagnostics: Diagnostic[] = [];
  const bindings = new Map<string, BindingInfo>();
  const nodeTypeMap = new Map<Node, TypeValue>();
  const functionResults: FunctionAnalysis[] = [];
  const caseHints: CaseHint[] = [];

  resetMemo();
  resetUnreachableRanges();
  resetEnvModules();
  resetMockModules();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));
  setCurrentSource(source);

  const fileDirectives = extractFileDirectives(ast);
  const fileEnvNames = fileDirectives
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);

  const projectConfig = findProjectConfig(dirname(filePath));
  const projectEnvNames = projectConfig?.config.env ?? [];
  const envNames = [...new Set([...projectEnvNames, ...fileEnvNames])];

  setUnknownBuiltinHandler((name, loc) => {
    diagnostics.push({
      range: loc ? { start: loc.start, end: loc.end } : { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      severity: "warning",
      message: `Built-in API "${name}" is not covered by Nudo's type inference`,
      code: "nudo:builtin-unknown",
      suggestions: [
        `Use @nudo:mock to define the type: @nudo:mock ${name} = stub().returns(...)`,
        `Or use @nudo:returns to declare the expected return type`,
      ],
    });
  });

  const globalEnv = createEnvironment();

  if (envNames.length > 0) {
    const loaded = loadEnvs(envNames, globalEnv);
    setEnvModules(loaded.modules);
  }

  const mocks = new Map<string, { fromPath: string; names?: string[] }>();

  if (projectConfig?.config.mocks) {
    for (const [source, mockPath] of Object.entries(projectConfig.config.mocks)) {
      mocks.set(source, { fromPath: resolve(projectConfig.projectDir, mockPath) });
    }
  }

  const mockModuleDirectives = fileDirectives.filter((d) => d.kind === "mock-module");
  for (const d of mockModuleDirectives) {
    mocks.set(d.source, { fromPath: d.fromPath, names: d.names });
  }

  if (mocks.size > 0) {
    setMockModules(mocks);
  }

  const callRecords: CallRecord[] = [];
  setCallCollector((record) => callRecords.push(record));

  const unknownRecords: UnknownRecord[] = [];
  setUnknownCollector((r) => unknownRecords.push(r));

  setProvenanceTracking(true);

  // @nudo:mock 绑定必须先于全程序求值：顶层调用点（如 mockHof([1,2,3])）
  // 在 evaluateProgram 中执行并由 callCollector 记录 call@ case 的
  // resultType——mock 晚于此绑定会让「mock 函数值作为回调实参」在该路径
  // 整体降级 unknown（@nudo:case 求值发生在下方循环内，此前不受影响）。
  for (const fn of functions) {
    applyMocks(fn.directives, globalEnv, filePath, diagnostics);
  }

  evaluateProgram(ast, globalEnv);

  const unreachableRanges = getUnreachableRanges();
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

  collectBindings(ast, globalEnv, bindings);

  const synthCandidates: { name: string; node: Node; analysis: FunctionAnalysis }[] = [];

  for (const fn of functions) {
    const isPure = fn.directives.some((d) => d.kind === "pure");
    const skipDirective = fn.directives.find((d) => d.kind === "skip");
    const returnsDirective = fn.directives.find((d) => d.kind === "returns");

    const fnLoc = locFromNode(fn.node);
    const paramNames = extractParamNames(fn.node);
    const analysis: FunctionAnalysis = { name: fn.name, loc: fnLoc, paramNames, cases: [] };

    if (skipDirective && skipDirective.kind === "skip") {
      analysis.skipped = true;
      if (skipDirective.returns) {
        analysis.combined = skipDirective.returns;
      }
      functionResults.push(analysis);
      continue;
    }

    if (isPure) {
      const fnVal = globalEnv.has(fn.name) ? globalEnv.lookup(fn.name) : null;
      if (fnVal && fnVal.kind === "function") {
        (fnVal as any)._memoize = fn.name;
      }
    }

    const sampleDirective = fn.directives.find((d) => d.kind === "sample");
    if (sampleDirective && sampleDirective.kind === "sample") {
      setSampleCount(sampleDirective.count);
    } else {
      setSampleCount(3);
    }

    const caseDirectives = fn.directives.filter((d) => d.kind === "case");
    const activeCaseIdx = activeCases?.get(fn.name) ?? 0;

    if (caseDirectives.length === 0) {
      synthCandidates.push({ name: fn.name, node: fn.node, analysis });
    }

    for (let ci = 0; ci < caseDirectives.length; ci++) {
      const directive = caseDirectives[ci];
      resetUnreachableRanges();
      const fullResult = evaluateFunctionFull(fn.node, directive.args, globalEnv);
      const caseUnreachable = [...getUnreachableRanges()];

      analysis.cases.push({
        name: directive.name,
        args: directive.args,
        result: fullResult.value,
        throws: fullResult.throws,
        throwLoc: fullResult.throwLoc,
      });

      if (directive.commentLine) {
        const hasThrow = fullResult.throws.kind !== "never";
        const resultStr = fullResult.value.kind !== "never"
          ? typeValueToString(fullResult.value)
          : "";
        const throwStr = hasThrow
          ? `throws ${typeValueToString(fullResult.throws)}`
          : "";
        const label = [resultStr, throwStr].filter(Boolean).join(" ");
        const hintLabel = `=> ${label}`;

        let ok = true;
        if (directive.expected) {
          ok = isSubtypeOf(fullResult.value, directive.expected);
          if (!ok) {
            diagnostics.push({
              range: { start: { line: directive.commentLine, column: 0 }, end: { line: directive.commentLine, column: 999 } },
              severity: "error",
              message: `Case "${directive.name}": expected ${typeValueToString(directive.expected)}, got ${typeValueToString(fullResult.value)}. The inferred return type does not match the expected type declared in the @nudo:case directive`,
            });
          }
        }

        caseHints.push({ line: directive.commentLine, label: hintLabel, ok });
      }

      const isActive = ci === Math.min(activeCaseIdx, caseDirectives.length - 1);

      if (isActive) {
        if (fullResult.throws.kind !== "never") {
          const throwRange = fullResult.throwLoc ?? fnLoc;
          diagnostics.push({
            range: throwRange,
            severity: "warning",
            message: `Function "${fn.name}" case "${directive.name}" may throw: ${typeValueToString(fullResult.throws)}. Consider adding a try-catch block or using @nudo:returns to declare expected behavior`,
            code: "nudo-may-throw",
          });
        }

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

    if (analysis.cases.length > 1) {
      analysis.combined = collapseLiteralUnion(simplifyUnion(analysis.cases.map((c) => c.result)), COLLAPSE_LITERAL_THRESHOLD);
    } else if (analysis.cases.length === 1) {
      analysis.combined = analysis.cases[0].result;
    }

    if (returnsDirective && returnsDirective.kind === "returns") {
      analysis.assertionErrors = [];
      for (const directive of caseDirectives) {
        const result = evaluateFunction(fn.node, directive.args, globalEnv);
        const matches = isSubtypeOf(result, returnsDirective.expected);
        if (!matches) {
          const msg = `@nudo:returns assertion failed for case "${directive.name}": expected ${typeValueToString(returnsDirective.expected)}, got ${typeValueToString(result)}. Update the @nudo:returns directive to match the inferred type, or fix the function implementation`;
          analysis.assertionErrors.push(msg);
          diagnostics.push({
            range: fnLoc,
            severity: "error",
            message: msg,
            code: "nudo-assertion-failed",
            suggestions: [
              "Update @nudo:returns to match the inferred type",
              "Fix the function to return the expected type",
            ],
          });
        }
      }
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
    // resultType=never 且 throws=never 是求值中断的信号泄漏（如
    // `new Promise(async …)` 高阶 async 中 await 切断求值），无信息量，
    // 注入会产出误导 case；本地与注入记录一致跳过，全部被跳过的
    // candidate 自然落入下方 entry@ 回退。resultType=never 但 throws≠never
    // 是真实的抛出调用（argTypes + throws 都有信息），保留。
    const records = dedupeCallRecords(
      [
        ...callRecords.filter(matchingLocal),
        ...(externalCallRecords ?? []).filter(matchingExternal),
      ].filter((r) => !(r.resultType.kind === "never" && r.throws.kind === "never")),
    );
    if (records.length > 0) {
      // 案例选择偏好：结果有信息量的记录优先（精确/字面量/结构化），
      // unknown 结果的排后——收集顺序里错误路径或 undefined 形态的测试
      // 常排在前面，slice 截断会把 concrete-precise 记录挤掉（hoek clone
      // 的 682 条记录曾由 3 条 undefined 形态占满前 3 席）。
      const informativeness = (r: CallRecord): number => {
        if (r.resultType.kind === "unknown") return 2;
        if (r.resultType.kind === "never") return 1;
        return 0;
      };
      const ordered = records
        .map((r, i) => ({ r, i }))
        .sort((a, b) => informativeness(a.r) - informativeness(b.r) || a.i - b.i)
        .map(({ r }) => r);
      const precise = ordered.slice(0, MAX_PRECISE_CALLSITE_CASES);
      for (const rec of precise) {
        candidate.analysis.cases.push({
          name: `call@L${rec.callLoc?.line ?? candidate.analysis.loc.start.line}`,
          args: rec.argTypes,
          result: rec.resultType,
          throws: rec.throws,
          source: "callsite",
        });
      }
      // symbolic 聚合只用全已知实参的记录：含 unknown 分量的记录不可重求值
      // （unknown 吸收整个 union，一条循环引用 fixture 的记录就能毒化全部
      // 剩余聚合——clone 704 条中的 53 条 unknown 实参曾拖垮其余 651 条）。
      // 排除不声明覆盖，sound；全部不可求值时不产 symbolic case（诚实）。
      const remaining = ordered
        .slice(MAX_PRECISE_CALLSITE_CASES)
        .filter((rec) => !rec.argTypes.some((a) => a.kind === "unknown"));
      if (remaining.length > 0) {
        const fnNode = resolveFunctionNode(candidate.node);
        const paramCount = extractParamNames(fnNode).length;
        const widenedArgs = Array.from({ length: paramCount }, (_, i) =>
          // 缺参按真实 JS 语义 widen 成 undefined 而非 unknown——可选参守卫
          // （target || [] 等）对 unknown 全塌，对 undefined 正常走默认分支
          widenType(simplifyUnion(remaining.map((rec) => rec.argTypes[i] ?? T.undefined))),
        );
        const full = evaluateFunctionFull(fnNode, widenedArgs, globalEnv);
        candidate.analysis.cases.push({
          name: "call@symbolic",
          args: widenedArgs,
          result: full.value,
          throws: full.throws,
          throwLoc: full.throwLoc,
          source: "callsite",
          aggregatedFrom: remaining.length,
        });
      }
      // Combined covers every observed call site (not just the retained
      // cases), so a large set of same-base literal results collapses to
      // the widened base type instead of a 20-literal union.
      candidate.analysis.combined = collapseLiteralUnion(
        simplifyUnion(records.map((r) => r.resultType)),
        COLLAPSE_LITERAL_THRESHOLD,
      );
      continue;
    }

    const fnNode = resolveFunctionNode(candidate.node);
    const args = extractParamNames(fnNode).map(() => T.unknown);
    const full = evaluateFunctionFull(fnNode, args, globalEnv);
    candidate.analysis.cases.push({
      name: `entry@L${candidate.analysis.loc.start.line}`,
      args,
      result: full.value,
      throws: full.throws,
      throwLoc: full.throwLoc,
    });
    candidate.analysis.entryOnly = true;
    candidate.analysis.combined = collapseLiteralUnion(full.value, COLLAPSE_LITERAL_THRESHOLD);
  }

  buildNodeTypeMap(ast, globalEnv, nodeTypeMap);

  setUnknownBuiltinHandler(null);
  setCallCollector(null);
  setUnknownCollector(null);
  setProvenanceTracking(false);
  setModuleResolver(null);
  resetEnvModules();
  resetMockModules();

  // usage-site 执行泄漏守卫：case 合成重求值会执行注入实参携带的使用现场
  // 闭包体（测试回调），其内部错误记录属于使用现场文件——不能记在本文件
  // 名下（wait.js 曾背着 test/index.js:2407 的 no-method；json-ext 的
  // slices.map 行号落在本文件行数内骗过纯行数守卫）。标记在 analyzeFile
  // 入口处打；行数上限保留兜底（防无标记路径）。
  const maxLine = source.split("\n").length;
  diagnostics.push(
    ...unknownRecordsToDiagnostics(
      unknownRecords.filter(
        (r) => (r.loc?.line ?? 0) <= maxLine && r.originModule !== USAGE_SITE_MODULE,
      ),
    ),
  );

  const externalFunctions = synthesizeExternalFunctions(callRecords, filePath);

  return {
    functions: functionResults,
    diagnostics,
    bindings,
    nodeTypeMap,
    caseHints,
    ...(externalFunctions.length > 0 ? { externalFunctions } : {}),
  };
}

function collectBindings(ast: Node, env: Environment, bindings: Map<string, BindingInfo>): void {
  if (ast.type !== "File") return;
  for (const stmt of (ast as any).program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) {
      const val = env.has(stmt.id.name) ? env.lookup(stmt.id.name) : T.unknown;
      bindings.set(stmt.id.name, { type: val, loc: locFromNode(stmt) });
    }
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations) {
        if (decl.id.type === "Identifier") {
          const val = env.has(decl.id.name) ? env.lookup(decl.id.name) : T.unknown;
          bindings.set(decl.id.name, { type: val, loc: locFromNode(decl) });
        }
      }
    }
    if (stmt.type === "ClassDeclaration" && stmt.id) {
      const val = env.has(stmt.id.name) ? env.lookup(stmt.id.name) : T.unknown;
      bindings.set(stmt.id.name, { type: val, loc: locFromNode(stmt) });
    }
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      collectBindings({ type: "File", program: { type: "Program", body: [stmt.declaration] } } as any, env, bindings);
    }
  }
}

function buildNodeTypeMap(ast: Node, env: Environment, nodeTypeMap: Map<Node, TypeValue>): void {
  const traverseFn = (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
  try {
    traverseFn(ast, {
      enter(path) {
        const node = path.node;
        try {
          if (
            node.type === "Identifier" &&
            node.name !== "undefined" &&
            path.parentPath?.node.type !== "FunctionDeclaration" &&
            path.parentPath?.node.type !== "VariableDeclarator"
          ) {
            if (env.has(node.name)) {
              nodeTypeMap.set(node, env.lookup(node.name));
            }
          }
          if (node.type === "NumericLiteral") {
            nodeTypeMap.set(node, T.literal(node.value));
          }
          if (node.type === "StringLiteral") {
            nodeTypeMap.set(node, T.literal(node.value));
          }
          if (node.type === "BooleanLiteral") {
            nodeTypeMap.set(node, T.literal(node.value));
          }
          if (node.type === "NullLiteral") {
            nodeTypeMap.set(node, T.null);
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

export type CaseInfo = {
  functionName: string;
  caseName: string;
  caseIndex: number;
};

export function getCasesForFile(filePath: string, source: string): { functionName: string; cases: { name: string; index: number }[]; loc: SourceLocation }[] {
  const ast = parse(source);
  const functions = extractDirectives(ast);
  return functions.map((fn) => {
    const cases = fn.directives
      .filter((d) => d.kind === "case")
      .map((d, i) => ({ name: d.name, index: i }));
    return { functionName: fn.name, cases, loc: locFromNode(fn.node) };
  });
}

/** Async entry to getTypeAtPosition with path-env preloading (see analyzeFileAsync). */
export async function getTypeAtPositionAsync(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
): Promise<TypeValue | null> {
  const envNames = collectEnvNames(filePath, source, false);
  if (envNames.length > 0) {
    await preloadPathEnvs(envNames, dirname(filePath));
  }
  return getTypeAtPosition(filePath, source, line, column, activeCases);
}

export function getTypeAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
): TypeValue | null {
  const ast = parse(source);
  resetMemo();
  resetEnvModules();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));
  setCurrentSource(source);

  const fileDirectives = extractFileDirectives(ast);
  const envNames = fileDirectives
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);

  const globalEnv = createEnvironment();

  if (envNames.length > 0) {
    const loaded = loadEnvs(envNames, globalEnv);
    setEnvModules(loaded.modules);
  }

  evaluateProgram(ast, globalEnv);

  const nodeTypeMap = new Map<Node, TypeValue>();
  buildNodeTypeMap(ast, globalEnv, nodeTypeMap);

  const functions = extractDirectives(ast);
  const enclosingFn = findEnclosingFunction(functions, line);

  if (enclosingFn) {
    const caseDirectives = enclosingFn.directives.filter((d) => d.kind === "case");
    if (caseDirectives.length > 0) {
      const caseIndex = activeCases?.get(enclosingFn.name) ?? 0;
      const directive = caseDirectives[Math.min(caseIndex, caseDirectives.length - 1)];

      const fnNodeTypeMap = new Map<Node, TypeValue>();
      setNodeTypeCollector((node, tv) => fnNodeTypeMap.set(node, tv));
      evaluateFunctionFull(enclosingFn.node, directive.args, globalEnv);
      setNodeTypeCollector(null);

      for (const [node, tv] of fnNodeTypeMap) {
        nodeTypeMap.set(node, tv);
      }
    }
  }

  setModuleResolver(null);
  resetEnvModules();
  resetMockModules();
  return findBestTypeAtPosition(nodeTypeMap, globalEnv, ast, line, column);
}

function findEnclosingFunction(
  functions: FunctionWithDirectives[],
  line: number,
): FunctionWithDirectives | null {
  for (const fn of functions) {
    const loc = fn.node.loc;
    if (!loc) continue;
    if (loc.start.line <= line && loc.end.line >= line) {
      return fn;
    }
  }
  return null;
}

function findBestTypeAtPosition(
  nodeTypeMap: Map<Node, TypeValue>,
  globalEnv: Environment,
  ast: Node,
  line: number,
  column: number,
): TypeValue | null {
  let bestMatch: TypeValue | null = null;
  let bestSize = Infinity;

  for (const [node, tv] of nodeTypeMap) {
    const loc = node.loc;
    if (!loc) continue;
    if (
      loc.start.line <= line &&
      loc.end.line >= line &&
      (loc.start.line < line || loc.start.column <= column) &&
      (loc.end.line > line || loc.end.column >= column)
    ) {
      const size = (loc.end.line - loc.start.line) * 10000 + (loc.end.column - loc.start.column);
      if (size < bestSize) {
        bestSize = size;
        bestMatch = tv;
      }
    }
  }

  if (!bestMatch) {
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (identAtPos && globalEnv.has(identAtPos)) {
      bestMatch = globalEnv.lookup(identAtPos);
    }
  }

  return bestMatch;
}

function findIdentifierAtPosition(ast: Node, line: number, column: number): string | null {
  let found: string | null = null;
  const traverseFn = (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
  try {
    traverseFn(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (
          loc.start.line === line &&
          loc.start.column <= column &&
          loc.end.column >= column
        ) {
          found = path.node.name;
          path.stop();
        }
      },
    });
  } catch {
    // ignore
  }
  return found;
}

export function getCompletionsAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
): CompletionItem[] {
  const textBefore = getTextBeforePosition(source, line, column);
  const dotMatch = textBefore.match(/(\w+)\.\s*\w*$/);
  if (!dotMatch) return getVariableCompletions(filePath, source);

  const objName = dotMatch[1];

  const safeSource = sanitizeSourceForParsing(source);

  let ast;
  try {
    ast = parse(safeSource);
  } catch {
    try {
      ast = parse(source);
    } catch {
      return [];
    }
  }

  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  if (!globalEnv.has(objName)) {
    setModuleResolver(null);
    return [];
  }

  const objType = globalEnv.lookup(objName);
  const completions = getCompletionsForType(objType);

  setModuleResolver(null);
  return completions;
}

function sanitizeSourceForParsing(source: string): string {
  return source.replace(/(\w+)\.\s*$/gm, "$1._ ");
}

function getTextBeforePosition(source: string, line: number, column: number): string {
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) return "";
  return lines[line - 1].slice(0, column);
}

function getVariableCompletions(filePath: string, source: string): CompletionItem[] {
  const ast = parse(source);
  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  const ownBindings = globalEnv.getOwnBindings();
  const completions: CompletionItem[] = [];
  for (const [name, tv] of Object.entries(ownBindings)) {
    if (name.startsWith("__export_")) continue;
    completions.push({
      label: name,
      kind: tv.kind === "function" ? "method" : "variable",
      detail: typeValueToString(tv),
    });
  }

  setModuleResolver(null);
  return completions;
}

function getCompletionsForType(tv: TypeValue): CompletionItem[] {
  const completions: CompletionItem[] = [];

  if (tv.kind === "object") {
    for (const [key, val] of Object.entries(tv.properties)) {
      completions.push({
        label: key,
        kind: val.kind === "function" ? "method" : "property",
        detail: typeValueToString(val),
      });
    }
    return completions;
  }

  if (tv.kind === "instance") {
    for (const [key, val] of Object.entries(tv.properties)) {
      completions.push({
        label: key,
        kind: val.kind === "function" ? "method" : "property",
        detail: typeValueToString(val),
      });
    }
    return completions;
  }

  if (tv.kind === "array" || tv.kind === "tuple") {
    const arrayMethods = [
      { label: "map", detail: "map(callback)" },
      { label: "filter", detail: "filter(callback)" },
      { label: "reduce", detail: "reduce(callback, init)" },
      { label: "find", detail: "find(callback)" },
      { label: "some", detail: "some(callback)" },
      { label: "every", detail: "every(callback)" },
      { label: "forEach", detail: "forEach(callback)" },
      { label: "flatMap", detail: "flatMap(callback)" },
      { label: "includes", detail: "includes(value)" },
      { label: "indexOf", detail: "indexOf(value)" },
      { label: "join", detail: "join(separator)" },
      { label: "slice", detail: "slice(start, end)" },
      { label: "concat", detail: "concat(other)" },
      { label: "push", detail: "push(value)" },
      { label: "length", detail: tv.kind === "tuple" ? `${tv.elements.length}` : "number" },
    ];
    for (const m of arrayMethods) {
      completions.push({ label: m.label, kind: "method", detail: m.detail });
    }
    return completions;
  }

  if (tv.kind === "promise") {
    completions.push({ label: "then", kind: "method", detail: "then(callback)" });
    completions.push({ label: "catch", kind: "method", detail: "catch(callback)" });
    completions.push({ label: "finally", kind: "method", detail: "finally(callback)" });
    return completions;
  }

  if (tv.kind === "primitive" && tv.type === "string") {
    const stringMethods = ["toUpperCase", "toLowerCase", "trim", "split", "slice", "includes", "indexOf", "replace", "startsWith", "endsWith", "charAt", "length"];
    for (const m of stringMethods) {
      completions.push({ label: m, kind: "method", detail: `string.${m}` });
    }
    return completions;
  }

  return completions;
}

export type { CallRecord } from "@nudojs/cli/evaluator";
