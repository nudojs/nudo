/**
 * 调用 Abs 一等函数（absFunction impl）或 mock apply。
 * 供 B 路径 import 绑定包装：`(...args) => $call(absFn, args)`。
 *
 * 统一顺序：apply → body → relation → isRelFn（委托 applyAbsFn）。
 * 行为对齐说明（与旧 $call 的差异，均属刻意）：
 * 1. 带 body 的函数也进 call-budget（与 ast-eval 同轨；递归会 truncated 而非爆栈）
 * 2. body 抛错 → never（applyAbsFn 内恢复，不返回中间值）
 * 3. 无 impl 时 isRelFn 可走 E 路径（旧版恒 unknown）
 */

import type { Abs } from "../abs.ts";
import { applyAbsFn, emptyEnv } from "../ast-eval.ts";
import { defaultLeakBudget } from "../leak.ts";
import { pTrue } from "../pred.ts";

export function $call(fn: Abs, args: Abs[]): Abs {
  return applyAbsFn(fn, args, emptyEnv(), pTrue, defaultLeakBudget);
}
