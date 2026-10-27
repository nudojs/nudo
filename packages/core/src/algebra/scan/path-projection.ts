/**
 * 契约路径投影的共享叶子（`check-case-scan.ts` / `scan/literal-shapes.ts`
 * 的同名实现合并）——解构 / 默认参契约名 → 实参字段路径逐段下钻。
 *
 * 口径（两处消费方一致，**勿改**）：
 * - `brand` 先拆壳（`new Date(0)` / 类实例的内层是 obj）；
 * - 非 obj（prim / fn / tuple / unknown …）⇒ 该段起不可达 ⇒ `undefined`；
 * - 缺槽 ⇒ `undefined`（调用方据此报 missing field / 跳过判不了）。
 *
 * 无副作用、纯函数；`segments` 允许 `readonly`（调用方传 `string[]`）。
 */
import type { Abs } from "../abs.ts";
import { getSlot } from "../objects.ts";

/** 解构/默认参契约名 → 实参字段路径投影（C4.1 平铺；#137 嵌套点路径逐段下钻） */
export function projectAbsPath(arg: Abs, segments: readonly string[]): Abs | undefined {
  let cur: Abs | undefined = arg;
  for (const seg of segments) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") {
      cur = cur.shape.shape as Abs;
    }
    if (cur.shape.k !== "obj") return undefined;
    cur = getSlot(cur.shape.slots, seg)?.value;
  }
  return cur;
}
