/**
 * 语句谓词统一入口：控制流 / nullish / typeof / 判别式 / switch / 关系 / NaN。
 *
 * 实现按守卫族拆到同目录模块；本文件只保留 re-export，供既有 import 使用。
 */
export {
  completeElseChain,
  completeElseChains,
  isTerminalStmt,
  stmtCompletesControl,
  stmtReturns,
  withImplicitReturn,
} from "./predicates-control.ts";
export * from "./predicates-nullish.ts";
export * from "./predicates-typeguard.ts";
export * from "./predicates-discriminant.ts";
export * from "./predicates-switch.ts";
export * from "./predicates-rel.ts";
