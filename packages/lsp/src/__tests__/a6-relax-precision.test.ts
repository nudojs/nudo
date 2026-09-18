/**
 * A6：param/return 同文只改首次；结构方法 optional 不得被数值放宽剥掉。
 */
import { describe, it, expect } from "vitest";
import { relaxSidecarConstraint } from "../a6-relax.ts";

describe("A6 relax precision", () => {
  it("same constraint text on param+return: only first (param) relaxed", () => {
    const sc = `export const f = fn({ x: number().gt(0) }, number().gt(0));\n`;
    const out = relaxSidecarConstraint(sc, "f", "x", "number().gt(0)")!;
    expect(out).toBeDefined();
    expect(out).toContain("x: number()");
    expect(out).toContain(", number().gt(0)");
  });

  it("param chain keeps .optional() when stripping numeric preds", () => {
    const sc = `export const f = fn({ x: number().gt(0).optional() }, number());\n`;
    const out = relaxSidecarConstraint(sc, "f", "x", undefined)!;
    expect(out).toBeDefined();
    expect(out).toContain("x: number().optional()");
    expect(out).not.toContain(".gt(0)");
  });
});
