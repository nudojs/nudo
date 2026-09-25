/**
 * analyzer 共享类型（自 analyzer.ts god-file 机械拆出）。
 * 只含类型，无运行时逻辑——供 module-load / diagnose / cache / orchestrate 共用。
 */
import type { Node } from "@babel/types";
import type { Abs, FormalParam } from "@nudojs/core";

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
  /** C4.1 形参表面：draft/契约对齐（解构 placeholder + bound 名） */
  formals?: FormalParam[];
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
  /**
   * HOF / entry shape 关系快照（generalizeFromAst），供 dts 泛型投影（C3.3）。
   * 只存投影所需的 Abs，不挂 PolyFn 本体（缓存可克隆）。
   */
  hof?: {
    /** 函数形参：外延关系 Abs（fn 形状，paramTypes/returnType） */
    fnRels?: Array<{ param: string; abs: Abs }>;
    /** 值形参提升快照（如 items → arr(A1)） */
    entryShapes?: Array<{ param: string; abs: Abs }>;
    /** 符号返回 Abs（含自由 α / B:param） */
    symbolic?: Abs;
  };
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

/** Optional module loader for analysis (sidecar / relative imports). */
export type AnalyzeLoadModule = (spec: string, fromFile: string) => string | undefined;

/**
 * `@nudo:case` 求值档：
 * - `none`（默认）：不跑 case；有 case 的函数也走 entry@ 出签名（check / IDE）
 * - `all`：逐 case 真跑（`nudo test` / CaseJson / freeze）
 * - `selected`：只跑 `activeCases` 选中的那条（LSP selectCase）
 */
export type DirectiveCaseMode = "none" | "all" | "selected";

