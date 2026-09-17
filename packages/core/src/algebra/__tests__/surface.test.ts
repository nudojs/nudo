import { describe, it, expect } from "vitest";
import { typeofAbs, negAbs, notAbs, strictEqAbs } from "../surface.ts";
import { numLit, num, abs, strLit, boolLit } from "../abs.ts";
import { lit, v } from "../term.ts";
import { gt, pTrue } from "../pred.ts";
import { formatShape } from "../format.ts";

describe("algebra surface ops", () => {
  it("typeof of primitives and null", () => {
    expect(formatShape(typeofAbs(numLit(1)))).toBe('"number"');
    expect(formatShape(typeofAbs(strLit("x")))).toBe('"string"');
    expect(formatShape(typeofAbs(abs({ k: "unknown" }, lit(null), pTrue, "exact")))).toBe('"object"');
    expect(formatShape(typeofAbs(abs({ k: "fn", params: [] }, undefined, undefined, "exact")))).toBe('"function"');
  });

  it("typeof of unknown is abstract string (JS always returns string)", () => {
    const r = typeofAbs(abs({ k: "unknown" }, undefined, undefined, "partial"));
    expect(r.shape).toEqual({ k: "prim", type: "string" });
  });

  it("neg folds and flips bounds", () => {
    expect(formatShape(negAbs(numLit(5)))).toBe("-5");
    const x = abs(num().shape, v("x"), gt(v("x"), lit(0)), "path");
    const nx = negAbs(x);
    expect(nx.term).toBeDefined();
    expect(nx.pred).toBeDefined();
  });

  it("not folds literals including undefined", () => {
    expect(formatShape(notAbs(boolLit(false)))).toBe("true");
    expect(formatShape(notAbs(abs({ k: "unknown" }, lit(undefined), pTrue, "exact")))).toBe("true");
  });

  it("strictEq nullish vs number is false", () => {
    const n = abs(num().shape, undefined, undefined, "exact");
    const nul = abs({ k: "unknown" }, lit(null), pTrue, "exact");
    expect(strictEqAbs(n, nul)).toBe(false);
    expect(strictEqAbs(numLit(1), numLit(1))).toBe(true);
  });
});
