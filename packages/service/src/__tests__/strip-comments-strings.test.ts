/**
 * 注释/字符串剥离必须是单遍状态机：字符串/模板/正则里的 //、/* 不得吞掉
 * 后续 export，也不得伪造 export/directive。
 */
import { describe, it, expect } from "vitest";
import { shouldAnalyzeFile, hasNudoDirectives } from "../analysis-scope.ts";
import { analysisConfig, type AnalysisConfig } from "../evaluator/config.ts";

const exportsCfg: AnalysisConfig = { ...analysisConfig({ analysis: { mode: "exports" } }) };
const analyzes = (src: string): boolean => shouldAnalyzeFile("/proj/a.js", src, exportsCfg);

describe("hasExport is string/comment-aware", () => {
  it("字符串/模板/正则/转义/嵌套模板的 export 判定表", () => {
    const cases: Array<[string, boolean]> = [
      [`const t = "https://a"; export const x = 1;`, true],
      [`const s = "/*"; export const z = 2; const w = "*/";`, true],
      [`// export const x = 1;\nconst y = 2;`, false],
      [`/* export const x = 1; */ const y = 2;`, false],
      [`const s = "export const x = 1";`, false],
      ["const u = `https://x`; export function f() { return 1; }", true],
      ["const re = /https?:\\/\\//; export const x = 1;", true],
      ["const re = /export const x/; const y = 2;", false],
      ["const s = `${exports.x}`; const y = 2;", true],
      ["const s = `a${`export b`}d`; export const y = 2;", true],
      ["const s = `export const x = 1`; const y = 2;", false],
      [`const s = "a\\"//b"; export const x = 1;`, true],
    ];
    for (const [src, expected] of cases) expect(analyzes(src), src).toBe(expected);
    expect(hasNudoDirectives("/**\n * @nudo:skip\n */\nexport function f() {}")).toBe(true);
    expect(hasNudoDirectives("export function f() { return 1; }")).toBe(false);
  });
});

describe("hasNudoDirectives ignores string/template false hits", () => {
  it("字符串/模板不计数；行注释计数；directives 模式不拉入假命中", () => {
    for (const src of ['const x = "@nudo:case";', 'const doc = "@nudo:contract";', "const x = `@nudo:pure`;"]) {
      expect(hasNudoDirectives(src), src).toBe(false);
    }
    for (const src of ['// @nudo:case "a" (1)', "// @nudo:skip\nfunction f() {}"]) {
      expect(hasNudoDirectives(src), src).toBe(true);
    }
    const dirCfg = analysisConfig({ analysis: { mode: "directives" } });
    expect(shouldAnalyzeFile("/proj/a.js", 'const note = "@nudo:case";', dirCfg)).toBe(false);
    expect(shouldAnalyzeFile("/proj/a.js", '// @nudo:case "a" (1)\nfunction f(){}', dirCfg)).toBe(true);
  });
});
