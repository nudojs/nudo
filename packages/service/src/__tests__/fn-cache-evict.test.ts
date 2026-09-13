import { describe, it, expect, beforeEach } from "vitest";
import {
  evictFnAnalysisCacheForFiles,
  clearFnAnalysisCache,
  fnAnalysisCacheSet,
  fnAnalysisCacheGet,
  type CachedFnAnalysis,
} from "../fn-analysis-cache.ts";

function entry(name: string): CachedFnAnalysis {
  return {
    analysis: {
      name,
      loc: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 10 },
      },
      paramNames: [],
      cases: [],
    },
    diagnostics: [],
    caseHints: [],
    callRecords: [],
  };
}

const SEP = "\0";

describe("evictFnAnalysisCacheForFiles", () => {
  beforeEach(() => {
    clearFnAnalysisCache();
  });

  it("drops every fn entry for the given entry file", () => {
    const keyA1 = `/t/a.js${SEP}own1${SEP}deps1${SEP}0`;
    const keyA2 = `/t/a.js${SEP}own2${SEP}deps2${SEP}0`;
    const keyB = `/t/b.js${SEP}own1${SEP}deps1${SEP}0`;
    fnAnalysisCacheSet(keyA1, entry("a"));
    fnAnalysisCacheSet(keyA2, entry("b"));
    fnAnalysisCacheSet(keyB, entry("c"));
    const n = evictFnAnalysisCacheForFiles(["/t/a.js"]);
    expect(n).toBe(2);
    expect(fnAnalysisCacheGet(keyA1)).toBeUndefined();
    expect(fnAnalysisCacheGet(keyB)).toBeDefined();
  });

  it("does not drop a different file with a shared path prefix", () => {
    const keyA = `/t/a.js${SEP}x${SEP}y${SEP}0`;
    const keyBak = `/t/a.js.bak${SEP}x${SEP}y${SEP}0`;
    fnAnalysisCacheSet(keyA, entry("a"));
    fnAnalysisCacheSet(keyBak, entry("bak"));
    evictFnAnalysisCacheForFiles(["/t/a.js"]);
    expect(fnAnalysisCacheGet(keyA)).toBeUndefined();
    expect(fnAnalysisCacheGet(keyBak)).toBeDefined();
  });
});
