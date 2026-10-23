/**
 * Bug 398 回归：`leqAbs` 的**字面量同一性**必须按 **SameValue**（`Object.is`）
 * 判定，而不是 `===`。
 *
 * 根因（实测）：`packages/core/src/algebra/leq.ts` 的注释写明「SameValue」，
 * 实现却是 `sv === tv || (NaN 特例)` ⇒ JS 的 `===` 认为 `0 === -0` 为 **true**
 * ⇒ `lit(-0)` 与 `lit(0)` 互相「满足」⇒ **精确期望被静默放宽**
 * （native `Object.is(0, -0) === false`）。
 *
 * 症状（产品面）：`@nudo:case "nz" () => -0` 期望 -0、实现给 0 ⇒ 断言**假绿**
 * （`nudo test` 报 `[ok]`）；service 层的 case 对账走的正是这个 `leqAbs`
 * 判定 ⇒ 期望值与实际值都被判「满足」。
 *
 * 口径：SameValue 同时覆盖 NaN ≡ NaN（`===` 对 NaN 为 false ⇒ 赋值同一性
 * 不可用 `===`），并把 `0` 与 `-0` 判为**不同**。
 */
import { describe, it, expect } from "vitest";
import { leqAbs } from "../leq.ts";
import { abs } from "../abs.ts";
import { lit } from "../term.ts";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

/** 数字字面量 Abs（term 保留 -0 的符号） */
function numLit(value: number) {
  return abs({ k: "prim", type: "number" }, lit(value), undefined, "exact");
}

describe("Bug 398：leqAbs 的字面量同一性按 SameValue（Object.is）判定", () => {
  it("lit(-0) ⊭ lit(0)（Object.is(0, -0) === false）", () => {
    const r = leqAbs(numLit(-0), numLit(0));
    expect(r.ok).toBe(false);
    // 失败原因里 -0 与 0 必须可区分（String(-0) 是 "0" ⇒ 用 litText 渲染）
    expect(r.reason).toContain("-0");
  });

  it("lit(0) ⊭ lit(-0)（反向同样不满足）", () => {
    const r = leqAbs(numLit(0), numLit(-0));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("-0");
  });

  it("NaN ≡ NaN（SameValue：=== 对 NaN 为 false，赋值同一性不可用 ===）", () => {
    expect(leqAbs(numLit(NaN), numLit(NaN)).ok).toBe(true);
  });

  it("同值字面量仍可赋值（0 ≡ 0、1 ≡ 1、-1 ≡ -1）", () => {
    expect(leqAbs(numLit(0), numLit(0)).ok).toBe(true);
    expect(leqAbs(numLit(1), numLit(1)).ok).toBe(true);
    expect(leqAbs(numLit(-1), numLit(-1)).ok).toBe(true);
  });

  it("不同字面量仍不可赋值（1 ⊭ 2）", () => {
    expect(leqAbs(numLit(1), numLit(2)).ok).toBe(false);
  });

  it("case 期望面：实现给 +0、期望 -0 ⇒ 不是同一个值（service 层对账用的就是这个判定）", () => {
    const r = call("export function f() { return 0; }", "f", []);
    const actual = litValue(r.result);
    expect(actual.ok).toBe(true);
    const actualValue = actual.ok ? actual.value : undefined;
    expect(Object.is(actualValue, -0)).toBe(false);
    expect(Object.is(actualValue, 0)).toBe(true);
    // 期望（-0）对实际（+0）：SameValue 下不满足
    expect(leqAbs(numLit(actualValue as number), numLit(-0)).ok).toBe(false);
  });
});
