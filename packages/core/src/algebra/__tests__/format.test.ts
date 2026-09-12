import { describe, it, expect } from "vitest";
import { formatShape, formatAbs } from "../format.ts";
import { abs, num } from "../abs.ts";
import { v, lit } from "../term.ts";
import { ge } from "../pred.ts";

describe("formatShape brand/eff/fn", () => {
  it("brand shows class name", () => {
    const inner = abs(num().shape, undefined, undefined, "exact");
    const a = abs({ k: "brand", name: "Counter", shape: inner }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("Counter");
  });

  it("eff shows promise inner", () => {
    const inner = abs(num().shape, undefined, undefined, "exact");
    const a = abs({ k: "eff", eff: "promise", inner }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("promise<number>");
  });

  it("fn shows return shape when present", () => {
    const a = abs(
      { k: "fn", params: ["x"], returnType: abs(num().shape, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("(x) => number");
  });

  it("formatAbs still includes pred", () => {
    const a = abs(num().shape, v("x"), ge(v("x"), lit(0)), "path");
    expect(formatAbs(a)).toContain("0");
  });
});
