import { describe, it, expect } from "vitest";
import { analyzeFile } from "../index.ts";

describe("analyzer intension (always on)", () => {
  it("entry@ gets intension display", () => {
    const source = `function scale(x) { return x + 1; }\n`;
    const result = analyzeFile("f.js", source);
    const fn = result.functions.find((f) => f.name === "scale");
    expect(fn).toBeDefined();
    const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    expect(entry!.intension).toBeDefined();
    expect(entry!.intension!.display).toContain("scale");
    expect(entry!.intension!.display).toContain("+");
    // 无损 Abs（不经 bridge）
    expect(entry!.intension!.abs).toBeDefined();
    expect(entry!.intension!.abs).toContain("#");
  });

  it("add generalizes to A1+A2", () => {
    const source = `function add(a, b) { return a + b; }\n`;
    const result = analyzeFile("f.js", source);
    const fn = result.functions.find((f) => f.name === "add");
    const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry!.intension!.display).toContain("A1");
    expect(entry!.intension!.display).toContain("+");
  });
});
