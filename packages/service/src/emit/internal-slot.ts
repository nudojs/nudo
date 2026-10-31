/**
 * 产物面（dts / schema / guard / standard）**不可见槽**的单一判据。
 *
 * 与 core 的 `format.ts`（投影面）/ `projection.ts`（约束面）/ `denote.ts`
 * （guard 面）**同判据**（同款 `isHiddenInternalSlot`）：
 *
 * `Slot.internal` 为 true 且键**不是**规范数组下标 ⇒ 该槽对属性 introspection
 * 不可见（不是自有可枚举属性）⇒ 不进 dts / schema / standard 产物。
 *
 * 不剔会污染产物面：生成器对象的协议槽（`next` / `return` / `throw` /
 * `constructor` / `@@iterator`）与私有字段（`#x`）是 internal 槽——原生挂在
 * 原型上、不是自有属性，却被投影成用户可见字段（`@@iterator` 更是 **symbol
 * 键**槽，按字符串键发布是错的）。
 *
 * 例外：**规范数组下标槽**保留——数组形态（`k:"arr"`）用它承载元素域。
 *
 * BUG-131：`Slot.symbolKey` 标记的槽（`o[Symbol("tag")] = …` / `[Symbol.iterator]()`）
 * 对**字符串键枚举面**不可见（原生 `Object.keys` / `JSON.stringify` 都看不到）
 * ⇒ 不得发布成 `"@@sym#1"` / `"@@iterator"` 这种**运行时不存在的属性名**。
 * 改前判据只看 `internal`，symbol 槽（非 internal 的那种）全部漏过 ⇒ zod / guard /
 * standard 产物恒假（拒绝正确值）。
 *
 * BUG-130：`isHiddenInternalSlot` 的「规范数组下标」例外本意是「数组下标槽承载
 * 元素域」，但**生成器的数字下标槽同样标 internal 且是数字下标** ⇒ 例外在生成器上
 * 误伤：运行时的生成器对象**没有任何自有属性**（`Object.keys` / `gOPN` / `for-in`
 * 恒空）⇒ 三个运行时产物面把元素域当自有字段发布 ⇒ **拒绝被导出函数自己的返回值**。
 * ⇒ 例外收窄为「形状确为**迭代器/生成器**（协议槽 `next` 在场）时，数字下标槽也
 * 不可见」；数组（`k:"arr"`）根本不走 obj 槽表，不受影响。
 *
 * 注：core 侧的同款副本（`format.ts` / `projection.ts` / `denote.ts`）尚带旧例外
 * ——check 签名面仍按「数字下标槽承载元素域」渲染（族 01 口径，设计明文），
 * 本文件只收口**产物面**（`packages/service/src/emit`）。
 */
import { canonicalArrayIndex } from "@nudojs/core";

/** 槽的可见性标记（`Slot` 的子集） */
export type SlotVisibility = { internal?: boolean; symbolKey?: boolean };

/** internal 槽判据（core 三面同款） */
export function isHiddenInternalSlot(k: string, slot: SlotVisibility): boolean {
  // BUG-131：symbol 键槽对字符串键面不可见（键根本不存在）
  if (slot.symbolKey === true) return true;
  return slot.internal === true && canonicalArrayIndex(k) === undefined;
}

/**
 * 迭代器 / 生成器对象形态：协议槽 `next` 在场（与 dts 面 `iteratorTSType` 同判据）。
 */
export function isIteratorObjectShape(slots: Record<string, SlotVisibility>): boolean {
  return slots["next"] !== undefined;
}

/**
 * 对象槽在产物面是否**不可见**（键 + 槽 + 同层槽表）。
 *
 * 与 `isHiddenInternalSlot` 的差别只有 BUG-130 的例外收窄：迭代器/生成器形态的
 * **数字下标槽**也不可见（元素域不是自有属性）。
 */
export function isInvisibleObjSlot(
  k: string,
  slot: SlotVisibility,
  objSlots: Record<string, SlotVisibility>,
): boolean {
  if (isHiddenInternalSlot(k, slot)) return true;
  return (
    slot.internal === true &&
    canonicalArrayIndex(k) !== undefined &&
    isIteratorObjectShape(objSlots)
  );
}
