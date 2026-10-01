import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  evictFnAnalysisCacheForFiles,
  clearFnAnalysisCache,
  fnAnalysisCacheSet,
  fnAnalysisCacheGet,
  getFnAnalysisCacheSize,
  type CachedFnAnalysis,
} from "../fn-analysis-cache.ts";
import {
  setSessionCacheLimits,
  resetSessionCacheLimitState,
} from "../session-cache-limits.ts";

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

describe("fn analysis cache LRU order (BUG-012)", () => {
  beforeEach(() => {
    resetSessionCacheLimitState();
    clearFnAnalysisCache();
  });
  afterEach(() => {
    resetSessionCacheLimitState();
    clearFnAnalysisCache();
  });

  it("overwriting an existing key refreshes its LRU position", () => {
    setSessionCacheLimits({ maxFns: 2 });
    const keyA = `/t/a.js${SEP}o${SEP}d${SEP}0`;
    const keyB = `/t/b.js${SEP}o${SEP}d${SEP}0`;
    const keyC = `/t/c.js${SEP}o${SEP}d${SEP}0`;
    fnAnalysisCacheSet(keyA, entry("a1"));
    fnAnalysisCacheSet(keyB, entry("b"));
    fnAnalysisCacheSet(keyA, entry("a2")); // 覆盖写：刷新为最近使用（与 BoundedLruMap.set 一致）
    fnAnalysisCacheSet(keyC, entry("c")); // 容量 2：逐出 keyB，而不是刚写过的 keyA
    expect(fnAnalysisCacheGet(keyA)?.analysis.name).toBe("a2");
    expect(fnAnalysisCacheGet(keyB)).toBeUndefined();
    expect(getFnAnalysisCacheSize()).toBe(2);
  });

  it("maxFns=0 disables reads too — pre-existing entries stop serving", () => {
    setSessionCacheLimits({ maxFns: 2 });
    const keyA = `/t/a.js${SEP}o${SEP}d${SEP}0`;
    fnAnalysisCacheSet(keyA, entry("a"));
    setSessionCacheLimits({ maxFns: 0 });
    expect(fnAnalysisCacheGet(keyA)).toBeUndefined(); // 读 miss，不再陈旧命中
    fnAnalysisCacheSet(`/t/z.js${SEP}o${SEP}d${SEP}0`, entry("z")); // 写丢弃（set 语义不变）
    expect(getFnAnalysisCacheSize()).toBe(1);
  });
});
