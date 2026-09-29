/**
 * lit(undefined) 契约不得投成 prim number。
 * 回归背景：litC(undefined) 只带 eq(self, lit(undefined))、无 prim；
 * constraintOnTermAbs 的 allEqNull 只认 null，undefined 落进
 * 「有 pred 无 prim → number」回退。同类：memberLitValue 的
 * undefined 哨兵把 lit(undefined) 与「无字面量」混同。
 */
import { describe, it, expect } from "vitest";
import {
  formatShape,
  leqAbs,
  unknown,
  lit,
  litC,
  union,
  shape,
  constraintToEntryAbs,
  abs,
  num,
} from "../index.ts";

function undefLit() {
  return abs({ k: "unknown" }, lit(undefined), undefined, "exact");
}

describe("lit(undefined) constraint projects to unknown, not number", () => {
  it("litC(undefined) entry Abs is unknown-shaped (not number)", () => {
    const a = constraintToEntryAbs(litC(undefined) as never, "x");
    expect(a.shape.k).toBe("unknown");
    expect(a.shape.k === "prim").toBe(false);
  });

  it("litC(null) stays unknown (regression)", () => {
    const a = constraintToEntryAbs(litC(null) as never, "x");
    expect(a.shape.k).toBe("unknown");
    expect(a.shape.k === "prim").toBe(false);
  });

  it("litC(undefined) entry is not assignable to number", () => {
    const a = constraintToEntryAbs(litC(undefined) as never, "x");
    expect(leqAbs(a, num()).ok).toBe(false);
  });

  it("lit(undefined) is assignable to unknown", () => {
    const a = constraintToEntryAbs(litC(undefined) as never, "x");
    expect(leqAbs(a, unknown).ok).toBe(true);
    expect(leqAbs(undefLit(), a).ok).toBe(true);
  });

  it("union(1, undefined) does not collapse to bare number", () => {
    const a = constraintToEntryAbs(union(1, undefined) as never, "x");
    // 不得钉成 prim number（undefined 臂被吞掉）
    expect(a.shape.k === "prim" && (a.shape as { type?: string }).type === "number").toBe(false);
    if (a.shape.k === "sum") {
      const hasUndef = a.shape.members.some((m) => m.shape.k === "unknown");
      const hasNum = a.shape.members.some(
        (m) => m.shape.k === "prim" && (m.shape as { type?: string }).type === "number",
      );
      expect(hasUndef).toBe(true);
      expect(hasNum).toBe(true);
    } else {
      // 退化为 unknown 也可接受（承认 undefined），但绝不是 number
      expect(a.shape.k).toBe("unknown");
    }
  });

  it("shape({ x: undefined }) field is unknown, not number", () => {
    const a = constraintToEntryAbs(shape({ x: undefined }) as never, "o");
    expect(a.shape.k).toBe("obj");
    const field = (a.shape as { slots: Record<string, { value: { shape: { k: string } } }> })
      .slots["x"]!.value;
    expect(field.shape.k).toBe("unknown");
    expect(field.shape.k === "prim").toBe(false);
  });
});
