import { describe, it, expect } from "vitest";
import { div, mod } from "../arithmetic.ts";
import { numLit, num, abs } from "../abs.ts";
import { v, lit } from "../term.ts";
import { ge, pTrue } from "../pred.ts";
import { typeValueToString } from "../../type-value.ts";
import { absToTypeValue } from "../bridge.ts";
import { formatAbs } from "../format.ts";

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
    const tv = absToTypeValue(half);
    expect(typeValueToString(tv)).toContain(">= 0");
  });

  it("lit mod", () => {
    expect(formatAbs(mod(numLit(10), numLit(3)))).toContain("1");
  });

  it("x % 5 has bounds", () => {
    const x = abs(num().shape, v("x"), pTrue, "path");
    const r = mod(x, numLit(5));
    expect(r.pred).toBeDefined();
    expect(formatAbs(r)).toContain("5");
  });
});
