/**
 * 求值引擎 throw 载荷（内核叶子模块）。
 * 历史：builtins.ts（evalJsonMethod 等 Abs builtin）需要硬抛
 * TypeError/SyntaxError，而 exec/runtime.ts 又 import builtins.ts
 * （evalNamespaceCall 等）——直接互引成环，故 NudoThrow 抽成无依赖叶子
 * （仅 Abs 类型 + Error）。
 * 现居 algebra/：Abs 代数内核（arithmetic/surface/methods、builtins/*）
 * 也消费它，而内核不得 import exec/（exec 是引擎消费者，不是真理源）——
 * exec/nudo-throw.ts re-export 维持引擎侧既有 import 面不变。
 */
import type { Abs } from "./abs.ts";

/** 求值引擎 throw 载荷：携带 Abs 抛出值 */
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
