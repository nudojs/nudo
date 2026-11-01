/**
 * yield 点 try 上下文位值（Bug 52）——**唯一事实源**（无依赖叶子：本文件
 * 不 import 任何模块）。transpile 侧（stmt/statement.ts 静态标注）与
 * runtime 侧（runtime/async.ts 消费）共引本文件，不再以数值字面量/钉死
 * 注释各自维护一份。
 *
 * 位语义：1 = 外层任一 try 带 finally；2 = 外层任一 try 带 catch。
 * finalizer 静态事实（.transpile 标注）：4 = 最近 finalizer 含
 * yield/yield*（.return 后可再交付 → done 并 boolean）；8 = 最近 finalizer
 * 含 return（.return 注入值可被覆盖 → 值并 unknown）。
 * catch 静态事实（R1a，最近 enclosing catch）：16 = catch 体含 return
 * （吸收后完成）；32 = catch 体含 yield/yield*（吸收后续体可再交付）；
 * 64 = catch 体可能 rethrow 且外层还有 catch（吸收结局不可静态分类——
 * 内层重抛会被外层 catch 二次吸收，外层 catch 事实未标注）。
 */
export const YIELD_TRY_FINALLY = 1;
export const YIELD_TRY_CATCH = 2;
export const YIELD_FINALLY_YIELDS = 4;
export const YIELD_FINALLY_RETURNS = 8;
export const YIELD_CATCH_RETURNS = 16;
export const YIELD_CATCH_YIELDS = 32;
export const YIELD_CATCH_RETHROWS = 64;
/** R1a：yield* 委托进**生成器对象**的 yield 点位（$yieldStar 运行时标注，
 *  非 transpile）：.throw() 原生转发进内层迭代器——内层 catch 吸收后续体
 *  （可再交付）超出外层 ctx 可分类面 → 吸收结局不可折 done。数组/字符串
 *  等无 throw() 方法的内层：原生 TypeError 回注外层帧 → 外层 catch 吸收
 *  （可折），不置位。 */
export const YIELD_DELEGATED_GEN = 128;
