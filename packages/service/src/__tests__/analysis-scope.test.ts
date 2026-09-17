import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldAnalyzeFile } from "../analysis-scope.ts";
import { analysisConfig, type AnalysisConfig } from "../evaluator/config.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpProject(pkg: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-scope-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

const directivesCfg = analysisConfig(undefined);
const allCfg: AnalysisConfig = { ...analysisConfig({ analysis: { mode: "all" } }) };
const exportsCfg: AnalysisConfig = { ...analysisConfig({ analysis: { mode: "exports" } }) };

describe("shouldAnalyzeFile", () => {
  it("rejects non-target paths", () => {
    expect(shouldAnalyzeFile("/a/b.tsx", "export function f(){}", allCfg)).toBe(false);
    expect(shouldAnalyzeFile("/a/b.nudo.js", "export const x = 1", allCfg)).toBe(false);
  });

  it("mode=directives: only files with @nudo:", () => {
    const withDir = "/proj/a.js";
    expect(shouldAnalyzeFile(withDir, "/** @nudo:case \"x\" (1) */\nfunction f(){}", directivesCfg)).toBe(
      true,
    );
    expect(shouldAnalyzeFile(withDir, "export function f(){}", directivesCfg)).toBe(false);
  });

  it("mode=all: any target path", () => {
    expect(shouldAnalyzeFile("/proj/a.js", "export function f(){}", allCfg)).toBe(true);
  });

  it("mode=exports: export keyword or sidecar", () => {
    expect(shouldAnalyzeFile("/proj/a.js", "export function f(){}", exportsCfg)).toBe(true);
    expect(shouldAnalyzeFile("/proj/a.js", "function f(){}", exportsCfg)).toBe(false);
  });

  it("mode=exports: sidecar presence without export in source", () => {
    const dir = tmpProject({ name: "fx", nudo: { analysis: { mode: "exports" } } });
    const src = join(dir, "lib.js");
    writeFileSync(src, "function f(){ return 1 }\n");
    writeFileSync(join(dir, "lib.nudo.js"), "export const f = 1;\n");
    expect(shouldAnalyzeFile(src, "function f(){ return 1 }")).toBe(true);
  });

  it("exclude node_modules even in mode=all", () => {
    const dir = tmpProject({ name: "fx", nudo: { analysis: { mode: "all" } } });
    const nm = join(dir, "node_modules", "pkg", "index.js");
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(nm, "export function f(){}\n");
    expect(shouldAnalyzeFile(nm, "export function f(){}")).toBe(false);
  });
});
