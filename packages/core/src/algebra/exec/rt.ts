/**
 * evaluator 运行时绑定表（惰性单例）+ 编译单元脚手架。
 *
 * 形参/值**成对**使用，两套不可互换（两边都是 `unknown[]`：错配不会报类型
 * 错、也不会在编译期抛——每个形参只会静默绑到错误的值）：
 * - `compileRuntimeUnit` ↔ `runtimeArgValues()`：**全量**运行时绑定——宿主
 *   单元面（run.ts 的 evalExprAbs、exec/body-fn.ts 的 body 单元）；
 * - `compileRuntimeModuleUnit` ↔ `runtimeModuleArgValues()`：只注入 `$`
 *   前缀运算符名——run.ts 的模块体单元。
 *
 * 返回值仍需由调用方按 `[...对应 runtime*ArgValues(), ...extraValues]` 同序
 * 调用（extraNames 在后）——编译器会按形参个数校验实参，错配另一套值数组
 * 时直接抛错，而不是静默把每个形参绑到另一个符号。
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

/** 编译单元的运行时形参名（与 runtimeArgValues 一一对应；compileRuntimeUnit 的形参面）。 */
export function runtimeArgNames(): string[] {
  return Object.keys(rtAllBindings());
}

/** runtimeArgNames 同序的绑定值——只能喂给 compileRuntimeUnit 编译的单元。 */
export function runtimeArgValues(): unknown[] {
  const all = rtAllBindings();
  return runtimeArgNames().map((n) => all[n]);
}

/** 模块体单元的运行时形参名（与 runtimeModuleArgValues 一一对应；
 *  compileRuntimeModuleUnit 的形参面）：只取 `$` 前缀的运算符名——`__nudo*`
 *  宿主注入名由 run.ts 追加；非 `$` 的绑定（isNudoReturn / takeThrowExits 等）
 *  不进模块体形参面（模块体不按这些名字引用）。 */
export function runtimeModuleArgNames(): string[] {
  return runtimeArgNames().filter((k) => k.startsWith("$"));
}

/** runtimeModuleArgNames 同序的绑定值——只能喂给 compileRuntimeModuleUnit
 *  编译的模块体单元。 */
export function runtimeModuleArgValues(): unknown[] {
  const all = rtAllBindings();
  return runtimeModuleArgNames().map((n) => all[n]);
}

/**
 * 给编译单元加实参个数守卫：两套 compiler × `runtime*ArgValues` 的错配在
 * 形参面数量上必然不等（全量 vs `$` 前缀），在调用点立即抛错而不是让每个
 * 形参静默绑到错误的值。值数组按 `Reflect.apply` 前转，无逐参拷贝。
 */
function guardUnitArity<T>(
  unit: (...vals: unknown[]) => T,
  count: number,
  helper: string,
  valuesHelper: string,
): (...vals: unknown[]) => T {
  let verified = false;
  return function (this: unknown): T {
    if (!verified) {
      if (arguments.length !== count) {
        throw new Error(
          `${helper}: 形参 ${count} 个，实参 ${arguments.length} 个——` +
            `必须按 [...${valuesHelper}(), ...extraValues] 同序传入` +
            `（错配另一套 runtime*ArgValues 会静默把每个形参绑到错误的值）`,
        );
      }
      verified = true;
    }
    return Reflect.apply(unit, this, arguments) as T;
  };
}

/**
 * 宿主单元编译：`new Function(...运行时形参, ...extraNames, code)`（全量
 * 运行时绑定面）。调用时必须配 `[...runtimeArgValues(), ...extraValues]`。
 *
 * 消费方：run.ts 的 evalExprAbs、exec/body-fn.ts 的 body 单元。
 *
 * 编译与执行分离：模块体路径的编译失败必须发生在 sink/epoch 建立之前，
 * 与重构前的「先 new Function、后 beginClassEpoch」时序一致。
 * 形参/值顺序与三处旧展开逐项一致：运行时绑定在前，extraNames 在后。
 */
export function compileRuntimeUnit<T = unknown>(
  code: string,
  extraNames: readonly string[] = [],
): (...vals: unknown[]) => T {
  const names = [...runtimeArgNames(), ...extraNames];
  const unit = new Function(...names, code) as (...vals: unknown[]) => T;
  return guardUnitArity(unit, names.length, "compileRuntimeUnit", "runtimeArgValues");
}

/**
 * 模块体单元编译：只注入 `$` 前缀运行时符号 + 调用方 extra。调用时必须配
 * `[...runtimeModuleArgValues(), ...extraValues]`。
 *
 * 消费方：run.ts 的模块体单元。
 */
export function compileRuntimeModuleUnit<T = unknown>(
  code: string,
  extraNames: readonly string[] = [],
): (...vals: unknown[]) => T {
  const names = [...runtimeModuleArgNames(), ...extraNames];
  const unit = new Function(...names, code) as (...vals: unknown[]) => T;
  return guardUnitArity(unit, names.length, "compileRuntimeModuleUnit", "runtimeModuleArgValues");
}
