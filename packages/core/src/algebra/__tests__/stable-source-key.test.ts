import { describe, it, expect } from "vitest";
import { stableAnalyzeKeySource } from "../stable-source-key.ts";

describe("stableAnalyzeKeySource", () => {
  it("strips trailing non-nudo line comments", () => {
    const a = "function f() { return 1; }\n";
    const b = "function f() { return 1; }\n// hello\n";
    const c = "function f() { return 1; }\n\n// t0\n// t1\n";
    expect(stableAnalyzeKeySource(b)).toBe(stableAnalyzeKeySource(a));
    expect(stableAnalyzeKeySource(c)).toBe(stableAnalyzeKeySource(a));
  });

  it("keeps trailing @nudo comments", () => {
    const a = "function f() { return 1; }\n";
    const b = "function f() { return 1; }\n// @nudo:case \"x\" (1)\n";
    expect(stableAnalyzeKeySource(b)).not.toBe(stableAnalyzeKeySource(a));
  });

  it("keeps JSDoc nudo blocks", () => {
    const a = "/**\n * @nudo:case \"c\" (1)\n */\nfunction f(x) { return x; }\n";
    const b = a + "// trailing\n";
    expect(stableAnalyzeKeySource(b)).toBe(stableAnalyzeKeySource(a));
    expect(stableAnalyzeKeySource(a)).toContain("@nudo:case");
  });

  it("normalizes trailing blank lines", () => {
    const a = "let x = 1;\n";
    const b = "let x = 1;\n\n\n";
    expect(stableAnalyzeKeySource(b)).toBe(stableAnalyzeKeySource(a));
  });
});
