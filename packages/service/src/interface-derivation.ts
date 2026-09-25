/**
 * Root 驱动的契约下行（design-refine-derivation §4.2 / §11 Phase 2）。
 *
 * 对含手写契约根的文件（lib.nudo.js 绑定 add4）：
 *   1. 从侧车 AST 抽出参数约束的源表达式（`positive` ← `./std.nudo.js`）；
 *   2. constraintToEntryAbs + tagDerivationRoot；
 *   3. B-path 求值 body（runTranspiled，模块图注入下游），收集调用记录 + 推导打点；
 *   4. 闭包内下游导出投影为组合式 DSL，禁止事后从 Abs 反编译链。
 *
 * check 分轨：每条 root 链独立；join 只用于工件聚合（多调用者）。
 *
 * 职责已按缝拆出（机械搬移，语义未改）：
 *   - interface-derivation-project.ts  槽位投影（project*Slot）
 *   - interface-derivation-derive.ts   extract 约束源 + deriveFromRoot
 *   - interface-derivation-rewrite.ts  标识符改写 + formatDerivedSection
 *   - interface-derivation-emit.ts     emitDerivedFromRoot + 侧车段工具
 */
export {
  type ConstraintSourceExpr,
  type DerivedExport,
  type DerivedParam,
  type RootDeriveOpts,
  type RootDeriveResult,
} from "./interface-derivation-project.ts";

export {
  extractFnConstraintSources,
  functionParamNames,
  deriveFromRoot,
} from "./interface-derivation-derive.ts";

export { formatDerivedSection } from "./interface-derivation-rewrite.ts";

export { emitDerivedFromRoot, type EmitDerivedResult } from "./interface-derivation-emit.ts";
