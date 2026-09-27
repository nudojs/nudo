import { describe, it, expect } from "vitest";
import { div, mod } from "../arithmetic.ts";
import { numLit, num, abs } from "../abs.ts";
import { v, lit } from "../term.ts";
import { ge, pTrue } from "../pred.ts";
import { formatAbs, formatShape } from "../format.ts";

describe("algebra div/mod", () => {
  it("lit div", () => {
    expect(formatAbs(div(numLit(10), numLit(2)))).toContain("5");
  });

  it("div by zero stays number", () => {
    const r = div(numLit(1), numLit(0));
    expect(r.shape).toEqual({ k: "prim", type: "number" });
  });

  it("x>=0 / 2 keeps lower bound", () => {
    const x = abs(num().shape, v("x"), ge(v("x"), lit(0)), "path");
    const half = div(x, numLit(2));
    expect(half.pred).toBeDefined();
    expect(formatAbs(half)).toContain("≥ 0");
  });

  it("lit mod", () => {
    expect(formatAbs(mod(numLit(10), numLit(3)))).toContain("1");
  });

  it("unconstrained x % 5 has no (-5,5) bound (Inf%5 is NaN)", () => {
    const x = abs(num().shape, v("x"), pTrue, "path");
    const r = mod(x, numLit(5));
    // 被除数可能 ±Infinity/NaN → 余数可为 NaN，不得声称 (-5,5)
    expect(r.pred).toBeUndefined();
    expect(formatAbs(r)).toContain("%");
  });

  it("finite-bounded x % 5 keeps (-5,5)", () => {
    const x = abs(
      num().shape,
      v("x"),
      { op: "and", args: [ge(v("x"), lit(0)), { op: "le", a: v("x"), b: lit(10) }] },
      "path",
    );
    const r = mod(x, numLit(5));
    expect(r.pred).toBeDefined();
    expect(formatAbs(r)).toContain("5");
  });
});
