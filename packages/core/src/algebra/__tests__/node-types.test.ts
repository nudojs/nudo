import { describe, it, expect } from "vitest";
import { collectAbsNodeTypes, findAbsAtPosition } from "../ast-eval.ts";
import { formatAbs } from "../format.ts";

describe("Abs node type map", () => {
  it("collects node → Abs for expressions", () => {
    const source = `const x = 1 + 2;\nconst y = x * 3;\n`;
    const map = collectAbsNodeTypes(source);
    expect(map.size).toBeGreaterThan(0);
    const values = [...map.values()].map((a) => formatAbs(a));
    expect(values.some((s) => s.includes("3"))).toBe(true);
  });

  it("findAbsAtPosition picks tightest node", () => {
    // `const x = 1 + 2;`
    //  col 10 = `1`, col 14 = `2` (0-based)
    const source = `const x = 1 + 2;\n`;
    const map = collectAbsNodeTypes(source);
    const at1 = findAbsAtPosition(map, 1, 10);
    expect(at1).toBeDefined();
    expect(formatAbs(at1!)).toContain("1");
    const at2 = findAbsAtPosition(map, 1, 14);
    expect(at2).toBeDefined();
    expect(formatAbs(at2!)).toContain("2");
  });
});
