/**
 * 注释/字符串剥离必须是单遍状态机：先剥注释会把字符串里的 // 和 /*
 * 当成注释起点，连同后面的 export 一起吃掉。
 * 回归背景：`const t = "https://a"; export const x = 1;` 里
 * `//a"; export` 被当行注释，hasExport 变 false，LSP/watch 直接跳过该文件。
 */
import { describe, it, expect } from "vitest";
import { shouldAnalyzeFile, hasNudoDirectives } from "../analysis-scope.ts";
import { analysisConfig, type AnalysisConfig } from "../evaluator/config.ts";

const exportsCfg: AnalysisConfig = {
  ...analysisConfig({ analysis: { mode: "exports" } }),
};

function analyzes(src: string): boolean {
  return shouldAnalyzeFile("/proj/a.js", src, exportsCfg);
}

describe("hasExport is string/comment-aware", () => {
  it("URL in string does not hide a following export", () => {
    expect(analyzes(`const t = "https://a"; export const x = 1;`)).toBe(true);
  });

  it("block-comment marker inside string does not hide export", () => {
    expect(analyzes(`const s = "/*"; export const z = 2; const w = "*/";`)).toBe(true);
  });

  it("real line comment still hides export text", () => {
    expect(analyzes(`// export const x = 1;\nconst y = 2;`)).toBe(false);
  });

  it("real block comment still hides export text", () => {
    expect(analyzes(`/* export const x = 1; */ const y = 2;`)).toBe(false);
  });

  it("export inside a string is not an export", () => {
    expect(analyzes(`const s = "export const x = 1";`)).toBe(false);
  });

  it("template string with // keeps following export visible", () => {
    expect(analyzes("const u = `https://x`; export function f() { return 1; }")).toBe(true);
  });

  it("escaped quote in string does not end the string early", () => {
    expect(analyzes(`const s = "a\\"//b"; export const x = 1;`)).toBe(true);
  });

  it("hasNudoDirectives still finds tags in comments", () => {
    expect(hasNudoDirectives("/**\n * @nudo:skip\n */\nexport function f() {}")).toBe(true);
    expect(hasNudoDirectives("export function f() { return 1; }")).toBe(false);
  });
});
