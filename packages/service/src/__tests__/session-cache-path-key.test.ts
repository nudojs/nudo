/**
 * FIX-RESIDUAL-4 项 1：service 会话缓存键对齐 stablePathKey。
 *
 * 同一 Windows 文件的 `/c:/x` / `c:\x` / `file:///c:/x` / `C:/x` 必须与
 * `c:/x` 同键命中、同键逐出——否则 LSP（uriToFilePath 形态）与 CLI watch
 * （computeDirtySet 的 stablePathKey 形态）交叉时缓存 miss / 逐出漏删。
 * 测试在 POSIX 上跑；stablePathKey 自身统一盘符形态，无需真 Windows。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  analysisCacheGet,
  analysisCacheSet,
  clearAnalysisFileCache,
  evictAnalysisFileCacheForFiles,
  getAnalysisFileCacheSize,
} from "../analysis-file-cache.ts";
import {
  clearFnAnalysisCache,
  evictFnAnalysisCacheForFiles,
  fnAnalysisCacheGet,
  fnAnalysisCacheSet,
  getFnAnalysisCacheSize,
  type CachedFnAnalysis,
} from "../fn-analysis-cache.ts";
import {
  clearEvalCache,
  evictEvalCacheForFiles,
  getEvalCacheSize,
  tryRunEval,
} from "../eval-run.ts";
import { analysisFileCacheKey } from "../analyzer-cache.ts";
import { checkCacheKey, ifaceCacheKey, relativizePath } from "../disk-cache.ts";
import { stablePathKey } from "@nudojs/core/internal";

const SEP = "\0";

function fnEntry(name: string): CachedFnAnalysis {
  return {
    analysis: {
      name,
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      paramNames: [],
      cases: [],
    },
    diagnostics: [],
    caseHints: [],
    callRecords: [],
  };
}

/** 同一 Windows 文件的跨形态拼写（stablePathKey 全部归一到 c:/x） */
const FORMS = [
  "c:/x",
  "C:/x",
  "/c:/x",
  "c:\\x",
  "C:\\x",
  "file:///c:/x",
  "file:///C:/x",
] as const;

describe("analysis-file-cache keys go through stablePathKey", () => {
  beforeEach(() => {
    clearAnalysisFileCache();
  });

  it("/c:/x vs c:/x (and friends) share one entry", () => {
    analysisCacheSet("/c:/x", "src", "aux", 1);
    expect(analysisCacheGet("c:/x", "src", "aux")).toBe(1);
    expect(analysisCacheGet("c:\\x", "src", "aux")).toBe(1);
    expect(analysisCacheGet("file:///c:/x", "src", "aux")).toBe(1);
    // 单条目：跨形态写入覆盖而非分叉
    expect(getAnalysisFileCacheSize()).toBe(1);
  });

  it("eviction hits regardless of the caller's path form", () => {
    analysisCacheSet("/c:/x", "src", "aux", 1);
    analysisCacheSet("c:/y", "src", "aux", 2);
    // 逐出方用第三种形态（LSP cacheKey 是 c:/；dirty set 也是 c:/）
    const n = evictAnalysisFileCacheForFiles(["c:\\x", "file:///c:/y"]);
    expect(n).toBe(2);
    expect(analysisCacheGet("/c:/x", "src", "aux")).toBeUndefined();
    expect(analysisCacheGet("c:/y", "src", "aux")).toBeUndefined();
  });

  it("is a no-op on clean POSIX absolute paths", () => {
    analysisCacheSet("/test/a.js", "src", "aux", 1);
    expect(analysisCacheGet("/test/a.js", "src", "aux")).toBe(1);
    expect(evictAnalysisFileCacheForFiles(["/test/a.js"])).toBe(1);
    expect(getAnalysisFileCacheSize()).toBe(0);
  });
});

describe("fn-analysis-cache keys go through stablePathKey", () => {
  beforeEach(() => {
    clearFnAnalysisCache();
  });

  it("set under /c:/x form, get under c:/x form", () => {
    fnAnalysisCacheSet(`/c:/x${SEP}own${SEP}deps${SEP}0`, fnEntry("f"));
    expect(fnAnalysisCacheGet(`c:/x${SEP}own${SEP}deps${SEP}0`)).toBeDefined();
    expect(fnAnalysisCacheGet(`c:\\x${SEP}own${SEP}deps${SEP}0`)).toBeDefined();
    expect(fnAnalysisCacheGet(`file:///c:/x${SEP}own${SEP}deps${SEP}0`)).toBeDefined();
    expect(getFnAnalysisCacheSize()).toBe(1);
  });

  it("evict prefixes match across path forms", () => {
    fnAnalysisCacheSet(`/c:/x${SEP}own1${SEP}deps1${SEP}0`, fnEntry("a"));
    fnAnalysisCacheSet(`/c:/x${SEP}own2${SEP}deps2${SEP}0`, fnEntry("b"));
    fnAnalysisCacheSet(`/c:/y${SEP}own${SEP}deps${SEP}0`, fnEntry("c"));
    const n = evictFnAnalysisCacheForFiles(["C:\\x"]);
    expect(n).toBe(2);
    expect(fnAnalysisCacheGet(`c:/x${SEP}own1${SEP}deps1${SEP}0`)).toBeUndefined();
    expect(fnAnalysisCacheGet(`c:/x${SEP}own2${SEP}deps2${SEP}0`)).toBeUndefined();
    expect(fnAnalysisCacheGet(`c:/y${SEP}own${SEP}deps${SEP}0`)).toBeDefined();
  });

  it("prefix scan still does not drop a shared-prefix sibling", () => {
    fnAnalysisCacheSet(`/c:/x.js${SEP}a${SEP}b${SEP}0`, fnEntry("a"));
    fnAnalysisCacheSet(`/c:/x.js.bak${SEP}a${SEP}b${SEP}0`, fnEntry("bak"));
    evictFnAnalysisCacheForFiles(["/c:/x.js"]);
    expect(fnAnalysisCacheGet(`c:/x.js${SEP}a${SEP}b${SEP}0`)).toBeUndefined();
    expect(fnAnalysisCacheGet(`c:/x.js.bak${SEP}a${SEP}b${SEP}0`)).toBeDefined();
  });
});

describe("eval-run cache keys go through stablePathKey", () => {
  beforeEach(() => {
    clearEvalCache();
  });

  it("tryRunEval memo hits across path forms; evict clears regardless of form", () => {
    const src = `export function f() { return 1; }\n`;
    // /c:/ 形态写入
    const r1 = tryRunEval(src, "/c:/x.js");
    expect(r1).toBeDefined();
    expect(getEvalCacheSize()).toBe(1);
    // c:/ 形态命中同一 memo（不再新增条目）
    const r2 = tryRunEval(src, "c:/x.js");
    expect(r2).toBe(r1);
    expect(getEvalCacheSize()).toBe(1);
    // 第三种形态逐出
    expect(evictEvalCacheForFiles(["c:\\x.js"])).toBe(1);
    expect(getEvalCacheSize()).toBe(0);
  });
});

describe("analysisFileCacheKey returns stablePathKey form", () => {
  it("all drive spellings collapse to one filePath key", () => {
    const keys = FORMS.map((f) => analysisFileCacheKey(f, "src"));
    for (const k of keys) {
      expect(k.filePath).toBe("c:/x");
      expect(k.filePath).toBe(stablePathKey(k.filePath));
    }
  });

  it("POSIX absolute path is unchanged", () => {
    expect(analysisFileCacheKey("/test/a.js", "src").filePath).toBe("/test/a.js");
  });
});

describe("disk-cache path identity goes through stablePathKey", () => {
  it("checkCacheKey is identical across drive forms", () => {
    const source = "export const a = 1;\n";
    const opts = { autoBind: true } as const;
    const keys = FORMS.map((f) => checkCacheKey(f, source, opts));
    for (const k of keys) expect(k).toBe(keys[0]);
  });

  it("ifaceCacheKey is identical across drive forms", () => {
    const source = "export const a = 1;\n";
    const opts = { autoBind: false } as const;
    const keys = FORMS.map((f) => ifaceCacheKey(f, source, opts));
    for (const k of keys) expect(k).toBe(keys[0]);
  });

  it("relativizePath collapses drive forms (ext: fallback)", () => {
    const keys = FORMS.map((f) => relativizePath(f));
    for (const k of keys) expect(k).toBe(keys[0]);
  });

  it("relativizePath root-relative collapses drive forms", () => {
    const a = relativizePath("/c:/proj/src/a.js", "/c:/proj");
    const b = relativizePath("c:\\proj\\src\\a.js", "C:/proj");
    expect(a).toBe("src/a.js");
    expect(b).toBe("src/a.js");
  });
});
