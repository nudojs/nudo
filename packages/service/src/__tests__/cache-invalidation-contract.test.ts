/**
 * Host cache-invalidation contract — docs/design/cache-invalidation.md.
 * Anchors C1–C8 pin natural miss, host eviction, residual gap, and path-env clear.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeFile,
  analyzeFileAsync,
  clearAnalysisSessionCaches,
  evictAnalysisCachesForFiles,
  evictAbsModuleCacheFiles,
  getPathEnvCacheSizes,
  getAnalysisSession,
  type AnalysisResult,
} from "@nudojs/service";
import { formatShape } from "@nudojs/core";

const dirs: string[] = [];
afterEach(() => {
  clearAnalysisSessionCaches();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function caseResultOf(result: AnalysisResult, fnName: string, caseName: string): string {
  const fn = result.functions.find((f) => f.name === fnName);
  const c = fn?.cases.find((x) => x.name === caseName);
  if (!c) throw new Error(`missing case ${fnName}/${caseName}`);
  return formatShape(c.abs);
}

const MAIN = `
const util = require("./util.js");
/**
 * @nudo:case "t" (1)
 */
function go(n) {
  return util.inc(n);
}
`;

function tmpGraph(): { dir: string; depPath: string; mainPath: string; tSec: number } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cic-"));
  dirs.push(dir);
  const depPath = join(dir, "util.js");
  const mainPath = join(dir, "main.js");
  writeFileSync(depPath, `export function inc(x) { return x + 1; }\n`);
  writeFileSync(mainPath, MAIN);
  // Pin whole-second mtime BEFORE first analyze so absModuleCache stores this fingerprint.
  const tSec = Math.floor(Date.now() / 1000);
  utimesSync(depPath, tSec, tSec);
  return { dir, depPath, mainPath, tSec };
}

/** same-length body edit + restore pinned mtime → abs-module stat fingerprint unchanged */
function editDepPinned(depPath: string, tSec: number, to: number): void {
  const before = statSync(depPath);
  writeFileSync(depPath, `export function inc(x) { return x + ${to}; }\n`);
  utimesSync(depPath, tSec, tSec);
  const after = statSync(depPath);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(after.size).toBe(before.size);
}

describe("host cache-invalidation contract", () => {
  it("C1: size-changing dep edit is a natural miss without host eviction", () => {
    clearAnalysisSessionCaches();
    const { depPath, mainPath } = tmpGraph();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");
    writeFileSync(depPath, `export function inc(x) { return x + 99; }\n`);
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("100");
  });

  it("C2: evictAnalysisCachesForFiles refreshes after dep change", () => {
    clearAnalysisSessionCaches();
    const { depPath, mainPath } = tmpGraph();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");
    writeFileSync(depPath, `export function inc(x) { return x + 99; }\n`);
    evictAnalysisCachesForFiles([mainPath]);
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("100");
  });

  it("C3: same-size pinned-mtime dep edit is stale under dependents-only eviction", () => {
    clearAnalysisSessionCaches();
    const { depPath, mainPath, tSec } = tmpGraph();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");
    editDepPinned(depPath, tSec, 2);
    // Residual gap (docs/design/cache-invalidation.md §3.1):
    // absModuleCache is mtimeMs+size keyed — dependents-only eviction does not
    // drop dep entries, so the fresh body is not observed. Do NOT "fix" this
    // assert without updating the design doc + host matrix.
    evictAnalysisCachesForFiles([mainPath]);
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");
  });

  it("C4: evictAbsModuleCacheFiles(dep) + evictAnalysisCachesForFiles(entry) recovers", () => {
    clearAnalysisSessionCaches();
    const { depPath, mainPath, tSec } = tmpGraph();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");
    editDepPinned(depPath, tSec, 2);
    evictAbsModuleCacheFiles([depPath]);
    evictAnalysisCachesForFiles([mainPath]);
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("3");
  });

  it("C5: clearAnalysisSessionCaches is a full reset including residual gap", () => {
    clearAnalysisSessionCaches();
    const { depPath, mainPath, tSec } = tmpGraph();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");
    editDepPinned(depPath, tSec, 2);
    clearAnalysisSessionCaches();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("3");
  });

  it("C6: evictAnalysisCachesForFiles clears path-env caches", async () => {
    clearAnalysisSessionCaches();
    const dir = mkdtempSync(join(tmpdir(), "nudo-cic-env-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "custom.env.ts"),
      `import { numLit } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: numLit(99) } };
}
`,
    );
    const main = `/// @nudo:env ./custom.env.ts

/**
 * @nudo:case "t" ()
 */
function getMagic() {
  return MAGIC;
}
`;
    const mainPath = join(dir, "main.js");
    writeFileSync(mainPath, main, "utf-8");
    const result = await analyzeFileAsync(mainPath, main);
    expect(caseResultOf(result, "getMagic", "t")).toBe("99");
    expect(getPathEnvCacheSizes().byPath).toBeGreaterThan(0);

    evictAnalysisCachesForFiles([mainPath]);
    const sizes = getPathEnvCacheSizes();
    expect(sizes.byPath).toBe(0);
    expect(sizes.byKey).toBe(0);
    expect(sizes.baseDirs).toBe(0);
  });

  it("C7: AnalysisSession.evictForDependents is the same host contract", () => {
    clearAnalysisSessionCaches();
    const { depPath, mainPath } = tmpGraph();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");
    writeFileSync(depPath, `export function inc(x) { return x + 99; }\n`);
    getAnalysisSession().evictForDependents([mainPath]);
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("100");
  });

  it("C8: clearAnalysisSessionCaches refreshes after dep change", () => {
    clearAnalysisSessionCaches();
    const { depPath, mainPath } = tmpGraph();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("2");
    writeFileSync(depPath, `export function inc(x) { return x + 5; }\n`);
    clearAnalysisSessionCaches();
    expect(caseResultOf(analyzeFile(mainPath, MAIN), "go", "t")).toBe("6");
  });
});
