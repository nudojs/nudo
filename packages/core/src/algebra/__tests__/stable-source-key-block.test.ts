import { describe, it, expect } from "vitest";
import { stableAnalyzeKeySource } from "../stable-source-key.ts";

describe("stableAnalyzeKeySource trailing block comments", () => {
  it("strips trailing non-nudo block comments", () => {
    const a = "function f() { return 1; }\n";
    const b = "function f() { return 1; }\n/* trailing note */\n";
    const c = "function f() { return 1; }\n/*\n * multi\n * line\n */\n";
    expect(stableAnalyzeKeySource(b)).toBe(stableAnalyzeKeySource(a));
    expect(stableAnalyzeKeySource(c)).toBe(stableAnalyzeKeySource(a));
  });

  it("keeps trailing block comments that carry @nudo", () => {
    const a = "function f() { return 1; }\n";
    const b = 'function f() { return 1; }\n/* @nudo:case "x" (1) */\n';
    expect(stableAnalyzeKeySource(b)).not.toBe(stableAnalyzeKeySource(a));
  });

  it("does not strip block-comment markers inside code lines", () => {
    const src = 'const s = "/* not a comment */";\n';
    expect(stableAnalyzeKeySource(src).trimEnd()).toBe(src.trimEnd());
  });
});
