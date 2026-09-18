/**
 * analysisFileCacheKey：interface.autoBind 变更必须 miss（P1-9）。
 */
import { describe, it, expect } from "vitest";
import { analysisFileCacheKey } from "../analyzer.ts";

const CFG = {
  mode: "directives",
  evalMissingSlot: "off",
  callSiteBudget: 3,
  diagnostics: "errors",
};

describe("analysisFileCacheKey autoBind dimension", () => {
  const src = `export function f(x) { return x; }\n`;
  const path = "/p/src/a.js";

  it("autoBind true vs false flip the key", () => {
    const on = analysisFileCacheKey(path, src, undefined, undefined, CFG, undefined, [], true);
    const off = analysisFileCacheKey(path, src, undefined, undefined, CFG, undefined, [], false);
    expect(on.auxKey).not.toBe(off.auxKey);
  });

  it("same autoBind is stable", () => {
    const a = analysisFileCacheKey(path, src, undefined, undefined, CFG, undefined, [], true);
    const b = analysisFileCacheKey(path, src, undefined, undefined, CFG, undefined, [], true);
    expect(a.auxKey).toBe(b.auxKey);
  });
});
