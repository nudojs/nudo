/**
 * 宿主契约回归：入口 source 未变、依赖模块内容变了时，
 * 必须 evictAnalysisCachesForFiles（CLI watch / vite-plugin），
 * 否则 AnalysisResult / B-path / fn-cache 会命中陈旧结果。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeFile,
  clearAnalysisSessionCaches,
  evictAnalysisCachesForFiles,
} from "@nudojs/service";
import { formatShape } from "@nudojs/core";

const dirs: string[] = [];
afterEach(() => {
  clearAnalysisSessionCaches();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function caseResultOf(result: ReturnType<typeof analyzeFile>, fnName: string, caseName: string): string {
  const fn = result.functions.find((f) => f.name === fnName);
  const c = fn?.cases.find((x) => x.name === caseName);
  if (!c) throw new Error(`missing case ${fnName}/${caseName}`);
  return formatShape(c.abs);
}

describe("dep-change host eviction contract", () => {
  const MAIN = `
const util = require("./util.js");
/**
 * @nudo:case "t" (1)
 */
function go(n) {
  return util.inc(n);
}
`;

  it("default-loader analysisFileCacheKey includes dep fingerprint (no stale hit)", () => {
    clearAnalysisSessionCaches();
    const dir = mkdtempSync(join(tmpdir(), "nudo-stale-"));
    dirs.push(dir);
    const depPath = join(dir, "util.js");
    const mainPath = join(dir, "main.js");
    writeFileSync(depPath, `export function inc(x) { return x + 1; }\n`);
    writeFileSync(mainPath, MAIN);

    const r1 = analyzeFile(mainPath, MAIN);
    expect(caseResultOf(r1, "go", "t")).toBe("2");

    // dep 变了，parent source 不变：default loader 指纹进 memo 键 → 不陈旧命中
    writeFileSync(depPath, `export function inc(x) { return x + 99; }\n`);
    const r2 = analyzeFile(mainPath, MAIN);
    expect(caseResultOf(r2, "go", "t")).toBe("100");
  });

  it("evictAnalysisCachesForFiles still refreshes after dep change", () => {
    clearAnalysisSessionCaches();
    const dir = mkdtempSync(join(tmpdir(), "nudo-evict-"));
    dirs.push(dir);
    const depPath = join(dir, "util.js");
    const mainPath = join(dir, "main.js");
    writeFileSync(depPath, `export function inc(x) { return x + 1; }\n`);
    writeFileSync(mainPath, MAIN);

    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");

    writeFileSync(depPath, `export function inc(x) { return x + 99; }\n`);
    // 模拟 CLI watch：脏集入口文件定向逐出
    evictAnalysisCachesForFiles([mainPath]);
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("100");
  });

  it("clearAnalysisSessionCaches is a full reset", () => {
    clearAnalysisSessionCaches();
    const dir = mkdtempSync(join(tmpdir(), "nudo-clear-"));
    dirs.push(dir);
    const depPath = join(dir, "util.js");
    const mainPath = join(dir, "main.js");
    writeFileSync(depPath, `export function inc(x) { return x + 1; }\n`);
    writeFileSync(mainPath, MAIN);

    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");
    writeFileSync(depPath, `export function inc(x) { return x + 5; }\n`);
    clearAnalysisSessionCaches();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("6");
  });
});
