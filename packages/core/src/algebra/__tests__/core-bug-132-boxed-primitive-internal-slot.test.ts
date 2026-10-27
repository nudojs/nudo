/**
 * BUG-132 回归：装箱原始值的 `[[PrimitiveValue]]` 是**内部槽**，不是自有属性。
 *
 * 根因：`packages/core/src/algebra/builtins/error/boxed.ts` 的 `makeBoxedAbs`
 * 建 `[[PrimitiveValue]]` 时**只**把「不可枚举」记在**侧表**（prop flags）里，
 * **没有**落 `Slot.internal` ⇒ 投影面（format / denote / projection /
 * service emit/internal-slot 全按 `internal` 剔除内部槽）**一个都不查侧表**
 * ⇒ guard 面把它当**必填自有属性**发布
 *（`data["[[PrimitiveValue]]"] === 1`）⇒ guard 对被导出函数自己的返回值
 * **恒假**（假红；zod / dts / check 三面都正确）。
 *
 * 修法：`[[PrimitiveValue]]` 槽打 `internal: true`（ES 规范内部槽 = 不是自有
 * 属性；原生 `Object.getOwnPropertyNames(new Number(1))` 是 `[]`）。
 */
import { describe, it, expect } from "vitest";
import { call, val, tupleEls } from "./eval-helpers.ts";
import { BOXED_PRIMITIVE_SLOT, makeBoxedAbs } from "../builtins/error/boxed.ts";
import { isHiddenInternalSlot } from "../slot-visibility.ts";
import { $lit } from "../exec/runtime/state.ts";
import type { Slot } from "../objects.ts";

const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};
const wrap = (body: string): string => `export function f() { ${body} }`;

/** 装箱 brand 的内层 `[[PrimitiveValue]]` 槽 */
function primSlotOf(name: "Number" | "String" | "Boolean", v: unknown): Slot {
  const brand = makeBoxedAbs(name, $lit(v as never));
  const inner = brand.shape.k === "brand" ? brand.shape.shape : undefined;
  expect(inner?.shape.k).toBe("obj");
  const slots = (inner!.shape as { slots: Record<string, Slot> }).slots;
  return slots[BOXED_PRIMITIVE_SLOT]!;
}

describe("BUG-132：[[PrimitiveValue]] 内部槽不进自有属性面", () => {
  it("槽带 internal 标记（投影面据此剔除）", () => {
    for (const [name, v] of [
      ["Number", 1],
      ["String", "s"],
      ["Boolean", true],
    ] as const) {
      const slot = primSlotOf(name, v);
      expect(slot, `${name} 缺 [[PrimitiveValue]] 槽`).toBeDefined();
      expect(slot.internal, `${name} 的 [[PrimitiveValue]] 未打 internal`).toBe(true);
    }
  });

  it("isHiddenInternalSlot 对 [[PrimitiveValue]] 判真（guard / dts / schema 三面同判据）", () => {
    expect(isHiddenInternalSlot(BOXED_PRIMITIVE_SLOT, primSlotOf("Number", 1))).toBe(true);
  });

  it("运行时面：new Number(1) 的 getOwnPropertyNames 是 []（原生同款）", () => {
    expect(tupleEls(call(wrap("return Object.getOwnPropertyNames(new Number(1));")).result)).toEqual(
      [],
    );
  });

  it("运行时面：new Number(1).hasOwnProperty(\"[[PrimitiveValue]]\") 是 false", () => {
    expect(lit(wrap('return new Number(1).hasOwnProperty("[[PrimitiveValue]]");'))).toBe(false);
  });

  it("对照组：new String(\"s\") 的**真实**自有键仍可见（下标 + length）", () => {
    expect(tupleEls(call(wrap("return Object.getOwnPropertyNames(new String('s'));")).result)).toEqual([
      "0",
      "length",
    ]);
  });
});
