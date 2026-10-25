/**
 * evaluator 运行时绑定表（惰性单例）+ 编译单元脚手架：
 * - rtAllBindings / runtimeArgNames / runtimeArgValues：new Function 的运行时
 *   形参与值（按名字同序）；
 * - compileRuntimeUnit：`new Function(...运行时形参, extra, code)` 的唯一
 *   拼装点（run.ts 模块体 / evalExprAbs / body-fn 三处共用）。
 *
 * 从 run.ts 拆出——body-fn（$call 编译执行）与 run.ts 共用，避免
 * run → calls → call → body-fn → run 的模块初始化环（rtAll 顶层
 * spread 会在环内触发 ReferenceError）。
 */
import * as runtime from "./runtime.ts";
import * as classRt from "./class.ts";
import * as callsRt from "./calls.ts";
import {
  isNudoThrow,
  isNudoReturn,
  $isForkExit,
  runWithLoopExits,
  takeLoopExits,
  takeThrowExits,
} from "./runtime.ts";
// Bug 201：async 体的真挂起驱动（生成器路径）——**内部**运行时符号：
// 不进 runtime.ts facade（facade 只再导出公开符号面），只进绑定表。
import { $asyncGen } from "./runtime/async.ts";
import { $call } from "./call.ts";
// Bug 325：函数**声明**形态的种类戳（宿主普通函数无法回推 async/generator）
import { $fnKindStamp } from "./runtime/state.ts";

let cached: Record<string, unknown> | undefined;

export function rtAllBindings(): Record<string, unknown> {
  if (!cached) {
    cached = { ...runtime, ...classRt, ...callsRt };
    // ensure control-flow helpers are present even if a re-export layer omits them
    cached.isNudoReturn = isNudoReturn;
    cached.isNudoThrow = isNudoThrow;
    cached.$isForkExit = $isForkExit;
    cached.runWithLoopExits = runWithLoopExits;
    cached.takeLoopExits = takeLoopExits;
    cached.takeThrowExits = takeThrowExits;
    cached.$call = $call;
    // Bug 325：种类戳符号（产物代码按名 import 的同一符号，见 exec/index.ts）
    cached.$fnKindStamp = $fnKindStamp;
    // Bug 201：async 体（含 await）编译成宿主生成器，由本符号驱动挂起/恢复
    cached.$asyncGen = $asyncGen;
  }
  return cached;
}

/**
 * 编译单元的运行时形参名（与 runtimeArgValues 一一对应）。
 *
 * - `dollarOnly = true`（模块体路径）：只取 `$` 前缀的运算符名——`__nudo*`
 *   宿主注入名由 run.ts 追加；非 `$` 的绑定（isNudoReturn / takeThrowExits
 *   等）不进模块体形参面（模块体不按这些名字引用，旧口径如此）。
 * - `dollarOnly = false`（evalExprAbs / body-fn 单单元路径）：全部绑定名。
 *
 * 键序 = rtAllBindings 的插入序（缓存对象，稳定）；名字与值必须同序取。
 */
export function runtimeArgNames(dollarOnly = false): string[] {
  const keys = Object.keys(rtAllBindings());
  return dollarOnly ? keys.filter((k) => k.startsWith("$")) : keys;
}

/** runtimeArgNames 同序的绑定值（同一缓存表，逐名读取）。 */
export function runtimeArgValues(dollarOnly = false): unknown[] {
  const all = rtAllBindings();
  return runtimeArgNames(dollarOnly).map((n) => all[n]);
}

/**
 * 编译运行时单元：`new Function(...运行时形参, ...extraNames, code)`。
 *
 * 返回值仍需由调用方按 `[...runtimeArgValues(...), ...extraValues]` 同序调用
 * （编译与执行分离：模块体路径的编译失败必须发生在 sink/epoch 建立之前，
 * 与重构前的「先 new Function、后 beginClassEpoch」时序一致）。
 * 形参/值顺序与三处旧展开逐项一致：运行时绑定在前，extraNames 在后。
 */
export function compileRuntimeUnit<T = unknown>(
  code: string,
  extraNames: readonly string[] = [],
  opts: { dollarOnly?: boolean } = {},
): (...vals: unknown[]) => T {
  const names = [...runtimeArgNames(opts.dollarOnly ?? false), ...extraNames];
  return new Function(...names, code) as (...vals: unknown[]) => T;
}
