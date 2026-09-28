/**
 * simplifyTerm 代数恒等式。
 * 回归背景：
 * 1. `x - 0 = x` 对 +0 成立，但对 -0 被减数不成立：(-0)-(-0)=+0。
 *    `b.value === 0` 在 JS 里也匹配 lit(-0)，旧实现把 x-(-0) 折成 x。
 * 2. `x * 1 = x` 只对 number 成立；"5"*1=5、true*1=1、null*1=0。
 *    foldLiterals 只折双方 number，其余落进恒等式后原样保留，值和类型都错。
 */
import { describe, it, expect } from "vitest";
import { simplifyTerm, app, lit, v, mul, numVar, numLit, litValue } from "../index.ts";

describe("simplifyTerm algebra identities", () => {
  it("x - 0 still folds to x (true +0)", () => {
    expect(simplifyTerm(app("-", [v("x"), lit(0)]))).toEqual(v("x"));
  });

  it("x - (-0) must NOT fold to x ((-0)-(-0)=+0)", () => {
    const t = simplifyTerm(app("-", [v("x"), lit(-0)]));
    expect(t.op === "var" && t.id === "x").toBe(false);
    expect(t.op).toBe("app");
  });

  it("x * 1 folds to x for number terms", () => {
    expect(simplifyTerm(app("*", [v("x"), lit(1)]))).toEqual(v("x"));
    expect(simplifyTerm(app("*", [lit(1), v("x")]))).toEqual(v("x"));
  });

  it('"5" * 1 must not stay string (ToNumber → 5)', () => {
    const t = simplifyTerm(app("*", [lit("5"), lit(1)]));
    expect(t.op === "lit" && t.value === "5").toBe(false);
  });

  it("true * 1 must not stay boolean (→ 1)", () => {
    const t = simplifyTerm(app("*", [lit(true), lit(1)]));
    expect(t.op === "lit" && t.value === true).toBe(false);
  });

  it("null * 1 must not stay null (→ 0)", () => {
    const t = simplifyTerm(app("*", [lit(null), lit(1)]));
    expect(t.op === "lit" && t.value === null).toBe(false);
  });

  it("mul(x, 1) on a number var still keeps the var identity", () => {
    const r = mul(numVar("x"), numLit(1));
    expect(r.term).toEqual(v("x"));
    expect(litValue(r)).toBeUndefined();
  });
});
