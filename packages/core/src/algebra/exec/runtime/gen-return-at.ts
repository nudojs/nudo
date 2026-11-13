/**
 * ABS-13：生成器对象的**按挂起点索引的 abrupt completion** 通道（leaf）。
 *
 * 背景：`$forOf` 在进循环前把生成器元素 **eager 排空**；循环体 `break` 时
 * 生成器内部已是 done 状态，直接调 `.return()` 只能得到「已耗尽」结局 ⇒
 * finalizer 无法按 native 在「已消费 i+1 个 yield」的挂起点重放。本注册表
 * 给每个生成器对象挂一个 `returnAt(k, v)`：把消费指针拨回第 k 个 yield，
 * 再走 `.return()` 的既有语义（快照回放 / finalizer 重放 / `yield*` 转发）。
 *
 * 纪律：
 * - 独立 leaf（只 `import type` Abs）——`iterate.ts` 与 `async.ts` 都依赖它，
 *   不能反向成环（同 `hooks.ts` 的教训：环上再导出行会拿到 undefined）。
 * - 帧不可用（路径敏感 / 延迟异常 / 委托 / 无快照）时返回 `undefined`：
 *   调用方必须回退到既有 sound 过近似，不得自行猜挂起点。
 */
import type { Abs } from "../../abs.ts";

export type GenReturnAt = (k: number, v: Abs) => Abs | undefined;

const registry = new WeakMap<object, GenReturnAt>();

export function registerGenReturnAt(gen: Abs, fn: GenReturnAt): void {
  registry.set(gen as object, fn);
}

export function genReturnAtOf(gen: Abs): GenReturnAt | undefined {
  return registry.get(gen as object);
}
