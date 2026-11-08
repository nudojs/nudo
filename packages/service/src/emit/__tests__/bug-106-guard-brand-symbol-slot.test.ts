/**
 * Bug 106 回归（service guard 面）：`stripInvisibleSlots` 缺 `brand` 臂
 * ⇒ class 实例（shape.k === "brand"）内层 obj 的符号键槽原样传给
 * `denoteGuard`，写出 `Object.hasOwn(data, "@@sym#1")` 恒假子句 ⇒ 守卫
 * **拒绝函数自己的返回值**（dts / zod / standard 三面却放行）。
 *
 * 修法：`stripInvisibleSlots` 补 brand 臂，递归裁剪 s.shape（内层 Abs）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "@nudojs/core";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";

/** `class C { constructor() { this[Symbol("tag")] = 1; } }; new C()` 的建模 */
const brandWithSymbolSlot = (): Abs =>
  abs(
    {
      k: "brand",
      name: "C",
      shape: abs(
        {
          k: "obj",
          slots: {
            a: { value: numLit(1) },
            "@@sym#1": { value: numLit(2), symbolKey: true },
          },
        },
        undefined,
        undefined,
        "exact",
      ),
    },
    undefined,
    undefined,
    "exact",
  );

describe("Bug 106：guard stripInvisibleSlots 的 brand 臂", () => {
  it("brand 内层符号键槽不写进守卫（改前 hasOwn '@@sym#1' 恒假）", () => {
    const src = generateGuardFunctionFromAbs("ismakeOutput", brandWithSymbolSlot());
    expect(src).not.toContain("@@sym#1");
    expect(src).not.toContain("Object.hasOwn(data, \"@@");
  });

  it("守卫接受函数自己的返回值，且仍拒绝缺可见槽的值", () => {
    const src = generateGuardFunctionFromAbs("ismakeOutput", brandWithSymbolSlot());
    const js = src
      .replace("(value: unknown): boolean", "(value)")
      .replace("const data: any = value as Record<string, any>;", "const data = value;")
      .replace("const data = value as Record<string, any>;", "const data = value;")
      // BUG-250：brand 身份子句在场时产物把 Array.isArray(data) 写成
      // Array.isArray(data as unknown)（TS 收窄规避）——剥离成纯 JS 再求值。
      .replaceAll(" as unknown", "")
      .replace("export function ", "function ");
    const guard = new Function(`${js}; return ismakeOutput;`)() as (v: unknown) => boolean;
    // 运行时真值：自有字符串键只有 a，符号键不在字符串键枚举面
    const real: Record<PropertyKey, unknown> = { a: 1 };
    real[Symbol("tag")] = 2;
    expect(guard(real)).toBe(true);
    expect(guard({ b: 1 })).toBe(false);
  });
});
