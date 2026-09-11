import { describe, it, expect } from "vitest";
import { hoverTool } from "../agent-tools.ts";

describe("nudo.hover agent tool", () => {
  it("returns lossless abs at position", () => {
    const src = `const x = 1 + 2;\n`;
    // col of `2` is 14 (0-based)
    const r = hoverTool(
      { file: "/t/h.js", line: 1, column: 14, source: src },
      { readFile: () => src },
    );
    const payload = JSON.parse(r.content[0].text);
    expect(payload.abs).toBeDefined();
    expect(payload.abs).toContain("2");
    expect(payload).toHaveProperty("ext");
  });

  it("can include inlays", () => {
    const src = `function needsPositive(x) {\n  if (x > 0) return x;\n  return 0;\n}\n`;
    const r = hoverTool(
      { file: "/t/i.js", line: 1, column: 9, source: src, includeInlays: true },
      { readFile: () => src },
    );
    const payload = JSON.parse(r.content[0].text);
    expect(Array.isArray(payload.inlays)).toBe(true);
    expect(payload.inlays.length).toBeGreaterThan(0);
  });
});
