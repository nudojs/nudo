/**
 * 域共享标记（issue #175 残留修复）。
 *
 * 背景：`arr` shape 只有一个元素域 Abs（`{k:"arr", element}`），所有下标
 * 读 / for-of 单代表迭代 / 回调元素实参分发的是**同一对象**——但它代表
 * 「任意元素」，两次分发对应**不同具体值**。`abstractLen` 的 lenTermMemo
 * 按 Abs 身份键控，会在两处分发上铸同一 `len#N`，sub 自反折叠
 * （termEquals ∧ isDeterministicTerm ⇒ x−x=0）据此把
 * `xs[0].length - xs[1].length` 假折成 exact 0（不同槽位、不同长度）。
 *
 * 修法：元素域**分发位**（$idx 具体下标读、elemsOf arr 臂、Array.from
 * mapFn 元素实参、数组方法回调元素实参）把域 Abs 标记为域共享；
 * `abstractLen` 对标记接收者**不 memo**——每次读铸新 `len#N`，值身份
 * 只骑在确定性项相等上。原绑定接收者（形参 / const 局部量）不受影响
 * （`a.length - a.length` 仍折 0，sound：同一绑定同一值）。
 *
 * 已知精度代价（sound 优先）：同一域值经两次分发读长不再折 0
 * （`xs[0].length - xs[0].length`，真值确为 0）——罕见形态，可接受。
 *
 * 叶子模块：只依赖 Abs 类型，containers / builtins / exec 三层均可导入。
 */
import type { Abs } from "./abs.ts";

const domainShared = new WeakSet<Abs>();

/** 标记 a 为域共享值（元素域分发），并原样返回（内联包裹友好）。 */
export function markDomainShared<T extends Abs>(a: T): T {
  domainShared.add(a);
  return a;
}

/** a 是否域共享（元素域分发产物——跨读不保证同值）。 */
export function isDomainShared(a: Abs): boolean {
  return domainShared.has(a);
}
