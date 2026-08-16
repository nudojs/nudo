import { readFileSync, existsSync } from "node:fs";
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

function resolveModule(source: string, fromDir: string): { ast: ReturnType<typeof parse>; filePath: string; json?: unknown } | null {
  const extensions = [".js", ".ts", ".mjs"];

  const nudoPath = resolveNpmNudo(source, fromDir);
  if (nudoPath) {
    const src = readFileSync(nudoPath, "utf-8");
    return { ast: parse(src), filePath: nudoPath };
  }

  const basePath = resolve(fromDir, source);
  for (const ext of ["", ...extensions]) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) {
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

/** Statically extract each file's relative import edges (extension resolution identical to CLI resolveModule: ''/'.js'/'.ts'/'.mjs'; bare npm specifiers skipped). */
export function buildModuleGraph(files: string[]): {
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
    let ast: ReturnType<typeof parse>;
    try {
      ast = parse(readFileSync(file, "utf-8"));
    } catch {
      continue;
    }
    for (const stmt of ast.program.body) {
      if (stmt.type !== "ImportDeclaration") continue;
      const specifier = stmt.source.value;
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue;
      const resolved = resolveImportPath(specifier, dirname(file));
      if (resolved) edge(file, resolved);
    }
  }
  return { imports, dependents };
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

function typeStructureKey(tv: TypeValue): string {
  switch (tv.kind) {
    case "literal":
      return `lit(${typeof tv.value}:${String(tv.value)})`;
    case "primitive":
      return `prim(${tv.type})`;
    case "array":
      return `arr(${typeStructureKey(tv.element)})`;
    case "tuple":
      return `tup(${tv.elements.map(typeStructureKey).join(",")})`;
    case "object":
      return `obj(${Object.keys(tv.properties).sort().map((k) => `${k}:${typeStructureKey(tv.properties[k])}`).join(",")})`;
    case "function":
      return `fn(${tv.params.join(",")})`;
    case "promise":
      return `prom(${typeStructureKey(tv.value)})`;
    case "instance":
      return `inst(${tv.className})`;
    case "refined":
      return `ref(${typeStructureKey(tv.base)})`;
    case "union":
      return `uni(${tv.members.map(typeStructureKey).sort().join("|")})`;
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
    const key = rec.argTypes.map(typeStructureKey).join(",");
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
          widenType(simplifyUnion(remaining.map((rec) => rec.argTypes[i] ?? T.unknown))),
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
      const isApprox = (() => {
        const members =
          receiver.kind === "union" ? receiver.members : [receiver];
        return members.every(
          (m) => m.kind === "instance" || m.kind === "function",
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
): Promise<AnalysisResult> {
  const envNames = collectEnvNames(filePath, source, true);
  if (envNames.length > 0) {
    await preloadPathEnvs(envNames, dirname(filePath));
  }
  return analyzeFile(filePath, source, activeCases);
}

export function analyzeFile(filePath: string, source: string, activeCases?: Map<string, number>): AnalysisResult {
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
    applyMocks(fn.directives, globalEnv, filePath, diagnostics);

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

  for (const candidate of synthCandidates) {
    const records = dedupeCallRecords(callRecords.filter((r) => r.fnName === candidate.name));
    if (records.length > 0) {
      const precise = records.slice(0, MAX_PRECISE_CALLSITE_CASES);
      for (const rec of precise) {
        candidate.analysis.cases.push({
          name: `call@L${rec.callLoc?.line ?? candidate.analysis.loc.start.line}`,
          args: rec.argTypes,
          result: rec.resultType,
          throws: rec.throws,
          source: "callsite",
        });
      }
      const remaining = records.slice(MAX_PRECISE_CALLSITE_CASES);
      if (remaining.length > 0) {
        const fnNode = resolveFunctionNode(candidate.node);
        const paramCount = extractParamNames(fnNode).length;
        const widenedArgs = Array.from({ length: paramCount }, (_, i) =>
          widenType(simplifyUnion(remaining.map((rec) => rec.argTypes[i] ?? T.unknown))),
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

  diagnostics.push(...unknownRecordsToDiagnostics(unknownRecords));

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
