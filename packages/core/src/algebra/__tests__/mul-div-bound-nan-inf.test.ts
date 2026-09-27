/**
 * mul/div 数值界缩放。
 * 回归背景：界按 ab.lo.value * k 断言，k=NaN 绕过 k!==0 后折出 lt(t,NaN)；
 * k=±Infinity 除法折出严格假的下界（5/Inf>0）；双精度溢出/下溢后
 * 单调性失效（2e-300*1e-300=0、1.1e308*10=Inf）。mod 已特判 NaN/0，
 * mul/div 未跟上。
 */
import { describe, it, expect } from "vitest";
import {
  mul,
  div,
  mod,
  numVar,
  numLit,
  lit,
  v,
  gt,
  formatAbs,
} from "../index.ts";

function predText(a: { pred?: unknown }): string {
  return a.pred ? formatAbs({ shape: { k: "prim", type: "number" }, conf: "path", pred: a.pred as never }) : "(none)";
}

describe("mul/div bound scaling is IEEE-safe", () => {
  it("mul(x>0, NaN) must not emit lt(t, NaN) garbage", () => {
    const x = numVar("x", gt(v("x"), lit(0)));
    const r = mul(x, numLit(NaN));
    expect(predText(r)).not.toContain("NaN");
    expect(r.shape).toEqual({ k: "prim", type: "number" });
  });

  it("div(x>0, NaN) must not emit lt(t, NaN) garbage", () => {
    const x = numVar("x", gt(v("x"), lit(0)));
    const r = div(x, numLit(NaN));
    expect(predText(r)).not.toContain("NaN");
    expect(r.shape).toEqual({ k: "prim", type: "number" });
  });

  it("div(x>0, Infinity) must not claim result > 0 (5/Inf === 0)", () => {
    const x = numVar("x", gt(v("x"), lit(0)));
    const r = div(x, numLit(Infinity));
    expect(predText(r)).not.toContain(">");
  });

  it("mul(x>1e-300, 1e-300) must not claim result > 0 (underflow → 0)", () => {
    const x = numVar("x", gt(v("x"), lit(1e-300)));
    const r = mul(x, numLit(1e-300));
    expect(predText(r)).not.toContain(">");
  });

  it("mul(x>1e308, 10) must not claim result > Infinity (overflow)", () => {
    const x = numVar("x", gt(v("x"), lit(1e308)));
    const r = mul(x, numLit(10));
    expect(predText(r)).not.toContain("Infinity");
  });

  it("mod(x>0, 0) already folds to NaN — keep that", () => {
    const x = numVar("x", gt(v("x"), lit(0)));
    const r = mod(x, numLit(0));
    expect(formatAbs(r)).toContain("NaN");
  });
});
