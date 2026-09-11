import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";
import { typeValueToString } from "@nudojs/core";

describe("self-contained Abs call records", () => {
  it("collects call sites from Abs program eval", () => {
    const source = `
      function add(a, b) { return a + b; }
      const r = add(2, 3);
    `;
    const result = analyzeFile("/t/abs-call.js", source);
    const add = result.functions.find((f) => f.name === "add");
    expect(add).toBeDefined();
    // call@ 应来自 Abs 路径
    expect(add!.cases.length).toBeGreaterThan(0);
    expect(add!.cases[0]!.source).toBe("callsite");
    expect(typeValueToString(add!.cases[0]!.result)).toBe("5");
  });

  it("self-contained entry still works", () => {
    const source = `function scale(x) { return x + 1; }`;
    const result = analyzeFile("/t/abs-entry.js", source);
    const scale = result.functions.find((f) => f.name === "scale");
    expect(scale!.entryOnly).toBe(true);
    expect(scale!.cases[0]!.intension).toBeDefined();
  });
});
