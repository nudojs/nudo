/**
 * TS 声明类型文本 → Abs 形状（Bug 479）。
 *
 * 剥除 pass 留下的旁路是**源码文本**（"string" / "number" / "Array<string>"），
 * 这里把**基本类型**子集映射成 Abs 形状；其余（别名、泛型、联合、对象类型）
 * 一律**不映射**（⇒ 形参退回「无约束 any」，与今日 .ts 行为同形，不猜）。
 *
 * 口径：只映射 JS 里同名的一等类型——`string` / `number` / `boolean` /
 * `bigint` / `symbol`。`any` / `unknown` / `never` / `void` / `null` 不映射：
 * 它们不是「一个具体值域」，落到 any 才是既有语义（无约束 ≠ unknown）。
 */
import type { Shape } from "./abs.ts";

/** 声明类型文本 → Abs 形状（不可映射 ⇒ undefined） */
export function absShapeForTsTypeText(text: string | undefined): Shape | undefined {
  if (!text) return undefined;
  switch (text.trim()) {
    case "string":
      return { k: "prim", type: "string" };
    case "number":
      return { k: "prim", type: "number" };
    case "boolean":
      return { k: "prim", type: "boolean" };
    case "bigint":
      return { k: "prim", type: "bigint" };
    case "symbol":
      return { k: "prim", type: "symbol" };
    default:
      return undefined;
  }
}
