/**
 * B 路径 throw 载荷（独立叶子模块）：
 * builtins.ts（evalJsonMethod 等 Abs builtin）需要硬抛 TypeError/SyntaxError，
 * 而 exec/runtime.ts 又 import builtins.ts（evalNamespaceCall 等）——
 * 直接互引成环。NudoThrow 无依赖（仅 Abs 类型 + Error），抽成叶子，
 * runtime.ts re-export 保持既有 import 面不变。
 */
import type { Abs } from "../abs.ts";

/** B 路径 throw 载荷：携带 Abs 抛出值 */
export class NudoThrow extends Error {
  readonly absValue: Abs;
  constructor(absValue: Abs) {
    super("nudo:throw");
    this.name = "NudoThrow";
    this.absValue = absValue;
  }
}

export function isNudoThrow(e: unknown): e is NudoThrow {
  return e instanceof NudoThrow;
}
