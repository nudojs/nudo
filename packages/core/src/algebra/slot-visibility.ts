/**
 * 槽可见性（leaf）：内部槽对属性 introspection 不可见。
 *
 * `Slot.internal`（Bug 84 私有槽机制）是仓里既有的「该槽不是自有属性」标记。
 * 三个投影面必须**同口径**剔除，否则某一面会把内部实现细节当用户可见属性
 * 发布：
 * - `format.ts`   展示/signature 面（Bug 240）
 * - `projection.ts` 约束面（`absToConstraint`）
 * - `denote.ts`   guard 面（且 `@@iterator` 按字符串键取值会产出**恒假**
 *   守卫子句——它是 symbol 键槽）
 *
 * 不剔的典型后果：生成器对象的协议槽（`next` / `return` / `throw` /
 * `constructor` / `@@iterator`）原生挂在原型上、不是自有属性，却会被投影成
 * 用户可见字段。
 *
 * 例外：**规范数组下标槽**保留——族 01 的建模口径里生成器的数字下标槽承载
 * **元素域**（`"0": string`，`eval-spread-iter-elems` 钉住），不是内部实现
 * 细节 ⇒ 不在此剔除。
 */

import { canonicalArrayIndex } from "./objects.ts";

/** internal 槽且键不是规范数组下标 ⇒ 该槽不进投影/guard 产物 */
export function isHiddenInternalSlot(
  k: string,
  slot: { internal?: boolean },
): boolean {
  return slot.internal === true && canonicalArrayIndex(k) === undefined;
}
