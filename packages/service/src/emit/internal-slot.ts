/**
 * Bug 240：internal 槽（`Slot.internal`）**不进产物面** —— 与 core 的
 * `format.ts`（投影面）/ `projection.ts`（约束面）/ `denote.ts`（guard 面）
 * **同判据**（同款 `isHiddenInternalSlot`）：
 *
 * `Slot.internal` 为 true 且键**不是**规范数组下标 ⇒ 该槽对属性 introspection
 * 不可见（不是自有可枚举属性）⇒ 不进 dts / schema / standard 产物。
 *
 * 不剔会污染产物面：生成器对象的协议槽（`next` / `return` / `throw` /
 * `constructor` / `@@iterator`）与私有字段（`#x`）是 internal 槽——原生挂在
 * 原型上、不是自有属性，却被投影成用户可见字段（`@@iterator` 更是 **symbol
 * 键**槽，按字符串键发布是错的）。
 *
 * 例外：**规范数组下标槽**保留——族 01 的建模口径里生成器的数字下标槽承载
 * **元素域**（core 三面同例外），不是内部实现细节。
 */
import { canonicalArrayIndex } from "@nudojs/core";

/** internal 槽判据（core 三面同款） */
export function isHiddenInternalSlot(k: string, slot: { internal?: boolean }): boolean {
  return slot.internal === true && canonicalArrayIndex(k) === undefined;
}
