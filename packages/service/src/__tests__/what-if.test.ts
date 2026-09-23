import { describe, it, expect } from "vitest";
import { injectBindings, typeExprToDirective } from "../what-if.ts";

describe("AI3 what-if injectBindings", () => {
  it("maps bare primitives to constraint builders", () => {
    expect(typeExprToDirective("number")).toBe("number()");
    expect(typeExprToDirective("string")).toBe("string()");
    expect(typeExprToDirective("number|string")).toBe("union(number(), string())");
  });

  it("injects @nudo:as above the declaring statement", () => {
    const src = `const x = 1;\nconst y = x + 1;\n`;
    const { source, applied, unapplied } = injectBindings(src, [
      { name: "x", type: "number" },
    ]);
    expect(applied).toEqual(["x"]);
    expect(unapplied).toEqual([]);
    expect(source).toContain("// @nudo:as number()");
  });

  it("reports unapplied when name is not a top-level declaration", () => {
    const { applied, unapplied } = injectBindings(`export function f() { return 1; }\n`, [
      { name: "nope", type: "number" },
    ]);
    expect(applied).toEqual([]);
    expect(unapplied).toEqual(["nope"]);
  });
});
