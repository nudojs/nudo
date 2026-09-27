/**
 * NaN 字面量同一性（SameValue）回归。
 * 回归背景：leq / termEquals 用 `===` 判字面量同一，NaN === NaN 为 false，
 * 于是 `NaN ⊭ NaN`（赋值误报）、两个 lit(NaN) 项不相等（约束/化简失配）。
 * 同类：constraint.ts / objects.ts 已改用 Object.is；此处是漏网同型点。
 * 注意：JS 运算符 `===`/`==` 对 NaN 仍须为 false——那是另一条语义，不得混用。
 */
import { describe, it, expect } from "vitest";
import { leqAbs } from "../leq.ts";
import { termEquals, lit } from "../term.ts";
import { abs, numLit } from "../abs.ts";

function nanAbs() {
  return abs({ k: "prim", type: "number" }, lit(NaN as never), undefined, "exact");
}

describe("NaN literal identity (SameValue)", () => {
  it("termEquals(NaN, NaN) is true for distinct lit terms", () => {
    expect(termEquals(lit(NaN as never), lit(NaN as never))).toBe(true);
    expect(termEquals(lit(1), lit(1))).toBe(true);
    expect(termEquals(lit(1), lit(2))).toBe(false);
  });

  it("leqAbs(NaN, NaN) is assignable (same literal)", () => {
    expect(leqAbs(nanAbs(), nanAbs()).ok).toBe(true);
  });

  it("leqAbs(NaN, number) is still assignable", () => {
    const numberPrim = abs({ k: "prim", type: "number" }, undefined, undefined, "path");
    expect(leqAbs(nanAbs(), numberPrim).ok).toBe(true);
  });

  it("distinct non-NaN literals still fail leq", () => {
    expect(leqAbs(numLit(1), numLit(2)).ok).toBe(false);
    expect(leqAbs(numLit(1), numLit(1)).ok).toBe(true);
  });
});
