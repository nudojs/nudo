/**
 * 泄漏/上界断言：反复 analyze 同一批或递增文件后，缓存 size 必须 ≤ 硬上限，
 * 且不会单调无界增长。不依赖大堆——小 max + 小批即可验证 LRU 封顶。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  setSessionCacheLimits,
  resetSessionCacheLimitState,
  getSessionCacheLimits,
} from "../session-cache-limits.ts";
import { getAnalysisFileCacheSize, clearAnalysisFileCache } from "../analysis-file-cache.ts";
import {
  getFnAnalysisCacheSize,
  clearFnAnalysisCache,
  fnAnalysisCacheSet,
  type CachedFnAnalysis,
} from "../fn-analysis-cache.ts";
import { getBPathCacheSize, clearBPathCache } from "../bpath-run.ts";
import { analyzeFile } from "../analyzer.ts";
import { resetAllAnalysisCaches } from "../session-cache.ts";
import { getHarvestCacheSize, clearHarvestCache, harvestPackageCached } from "../harvest-auto.ts";
import {
  getAbsModuleCacheSize,
  clearAbsModuleCache,
} from "../abs-modules-graph.ts";
import {
  getPathEnvCacheSizes,
  clearPathEnvCaches,
} from "../evaluator/env-loader.ts";
import {
  getEnvPathDepsSize,
  clearEnvPathDeps,
  noteEnvPathDeps,
} from "../env-path-deps.ts";
import { BoundedLruMap } from "../lru-map.ts";

function writeBatch(dir: string, n: number, prefix = "m"): string[] {
  const files: string[] = [];
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const p = join(dir, `${prefix}${i}.js`);
    writeFileSync(p, `export function f${i}(x) { return x + ${i}; }\n`);
    files.push(p);
  }
  return files;
}

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

beforeEach(() => {
  resetAllAnalysisCaches();
  resetSessionCacheLimitState();
  clearHarvestCache();
  clearAbsModuleCache();
  clearPathEnvCaches();
  clearEnvPathDeps();
});

afterEach(() => {
  resetAllAnalysisCaches();
  resetSessionCacheLimitState();
  clearHarvestCache();
  clearAbsModuleCache();
  clearPathEnvCaches();
  clearEnvPathDeps();
});

describe("BoundedLruMap hard cap", () => {
  it("never exceeds max and evicts least-recently-used", () => {
    const m = new BoundedLruMap<number>(3);
    m.set("a", 1);
    m.set("b", 2);
    m.set("c", 3);
    m.get("a"); // a becomes most-recent
    m.set("d", 4); // evicts b (oldest unused)
    expect(m.size).toBe(3);
    expect(m.has("a")).toBe(true);
    expect(m.has("b")).toBe(false);
    expect(m.has("c")).toBe(true);
    expect(m.has("d")).toBe(true);
  });

  it("max<=0 disables the cache", () => {
    const m = new BoundedLruMap<number>(0);
    m.set("a", 1);
    expect(m.size).toBe(0);
    expect(m.get("a")).toBeUndefined();
  });

  it("trim() drops down to max when tightened", () => {
    const m = new BoundedLruMap<number>(8);
    for (let i = 0; i < 8; i++) m.set(`k${i}`, i);
    expect(m.size).toBe(8);
    m.setMax(2);
    expect(m.size).toBe(2);
  });
});

describe("session analysis caches stay bounded under repeat analyze", () => {
  it("same batch analyzed many times does not grow caches past the caps", () => {
    setSessionCacheLimits({ maxFiles: 8, maxFns: 16, maxBRuns: 4 });
    const dir = mkdtempSync(join(tmpdir(), "nudo-mem-"));
    const files = writeBatch(dir, 20); // more files than maxFiles

    const sizesAfterFirst: number[] = [];
    for (let round = 0; round < 6; round++) {
      for (const f of files) {
        const src = `export function f(x) { return x; }\n`;
        analyzeFile(f, src);
      }
      const fileN = getAnalysisFileCacheSize();
      const fnN = getFnAnalysisCacheSize();
      const bN = getBPathCacheSize();
      expect(fileN).toBeLessThanOrEqual(8);
      expect(fnN).toBeLessThanOrEqual(16);
      expect(bN).toBeLessThanOrEqual(4);
      sizesAfterFirst.push(fileN);
    }
    // 非单调无界增长：最终 size 不超过上限，且不超过首轮观测
    expect(sizesAfterFirst[sizesAfterFirst.length - 1]!).toBeLessThanOrEqual(8);
    expect(Math.max(...sizesAfterFirst)).toBeLessThanOrEqual(8);
  });

  it("incrementally growing file set stays under the file/fn caps", () => {
    setSessionCacheLimits({ maxFiles: 6, maxFns: 10, maxBRuns: 3 });
    const dir = mkdtempSync(join(tmpdir(), "nudo-mem-inc-"));
    for (let i = 0; i < 40; i++) {
      const p = join(dir, `inc${i}.js`);
      writeFileSync(p, `export function g${i}(x) { return x * ${i}; }\n`);
      analyzeFile(p, `export function g${i}(x) { return x * ${i}; }\n`);
      expect(getAnalysisFileCacheSize()).toBeLessThanOrEqual(6);
      expect(getFnAnalysisCacheSize()).toBeLessThanOrEqual(10);
      expect(getBPathCacheSize()).toBeLessThanOrEqual(3);
    }
  });

  it("fn analysis cache LRU-caps at maxFns", () => {
    setSessionCacheLimits({ maxFiles: 64, maxFns: 5, maxBRuns: 32 });
    for (let i = 0; i < 50; i++) {
      fnAnalysisCacheSet(`/t/f${i}.js${"\0"}own${i}`, fnEntry(`f${i}`));
    }
    expect(getFnAnalysisCacheSize()).toBe(5);
  });

  it("analysis file cache trims to maxFiles even after inserts of many keys", () => {
    setSessionCacheLimits({ maxFiles: 4, maxFns: 8, maxBRuns: 2 });
    const dir = mkdtempSync(join(tmpdir(), "nudo-mem-trim-"));
    for (let i = 0; i < 30; i++) {
      const p = join(dir, `t${i}.js`);
      writeFileSync(p, `export function t${i}() { return ${i}; }\n`);
      analyzeFile(p, `export function t${i}() { return ${i}; }\n`);
    }
    expect(getAnalysisFileCacheSize()).toBeLessThanOrEqual(4);
    expect(getSessionCacheLimits().maxFiles).toBe(4);
  });
});

describe("harvest / abs-module / path-env resident structures are capped", () => {
  it("harvest cache never exceeds HARVEST_CACHE_MAX (128)", () => {
    // 用假 key 灌满：harvestPackageCached 对不存在包会缓存 null
    for (let i = 0; i < 200; i++) {
      harvestPackageCached(`fake-pkg-${i}`, `/nonexistent/${i}`);
    }
    expect(getHarvestCacheSize()).toBeLessThanOrEqual(128);
  });

  it("abs module cache size getter is bounded after clears", () => {
    expect(getAbsModuleCacheSize()).toBe(0);
    clearAbsModuleCache();
    expect(getAbsModuleCacheSize()).toBe(0);
  });

  it("path-env caches stay under their caps", () => {
    const sizes = getPathEnvCacheSizes();
    expect(sizes.byKey).toBeLessThanOrEqual(64);
    expect(sizes.byPath).toBeLessThanOrEqual(64);
    expect(sizes.baseDirs).toBeLessThanOrEqual(64);
  });

  it("env path dependents map is capped", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-envdep-"));
    for (let i = 0; i < 300; i++) {
      // 每个源引用不同的 env 模板路径 → 外层 key 数必须被 LRU 封顶
      const envFile = join(dir, `e${i}.env.ts`);
      writeFileSync(envFile, `export function defineEnv() { return { globals: {} }; }\n`);
      const srcFile = join(dir, `s${i}.js`);
      writeFileSync(srcFile, `// @nudo:env ./e${i}.env.ts\n`);
      noteEnvPathDeps(srcFile, `/// @nudo:env ./e${i}.env.ts\n`);
    }
    expect(getEnvPathDepsSize()).toBeLessThanOrEqual(256);
  });
});

describe("repeat analyze does not monotonically grow retained caches", () => {
  it("size plateaus after warm-up rounds", () => {
    setSessionCacheLimits({ maxFiles: 8, maxFns: 8, maxBRuns: 4 });
    const dir = mkdtempSync(join(tmpdir(), "nudo-mem-plateau-"));
    const files = writeBatch(dir, 12, "p");
    const srcOf = (i: number) => `export function p${i}(x) { return x + 1; }\n`;

    const samples: number[] = [];
    for (let round = 0; round < 8; round++) {
      files.forEach((f, i) => analyzeFile(f, srcOf(i)));
      samples.push(getAnalysisFileCacheSize() + getFnAnalysisCacheSize() + getBPathCacheSize());
    }
    // 后几轮合计驻留不增长（LRU 稳态，不单调无界）
    const tail = samples.slice(4);
    const firstTail = tail[0]!;
    for (const s of tail) {
      expect(s).toBeLessThanOrEqual(firstTail);
    }
    expect(firstTail).toBeLessThanOrEqual(8 + 8 + 4);
  });
});
