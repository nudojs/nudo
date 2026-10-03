/**
 * P-IDE2：Abs-check 主通道（checkToLspDiagnostics）零缓存回归。
 *
 * 旧行为：每次 push 防抖 / pull 诊断都全量 checkSource + extractDirectives
 * （analysisCache 只存 evaluator 结果）。修复：checkDiags 挂进 analysisCache
 * 条目（source/deps/cfg 指纹同键、与 evalDiags 同口径失效）。
 *
 * 验收（调用计数断言）：同源重复 validate / pull → checkSource 只跑 1 次；
 * source 变更 → 失效重算。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const counters = vi.hoisted(() => ({ checkSource: 0 }));

vi.mock("@nudojs/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nudojs/core")>();
  return {
    ...actual,
    checkSource: (...args: Parameters<typeof actual.checkSource>) => {
      counters.checkSource++;
      return actual.checkSource(...args);
    },
  };
});

import {
  clearValidationState,
  getCachedOrAnalyze,
  getCachedCheckDiags,
  validateText,
  type ValidateTextDeps,
} from "../validation.ts";

const SRC = `export function f(x) { return x + 1; }\n`;

function mkDeps(sent: Array<{ uri: string; diagnostics: unknown[] }>): ValidateTextDeps {
  return {
    sendDiagnostics: (p) => sent.push(p),
  };
}

describe("check diagnostics ride the analysis cache entry (P-IDE2)", () => {
  beforeEach(() => {
    clearValidationState();
    counters.checkSource = 0;
  });

  it("repeated push debounce with unchanged source runs checkSource once", async () => {
    const sent: Array<{ uri: string; diagnostics: unknown[]; version?: number }> = [];
    const deps = mkDeps(sent);

    await validateText("/t/cdc/a.js", "file:///t/cdc/a.js", SRC, 1, deps);
    expect(counters.checkSource).toBe(1);
    expect(sent).toHaveLength(1);

    // 防抖重复（版本 bump、内容未变）：复用条目 checkDiags，不重跑 checkSource
    await validateText("/t/cdc/a.js", "file:///t/cdc/a.js", SRC, 2, deps);
    expect(counters.checkSource).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.diagnostics).toEqual(sent[0]!.diagnostics);
  });

  it("repeated pull after getCachedOrAnalyze runs checkSource once", () => {
    const filePath = "/t/cdc/pull.js";
    getCachedOrAnalyze(filePath, SRC, 1);
    getCachedOrAnalyze(filePath, SRC, 1);
    const d1 = getCachedCheckDiags(filePath, SRC);
    expect(counters.checkSource).toBe(1);
    for (let i = 0; i < 3; i++) {
      expect(getCachedCheckDiags(filePath, SRC)).toBe(d1);
    }
    expect(counters.checkSource).toBe(1);
  });

  it("source change invalidates the cached check diagnostics", () => {
    const filePath = "/t/cdc/inval.js";
    getCachedOrAnalyze(filePath, SRC, 1);
    getCachedCheckDiags(filePath, SRC);
    expect(counters.checkSource).toBe(1);

    const next = SRC.replace("x + 1", "x + 2");
    getCachedOrAnalyze(filePath, next, 2);
    getCachedCheckDiags(filePath, next);
    expect(counters.checkSource).toBe(2);
  });
});
