/**
 * analysisFileCacheKey：default loader 也必须吃 dep 指纹与 project nudo.env，
 * 否则入口 source 未变时文件级 memo 陈旧命中。
 * 另钉：maxForks / externalCallRecords 内容指纹（BUG-007）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analysisFileCacheKey } from "../analyzer.ts";
import { clearPathEnvCaches } from "../evaluator/env-loader.ts";
import { clearAnalysisSessionCaches } from "../session-cache.ts";
import { numLit, strLit, abs as makeAbs } from "@nudojs/core";
import type { CallRecord } from "../evaluator/call-record.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CFG = {
  mode: "directives",
  evalMissingSlot: "off",
  callSiteBudget: 3,
  diagnostics: "errors",
  maxForks: 5000,
};

const neverAbs = () => makeAbs({ k: "never" }, undefined, undefined, "exact");

function rec(over: Partial<CallRecord> = {}): CallRecord {
  return {
    fnName: "area",
    argAbs: [strLit("a")],
    resultAbs: numLit(1),
    throwsAbs: neverAbs(),
    ...over,
  };
}

describe("analysisFileCacheKey staleness dimensions", () => {
  it("misses when default-loader dep content changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-afp-"));
    dirs.push(dir);
    const depPath = join(dir, "util.js");
    const mainPath = join(dir, "main.js");
    const main = `const util = require("./util.js");\nexport function go(n) { return util.inc(n); }\n`;
    writeFileSync(mainPath, main);
    writeFileSync(depPath, `export function inc(x) { return x + 1; }\n`);

    const k1 = analysisFileCacheKey(mainPath, main, undefined, undefined, CFG, undefined);
    writeFileSync(depPath, `export function inc(x) { return x + 99; }\n`);
    const k2 = analysisFileCacheKey(mainPath, main, undefined, undefined, CFG, undefined);
    expect(k1.noCache).toBeFalsy();
    expect(k1.auxKey).not.toBe(k2.auxKey);
  });

  it("misses when project nudo.env names change", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-afp-env-"));
    dirs.push(dir);
    const mainPath = join(dir, "main.js");
    const main = `export function id(x) { return x; }\n`;
    writeFileSync(mainPath, main);

    const k1 = analysisFileCacheKey(mainPath, main, undefined, undefined, CFG, undefined, []);
    const k2 = analysisFileCacheKey(mainPath, main, undefined, undefined, CFG, undefined, ["node"]);
    const k3 = analysisFileCacheKey(mainPath, main, undefined, undefined, CFG, undefined, ["es"]);
    expect(k1.auxKey).not.toBe(k2.auxKey);
    expect(k2.auxKey).not.toBe(k3.auxKey);
  });

  it("clearPathEnvCaches is wired into clearAnalysisSessionCaches", () => {
    expect(() => {
      clearAnalysisSessionCaches();
      clearPathEnvCaches();
    }).not.toThrow();
  });

  it("maxForks flips the key (fork-budget change must miss)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-afp-forks-"));
    dirs.push(dir);
    const mainPath = join(dir, "main.js");
    const main = `export function id(x) { return x; }\n`;
    writeFileSync(mainPath, main);

    const low = analysisFileCacheKey(mainPath, main, undefined, undefined, { ...CFG, maxForks: 7 });
    const high = analysisFileCacheKey(mainPath, main, undefined, undefined, { ...CFG, maxForks: 20000 });
    const same = analysisFileCacheKey(mainPath, main, undefined, undefined, { ...CFG, maxForks: 7 });
    expect(low.auxKey).not.toBe(high.auxKey);
    expect(low.auxKey).toBe(same.auxKey);
  });

  it("externalCallRecords: rebuilt array with same content hits; changed content misses", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-afp-ext-"));
    dirs.push(dir);
    const mainPath = join(dir, "main.js");
    const main = `export function id(x) { return x; }\n`;
    writeFileSync(mainPath, main);

    const a1 = analysisFileCacheKey(mainPath, main, undefined, [rec()], CFG);
    // CLI `--from` 每次重建数组：同内容必须同键（修复前 WeakMap 身份 → 永不命中）
    const a2 = analysisFileCacheKey(mainPath, main, undefined, [rec()], CFG);
    expect(a1.auxKey).toBe(a2.auxKey);

    // 内容变（arg 换成 "b"）→ 必须 miss
    const b = analysisFileCacheKey(mainPath, main, undefined, [rec({ argAbs: [strLit("b")] })], CFG);
    expect(b.auxKey).not.toBe(a1.auxKey);

    // 同数组对象原地改写元素（长度不变）→ 必须 miss（修复前身份键陈旧命中）
    const mutated = [rec()];
    const m1 = analysisFileCacheKey(mainPath, main, undefined, mutated, CFG);
    mutated[0] = rec({ argAbs: [strLit("z")] });
    const m2 = analysisFileCacheKey(mainPath, main, undefined, mutated, CFG);
    expect(m2.auxKey).not.toBe(m1.auxKey);

    // 长度变 → 也 miss
    const two = analysisFileCacheKey(mainPath, main, undefined, [rec(), rec({ fnName: "other" })], CFG);
    expect(two.auxKey).not.toBe(a1.auxKey);
  });
});
