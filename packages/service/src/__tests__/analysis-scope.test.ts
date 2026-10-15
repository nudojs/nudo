import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { shouldAnalyzeFile } from "../analysis-scope.ts";
import { analysisConfig, type AnalysisConfig } from "../evaluator/config.ts";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

function tmpProject(pkg: Record<string, unknown>): string {
  return makeTmpProject("nudo-scope-", { "package.json": JSON.stringify(pkg) });
}

const directivesCfg = analysisConfig({ analysis: { mode: "directives" } });
const defaultCfg = analysisConfig(undefined);
const allCfg: AnalysisConfig = { ...analysisConfig({ analysis: { mode: "all" } }) };
const exportsCfg: AnalysisConfig = { ...analysisConfig({ analysis: { mode: "exports" } }) };

describe("shouldAnalyzeFile", () => {
  it("rejects non-target paths", () => {
    expect(shouldAnalyzeFile("/a/b.tsx", "export function f(){}", allCfg)).toBe(false);
    expect(shouldAnalyzeFile("/a/b.nudo.js", "export const x = 1", allCfg)).toBe(false);
  });

  it("A1 default mode=exports analyzes export-bearing files", () => {
    expect(defaultCfg.mode).toBe("exports");
    expect(shouldAnalyzeFile("/proj/a.js", "export function f(){}", defaultCfg)).toBe(true);
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

  it("mode=exports: comment/string mention of export is not an export", () => {
    expect(shouldAnalyzeFile("/proj/a.js", "// export later\nfunction f(){}", exportsCfg)).toBe(
      false,
    );
    expect(shouldAnalyzeFile("/proj/a.js", "/* export x */\nfunction f(){}", exportsCfg)).toBe(
      false,
    );
    expect(shouldAnalyzeFile("/proj/a.js", 'const s = "export";\nfunction f(){}', exportsCfg)).toBe(
      false,
    );
    expect(shouldAnalyzeFile("/proj/a.js", "export function f(){}", exportsCfg)).toBe(true);
    expect(shouldAnalyzeFile("/proj/a.js", "export default function f(){}", exportsCfg)).toBe(true);
    expect(shouldAnalyzeFile("/proj/a.js", "module.exports = function f(){}", exportsCfg)).toBe(
      true,
    );
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

  it("custom exclude glob **/*.spec.js excludes spec files at any depth", () => {
    const dir = tmpProject({
      name: "fx",
      nudo: { analysis: { mode: "all", exclude: ["**/*.spec.js"] } },
    });
    const spec = join(dir, "src", "deep", "a.spec.js");
    const plain = join(dir, "src", "a.js");
    mkdirSync(join(dir, "src", "deep"), { recursive: true });
    writeFileSync(spec, "export function f(){}\n");
    writeFileSync(plain, "export function f(){}\n");
    expect(shouldAnalyzeFile(spec, "export function f(){}")).toBe(false);
    expect(shouldAnalyzeFile(plain, "export function f(){}")).toBe(true);
  });

  it("custom exclude src/generated/** excludes the subtree (projectDir 相对匹配)", () => {
    const dir = tmpProject({
      name: "fx",
      nudo: { analysis: { mode: "all", exclude: ["src/generated/**"] } },
    });
    const gen = join(dir, "src", "generated", "deep", "g.js");
    const keep = join(dir, "src", "g.js");
    mkdirSync(join(dir, "src", "generated", "deep"), { recursive: true });
    writeFileSync(gen, "export function f(){}\n");
    writeFileSync(keep, "export function f(){}\n");
    expect(shouldAnalyzeFile(gen, "export function f(){}")).toBe(false);
    expect(shouldAnalyzeFile(keep, "export function f(){}")).toBe(true);
  });

  it("literal exclude paths still work (字面量子串)", () => {
    const dir = tmpProject({
      name: "fx",
      nudo: { analysis: { mode: "all", exclude: ["src/vendored"] } },
    });
    const vendored = join(dir, "src", "vendored", "lib.js");
    const keep = join(dir, "src", "lib.js");
    mkdirSync(join(dir, "src", "vendored"), { recursive: true });
    writeFileSync(vendored, "export function f(){}\n");
    writeFileSync(keep, "export function f(){}\n");
    expect(shouldAnalyzeFile(vendored, "export function f(){}")).toBe(false);
    expect(shouldAnalyzeFile(keep, "export function f(){}")).toBe(true);
  });

  it("custom exclude does not disable the built-in node_modules/dist/coverage defaults", () => {
    const dir = tmpProject({
      name: "fx",
      nudo: { analysis: { mode: "all", exclude: ["**/*.spec.js"] } },
    });
    const nm = join(dir, "node_modules", "p", "i.js");
    const dist = join(dir, "dist", "i.js");
    const cov = join(dir, "coverage", "i.js");
    mkdirSync(join(dir, "node_modules", "p"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, "coverage"), { recursive: true });
    writeFileSync(nm, "export function f(){}\n");
    writeFileSync(dist, "export function f(){}\n");
    writeFileSync(cov, "export function f(){}\n");
    expect(shouldAnalyzeFile(nm, "export function f(){}")).toBe(false);
    expect(shouldAnalyzeFile(dist, "export function f(){}")).toBe(false);
    expect(shouldAnalyzeFile(cov, "export function f(){}")).toBe(false);
  });

  it("no projectDir: **-rooted globs match the full path; relative-only globs honestly miss", () => {
    const specCfg: AnalysisConfig = { ...allCfg, exclude: ["**/*.spec.js"] };
    expect(shouldAnalyzeFile("/noproj/x/a.spec.js", "export function f(){}", specCfg)).toBe(false);
    expect(shouldAnalyzeFile("/noproj/x/a.js", "export function f(){}", specCfg)).toBe(true);
    // 纯相对前缀模式无 projectDir 可解析：按字面量/glob 语义如实不命中，
    // 不再静默退化成 node_modules/dist/coverage 之外的隐藏行为。
    const relCfg: AnalysisConfig = { ...allCfg, exclude: ["src/generated/**"] };
    expect(shouldAnalyzeFile("/noproj/src/generated/g.js", "export function f(){}", relCfg)).toBe(
      true,
    );
  });
});
