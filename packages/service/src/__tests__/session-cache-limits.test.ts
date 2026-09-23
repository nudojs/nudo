/**
 * 会话 LRU 上限参数化：env > 显式 set > package.json 层 > 默认。
 * 多项目内存封顶 / 单大仓调高。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getSessionCacheLimits,
  setSessionCacheLimits,
  setSessionCacheFromProject,
  resetSessionCacheLimitState,
  DEFAULT_SESSION_CACHE_LIMITS,
} from "../session-cache-limits.ts";
import {
  analysisCacheGet,
  analysisCacheSet,
  clearAnalysisFileCache,
  getAnalysisFileCacheSize,
  trimAnalysisFileCache,
} from "../analysis-file-cache.ts";
import { applySessionCacheConfig } from "../session-cache.ts";

describe("session cache limits", () => {
  beforeEach(() => {
    resetSessionCacheLimitState();
    clearAnalysisFileCache();
  });
  afterEach(() => {
    resetSessionCacheLimitState();
    clearAnalysisFileCache();
  });

  it("defaults are conservative (multi-project memory)", () => {
    expect(getSessionCacheLimits({})).toEqual(DEFAULT_SESSION_CACHE_LIMITS);
  });

  it("env wins over project layer", () => {
    setSessionCacheFromProject({ maxFiles: 512 });
    const l = getSessionCacheLimits({
      NUDO_CACHE_MAX_FILES: "32",
    } as NodeJS.ProcessEnv);
    expect(l.maxFiles).toBe(32);
  });

  it("explicit set wins over env", () => {
    setSessionCacheLimits({ maxFiles: 8 });
    const l = getSessionCacheLimits({
      NUDO_CACHE_MAX_FILES: "32",
    } as NodeJS.ProcessEnv);
    // env 惰性缓存：reset 后再读 env；显式层仍优先
    expect(getSessionCacheLimits({ NUDO_CACHE_MAX_FILES: "32" } as NodeJS.ProcessEnv).maxFiles).toBe(
      8,
    );
    void l;
  });

  it("NUDO_CACHE_MAX_FILES=off disables file cache", () => {
    resetSessionCacheLimitState();
    const l = getSessionCacheLimits({
      NUDO_CACHE_MAX_FILES: "off",
    } as NodeJS.ProcessEnv);
    expect(l.maxFiles).toBe(0);
  });

  it("file LRU respects maxFiles and 0 disables writes", () => {
    setSessionCacheLimits({ maxFiles: 2 });
    analysisCacheSet("/a", "s1", "k", 1);
    analysisCacheSet("/b", "s2", "k", 2);
    analysisCacheSet("/c", "s3", "k", 3);
    expect(getAnalysisFileCacheSize()).toBe(2);
    expect(analysisCacheGet("/a", "s1", "k")).toBeUndefined();
    expect(analysisCacheGet("/c", "s3", "k")).toBe(3);

    setSessionCacheLimits({ maxFiles: 0 });
    analysisCacheSet("/d", "s4", "k", 4);
    expect(analysisCacheGet("/d", "s4", "k")).toBeUndefined();
  });

  it("trim drops entries when limit shrinks", () => {
    setSessionCacheLimits({ maxFiles: 8 });
    for (let i = 0; i < 8; i++) analysisCacheSet(`/f${i}`, `s${i}`, "k", i);
    expect(getAnalysisFileCacheSize()).toBe(8);
    setSessionCacheLimits({ maxFiles: 2 });
    trimAnalysisFileCache();
    expect(getAnalysisFileCacheSize()).toBe(2);
  });

  it("applySessionCacheConfig wires package.json layer and trims", () => {
    setSessionCacheLimits(null);
    setSessionCacheFromProject(null);
    // 先用默认 64 装满 8 条，再经 package.json 层压到 3
    for (let i = 0; i < 8; i++) analysisCacheSet(`/p${i}`, `s${i}`, "k", i);
    expect(getAnalysisFileCacheSize()).toBe(8);
    const l = applySessionCacheConfig({ sessionCache: { maxFiles: 3 } });
    expect(l.maxFiles).toBe(3);
    expect(getAnalysisFileCacheSize()).toBe(3);
  });
});
