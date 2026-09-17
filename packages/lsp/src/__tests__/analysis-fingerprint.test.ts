import { describe, it, expect, beforeEach } from "vitest";
import {
  analysisCache,
  getCachedOrAnalyze,
} from "../validation.ts";

const SRC = `
/**
 * @nudo:case "t" (1)
 */
function double(x) { return x * 2; }
`;

describe("getCachedOrAnalyze (B2)", () => {
  beforeEach(() => {
    analysisCache.clear();
  });

  it("reuses result for the same document version", () => {
    const a = getCachedOrAnalyze("/t/a.js", SRC, 1);
    const b = getCachedOrAnalyze("/t/a.js", SRC, 1);
    expect(b).toBe(a);
  });

  it("reanalyzes on version bump even if source is unchanged (activeCases may differ)", () => {
    const a = getCachedOrAnalyze("/t/a.js", SRC, 1);
    const b = getCachedOrAnalyze("/t/a.js", SRC, 2);
    expect(b).not.toBe(a);
  });

  it("stores sourceHash for validateText short-circuit", () => {
    getCachedOrAnalyze("/t/a.js", SRC, 1);
    const ent = analysisCache.get("/t/a.js");
    expect(ent?.sourceHash).toBeTruthy();
  });
});
