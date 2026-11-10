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
  /**
   * 「第三种」（2026-11-06）：源码**返回类型注解原文**（`strip-types.ts`
   * 写在函数节点上的 `nudoReturnTypeText` 旁路）。此前全仓只有写入、无读取点。
   *
   * 只透传文本，**不参与推断、不覆盖产物**：实现是事实，声明是断言。
   * dts 投影面拿它做一致性校验，冲突落 `nudo:return-annotation-mismatch`
   * 台账，产物恒用观测口径（避免 BUG-168 在形参位修掉的「两面相反」在
   * 返回位复现）。缺省 = .js 源 / 未标注 ⇒ 零影响。
   */
  declaredReturnType?: string;
  cases: CaseResult[];
  /** cases 结果 Abs 的 join；dts 返回位源。skip 函数恒为声明面（@nudo:skip =>），case 结果不参与（#176） */
  combinedAbs?: Abs;
  entryOnly?: boolean;
  /**
   * **函数级 throws 域**（族 54 · item 2）：check 签名行口径 = 入口求值的
   * hard throw ∪ soft may-throw。
   *
   * 与 `cases[].throwsAbs`（**该条见证自身**观测到的抛）**分属两面** ——
   * 把两者并进同一字段 ⇒ 调用点见证被标成「可能抛」⇒ 草稿面
   * （按「这次调用抛了吗」筛返回义务）丢返回义务 ⇒ **契约产物变弱**（假绿方向）。
   *
   * 承载位的选择：函数级（这里）而不是每条见证 —— 函数级 throws 域**本来就是
   * 函数属性**，每条见证各带一份会与「该见证自己的抛」混为一谈。
   */
  entryThrowsAbs?: Abs;
  /** @nudo:skip：只跳过推断面（combinedAbs=声明面，无 synth/hof）；@nudo:case 照常求值断言（#176） */
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
  /**
   * BUG-035（证据范围）：该函数的 callsite 证据里**混入了外部记录**
   * （`--from` 采集的使用现场调用 —— 不属于模块图闭包，本轮没采集
   * ≠ 证据消失）。
   *
   * 侧车生成段据此落 `// evidence: local|external`：只有 `local` 段在
   * 「今天没证据」时可证「证据没了」⇒ 才允许删段（**宽域段也适用**，
   * 这是 BUG-035 最后一条残差的收口点）；`external` 段与旧侧车（无标记）
   * 一律保守保留。
   */
  externalEvidence?: boolean;
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
  /**
   * ABS-04：默认互斥下「同时存在 @nudo:case 与调用点记录」的函数名
   * （观察提示用；消费面提示 `--both-paths`，不改变默认报告）。
   */
  bothPathsHint?: string[];
};

export type CompletionItem = {
  label: string;
  /**
   * 补全项类别：
   * - "function"：**顶层**函数绑定（模块级 fn）——LSP `CompletionItemKind.Function`
   * - "method"：**成员**函数（`obj.m` / 内置原型方法）
   * - "property"：成员属性
   * - "variable"：非函数绑定
   *
   * "function" 与 "method" 必须分开：模块级函数不是任何对象的成员，
   * 标成 Method 会让 IDE 把它渲染成「方法」并与成员方法混同（Bug 717）。
   */
  kind: "property" | "method" | "variable" | "function";
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

/**
 * `--both-paths`（`nudo test`）：对**带 @nudo:case 的函数**同轮也走合成路径
 * （call@/entry@），directive case 与合成 case 同轮同报（教学对比面）。
 * - `true`：全部带 case 的函数
 * - 名单（CLI `--only a,b`）：仅列出的函数
 *
 * 与 `DirectiveCaseMode` 正交：mode 决定「跑哪些 @nudo:case」，本开关决定
 * 「跑了 case 的函数是否**仍**进 synthCandidates」（默认互斥——见
 * docs/design/limitations.md §3.2.1）。pointWitnessOnly 的 domainOnly 语义
 * 不受影响（点观测函数照旧只作推断域）。
 */
export type AlsoSynthesizeCases = boolean | readonly string[];

