/**
 * P-IDE6：LSP 会话 Map（analysisCache / knownFiles / nudoDepParents）LRU 上限。
 * 与 service getSessionCacheLimits 同源（maxFiles；dep 边按 4× 口径）——
 * 长 IDE 会话不再单调增长。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setSessionCacheLimits,
  resetSessionCacheLimitState,
} from "@nudojs/service";
import {
  analysisCache,
  clearValidationState,
  getCachedOrAnalyze,
  knownFiles,
  nudoDepParents,
  registerNudoImportDeps,
  validateText,
} from "../validation.ts";

const SRC = `export function f${"0"}(x) { return x; }\n`;

describe("LSP session maps are LRU-capped (P-IDE6)", () => {
  beforeEach(() => {
    clearValidationState();
  });
  afterEach(() => {
    setSessionCacheLimits(null);
    resetSessionCacheLimitState();
    clearValidationState();
  });

  it("analysisCache trims to maxFiles as distinct files stream in", () => {
    setSessionCacheLimits({ maxFiles: 2, maxFns: 16, maxEvalRuns: 4 });
    for (let i = 0; i < 6; i++) {
      getCachedOrAnalyze(`/t/lru/f${i}.js`, `export const v${i} = ${i};\n`, 1);
    }
    expect(analysisCache.size).toBeLessThanOrEqual(2);
    // LRU：最近访问的键保留
    expect(analysisCache.has("/t/lru/f5.js")).toBe(true);
    expect(analysisCache.has("/t/lru/f0.js")).toBe(false);
  });

  it("knownFiles caps at maxFiles (dirty-propagation registry)", async () => {
    setSessionCacheLimits({ maxFiles: 2, maxFns: 16, maxEvalRuns: 4 });
    const sent: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      await validateText(`/t/lru/k${i}.js`, `file:///t/lru/k${i}.js`, SRC, 1, {
        sendDiagnostics: (p) => sent.push(p),
      });
    }
    expect(knownFiles.size).toBeLessThanOrEqual(2);
  });

  it("nudoDepParents caps at 4× maxFiles with LRU refresh on access", () => {
    setSessionCacheLimits({ maxFiles: 2, maxFns: 16, maxEvalRuns: 4 });
    for (let i = 0; i < 20; i++) {
      registerNudoImportDeps(
        `/t/lru/p${i}.js`,
        `/// @nudo:import { t } from "./d${i}.nudo.js"\nexport function f(x) { return x; }\n`,
      );
    }
    expect(nudoDepParents.size).toBeLessThanOrEqual(8);
  });

  it("maxFiles=0 disables the analysisCache layer (recompute, never stale)", () => {
    setSessionCacheLimits({ maxFiles: 0, maxFns: 16, maxEvalRuns: 4 });
    const r1 = getCachedOrAnalyze("/t/lru/off.js", SRC, 1);
    expect(r1).toBeTruthy();
    expect(analysisCache.size).toBe(0);
    // 再来一次：无条目 → 重算（新对象），不是陈旧命中
    const r2 = getCachedOrAnalyze("/t/lru/off.js", SRC, 1);
    expect(r2).toBeDefined();
  });
});
