/**
 * leq 字面量赋值：null / undefined 字面量不得被任意值放行。
 * 回归背景：litValue 哨兵把 lit(undefined) 折成「无字面量」；且
 * lit(null)/lit(undefined) 的 shape 是 unknown，旧逻辑只在
 * tgt.shape.k === "prim" 时拒绝字面量不匹配，导致
 * 1 ≤ undefined / 1 ≤ null 误判 OK。
 */
import { describe, it, expect } from "vitest";
import { leqAbs, numLit, strLit, boolLit, abs, lit, num, unknown } from "../index.ts";

function und() {
  return abs({ k: "unknown" }, lit(undefined), undefined, "exact");
}
function nul() {
  return abs({ k: "unknown" }, lit(null), undefined, "exact");
}

describe("leqAbs vs null/undefined literals", () => {
  it("number is not assignable to undefined", () => {
    expect(leqAbs(numLit(1), und()).ok).toBe(false);
  });

  it("string is not assignable to undefined", () => {
    expect(leqAbs(strLit("a"), und()).ok).toBe(false);
  });

  it("boolean is not assignable to undefined", () => {
    expect(leqAbs(boolLit(true), und()).ok).toBe(false);
  });

  it("number is not assignable to null", () => {
    expect(leqAbs(numLit(1), nul()).ok).toBe(false);
  });

  it("undefined is not assignable to null", () => {
    expect(leqAbs(und(), nul()).ok).toBe(false);
  });

  it("null is not assignable to undefined", () => {
    expect(leqAbs(nul(), und()).ok).toBe(false);
  });

  it("undefined is assignable to undefined", () => {
    expect(leqAbs(und(), und()).ok).toBe(true);
  });

  it("null is assignable to null", () => {
    expect(leqAbs(nul(), nul()).ok).toBe(true);
  });

  it("bare number prim is not assignable to undefined", () => {
    expect(leqAbs(num(), und()).ok).toBe(false);
  });

  it("unknown (no lit) is still assignable to unknown shape target", () => {
    // 真 unknown（无 term）≤ unknown 目标：目标放宽，合法
    expect(leqAbs(unknown, unknown).ok).toBe(true);
  });
});
