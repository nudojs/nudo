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
// Bug 201：async 体的真挂起驱动（生成器路径）——**内部**运行时符号：
// 不进 runtime.ts facade（facade 只再导出公开符号面），只进绑定表。
import { $asyncGen } from "./runtime/async.ts";
import { $call } from "./call.ts";

let cached: Record<string, unknown> | undefined;

export function rtAllBindings(): Record<string, unknown> {
  if (!cached) {
    cached = { ...runtime, ...classRt, ...callsRt };
    // facade 之外的内部符号（不进 runtime.ts 公开面，但转译产物按名引用）
    cached.$call = $call;
    // Bug 201：async 体（含 await）编译成宿主生成器，由本符号驱动挂起/恢复
    cached.$asyncGen = $asyncGen;
  }
  return cached;
}

/** 编译单元的运行时形参名（与 runtimeArgValues 一一对应）。 */
export function runtimeArgNames(): string[] {
  return Object.keys(rtAllBindings());
}

/** runtimeArgNames 同序的绑定值（同一缓存表，逐名读取）。 */
export function runtimeArgValues(): unknown[] {
  const all = rtAllBindings();
  return runtimeArgNames().map((n) => all[n]);
}

/** 模块体单元的运行时形参名：只取 `$` 前缀的运算符名——`__nudo*` 宿主
 *  注入名由 run.ts 追加；非 `$` 的绑定（isNudoReturn / takeThrowExits 等）
 *  不进模块体形参面（模块体不按这些名字引用）。 */
export function runtimeModuleArgNames(): string[] {
  return runtimeArgNames().filter((k) => k.startsWith("$"));
}

/** runtimeModuleArgNames 同序的绑定值。 */
export function runtimeModuleArgValues(): unknown[] {
  const all = rtAllBindings();
  return runtimeModuleArgNames().map((n) => all[n]);
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
): (...vals: unknown[]) => T {
  const names = [...runtimeArgNames(), ...extraNames];
  return new Function(...names, code) as (...vals: unknown[]) => T;
}

/** 模块体编译单元：只注入 `$` 前缀运行时符号 + 调用方 extra。 */
export function compileRuntimeModuleUnit<T = unknown>(
  code: string,
  extraNames: readonly string[] = [],
): (...vals: unknown[]) => T {
  const names = [...runtimeModuleArgNames(), ...extraNames];
  return new Function(...names, code) as (...vals: unknown[]) => T;
}
