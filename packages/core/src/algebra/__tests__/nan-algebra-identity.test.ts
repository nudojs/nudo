/**
 * NaN 参与的代数恒等式回归。
 * 回归背景：simplifyTerm / mul 把 `x * 0` 折成精确 0，但 JS 中
 * `NaN * 0 === NaN`、`Infinity * 0 === NaN`——number 域含 NaN/±Infinity，
 * 该恒等式不成立，折成 exact 0 属 unsound。
 * `x * 1 = x`、`x - 0 = x` 对 NaN/±Inf/-0 仍成立，保留。
 * `x + 0 = x` 不成立（-0+0=+0、string+0 拼接），与 x*0 同族一并去掉。
 */
import { describe, it, expect } from "vitest";
import { add, mul, numLit, numVar, litValue, simplifyTerm, app, lit, v } from "../index.ts";

describe("NaN-unsafe algebra identities", () => {
  it("x*0 must not fold to exact 0 (NaN*0 is NaN, Inf*0 is NaN)", () => {
    const t = simplifyTerm(app("*", [v("x"), lit(0)]));
    expect(t.op === "lit" && t.value === 0).toBe(false);
  });

  it("0*x must not fold to exact 0", () => {
    const t = simplifyTerm(app("*", [lit(0), v("x")]));
    expect(t.op === "lit" && t.value === 0).toBe(false);
  });

  it("mul(x, 0) is not exact 0", () => {
    const r = mul(numVar("x"), numLit(0));
    const lr = litValue(r);
    expect(r.conf === "exact" && (lr.ok ? lr.value : undefined) === 0).toBe(false);
    expect(r.shape).toEqual({ k: "prim", type: "number" });
  });

  it("mul(0, x) is not exact 0", () => {
    const r = mul(numLit(0), numVar("x"));
    const lr = litValue(r);
    expect(r.conf === "exact" && (lr.ok ? lr.value : undefined) === 0).toBe(false);
    expect(r.shape).toEqual({ k: "prim", type: "number" });
  });

  it("NaN*0 literal still folds to NaN", () => {
    const r = mul(
      { shape: { k: "prim", type: "number" }, term: lit(NaN), pred: undefined, conf: "exact" },
      numLit(0),
    );
    const lr = litValue(r);
    expect(Number.isNaN(lr.ok ? lr.value : undefined)).toBe(true);
  });

  it("x*1 = x and x-0 = x still hold; x+0 must not fold", () => {
    expect(simplifyTerm(app("+", [v("x"), lit(0)]))).not.toEqual(v("x"));
    expect(simplifyTerm(app("*", [v("x"), lit(1)]))).toEqual(v("x"));
    expect(simplifyTerm(app("-", [v("x"), lit(0)]))).toEqual(v("x"));
  });

  it("x+0 literal fold with NaN still yields NaN", () => {
    const nan = { shape: { k: "prim", type: "number" } as const, term: lit(NaN), pred: undefined, conf: "exact" as const };
    const r = add(nan, numLit(0));
    const lr = litValue(r);
    expect(Number.isNaN(lr.ok ? lr.value : undefined)).toBe(true);
  });
});
