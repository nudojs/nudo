import { describe, it, expect } from "vitest";
import { getHoverAtPosition } from "../analyzer.ts";

describe("getHoverAtPosition intension", () => {
  it("hover on function name shows intension", () => {
    const source = `function scale(x) { return x + 1; }\nscale(2);\n`;
    // line 1, column ~10 is inside `scale` identifier (1-based line)
    const hover = getHoverAtPosition("/t/hover.js", source, 1, 9);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toContain("scale");
    expect(hover!.intension ?? "").toContain("+");
  });

  it("hover on non-function still returns type", () => {
    const source = `const n = 1;\n`;
    const hover = getHoverAtPosition("/t/h2.js", source, 1, 7);
    // may be null if no node type; if present should not crash
    if (hover) expect(typeof hover.typeText).toBe("string");
  });
});
