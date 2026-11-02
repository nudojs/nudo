/**
 * 语句 / 块发射：transpileStatement、transpileBodyNode、transpileFnBodyStmts。
 * class 发射（classSpecOf/transpileClass/访问器 thunk）在 ./class-emit.ts。
 * 按域拆分（facade 保持原导入面不变）：
 * - fn-body       方法/函数体统一发射（早退 if 提升 / var 提升 / 参数遮蔽扣除）
 * - statement     语句 switch 主分派 + 声明/return/表达式/变量/if 发射
 * - module-stmt   import / export 声明（ESM 与 host target 两面）
 * - loop-stmt     for / for-in / for-of / while / do-while（守卫剪影 + pack/unpack）
 * - switch-stmt   switch（臂合并 / 惰性 case 测试 / 臂级快照协议）
 * - try-stmt      try / catch / finally（soft 效果帧 / 模式参 / yield 位）
 * - block         块 thunk 化与 for-init 提名
 */
export {
  emitFnBlockBody,
  paramNamesOf,
  transpileFnBodyStmts,
  transpileBodyNode,
} from "./stmt/fn-body.ts";
export { transpileStatement } from "./stmt/statement.ts";
export {
  transpileBlockAsThunk,
  extractForInitName,
} from "./stmt/block.ts";

// 控制流谓词 → stmt/predicates.ts（leaf）
export {
  stmtCompletesControl,
  stmtReturns,
  isTerminalStmt,
  completeElseChain,
  completeElseChains,
  withImplicitReturn,
} from "./stmt/predicates.ts";
