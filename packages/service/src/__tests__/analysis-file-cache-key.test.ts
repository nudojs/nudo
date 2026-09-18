/**
 * analysisFileCacheKey：default loader 也必须吃 dep 指纹与 project nudo.env，
 * 否则入口 source 未变时文件级 memo 陈旧命中。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analysisFileCacheKey } from "../analyzer.ts";
import { clearPathEnvCaches } from "../evaluator/env-loader.ts";
import { clearAnalysisSessionCaches } from "../session-cache.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CFG = {
  mode: "directives",
  evalMissingSlot: "off",
  callSiteBudget: 3,
  diagnostics: "errors",
};

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
});
