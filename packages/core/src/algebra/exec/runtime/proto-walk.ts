/**
 * 原型链 walk 的共享叶子（`array-length.ts` / `proto-set.ts`）——只依赖
 * abs 叶子，不为任一消费方引入 [[Prototype]] 解析语义。
 *
 * **刻意只共享「深度上限 + 自有属性持有者」**：链解析本身两处不同——
 * - `array-length.ts`（ToNumber 自定义 valueOf/toString 探测）只走
 *   `getProtoAbs`（protoTable 面）；
 * - `proto-set.ts`（[[Set]] 写门）先 `getProtoAbs`、未登记时回落
 *   `protoOfRecv`（类注册表 / 品牌名面），因为类实例不登记 protoTable。
 * 把链解析也抽出来会迫使两处同语义（要么漏类实例，要么给 ToNumber 面
 * 引入类原型链——都是行为变化）。
 *
 * `ownPropHolder` 的调用约定：返回**持有自有槽**的 Abs（obj 自身 / brand
 * 内层 obj）；其余形态（prim / fn / summary / unknown …）无自有槽模型 ⇒
 * `undefined`，walk 直接上溯下一环。
 */
import type { Abs } from "../../abs.ts";

/** 原型链深度上限（防 [[Prototype]] 环） */
export const MAX_PROTO_DEPTH = 16;

/** 该 Abs 的「自有属性持有者」：obj 自身 / brand 的内层 obj；其余形态无自有槽模型 */
export function ownPropHolder(p: Abs): Abs | undefined {
  if (p.shape.k === "obj") return p;
  if (p.shape.k === "brand") {
    const inner = p.shape.shape;
    return inner.shape.k === "obj" ? inner : undefined;
  }
  return undefined;
}
