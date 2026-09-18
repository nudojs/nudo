import { describe, it, expect } from "vitest";
import { relaxSidecarConstraint } from "../a6-relax.ts";

describe("A6 relaxSidecarConstraint (shared implementation)", () => {
  it("relaxes constraintText number().gt(0) → number()", () => {
    const sc = `export const positive = number().gt(0);\n`;
    const out = relaxSidecarConstraint(sc, "positive", "x", "number().gt(0)");
    expect(out).toContain("number()");
    expect(out).not.toContain(".gt(0)");
  });

  it("relaxes param: number().int() in fn shape", () => {
    const sc = `export default fn({ x: number().int() }, number());\n`;
    const out = relaxSidecarConstraint(sc, "f", "x", "number().int()");
    expect(out).toContain("x: number()");
    expect(out).not.toContain("number().int()");
  });
});
