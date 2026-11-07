// emit-bug-507-freeze-indent.test.ts — Bug 507：
// `nudo test --freeze` 为**导出函数**写回的 JSDoc 块缩进错位
//（按 `function` 关键字列号缩进，而非声明语句列号）。
//
// 复现形态：`export function greet(u) {...}` 的函数节点列是 7
//（`export default function` 是 15），但**声明语句**在列 0 ⇒ 旧实现把整块
// 右移 7/15 列，块与声明视觉脱节。
//
// 修法：缩进基准改为**声明行的行首缩进**（见 case-emitter.ts 的
// leadingIndent / insertGeneratedCaseDirectives）。
//
// 用例含：
// - 改前会失败的形态（导出函数 / 默认导出函数 ⇒ 块必须在列 0）；
// - 负控制（嵌套函数仍按声明行缩进 ⇒ 修复不把所有块拍平到列 0；
//   已有 JSDoc 块的注入位置不受影响）。
import { describe, it, expect } from "vitest";
import { abs as makeAbs, num } from "@nudojs/core";
import { analyzeFile, type AnalysisResult, type FunctionAnalysis } from "@nudojs/service";
import { insertGeneratedCaseDirectives } from "../case-emitter.ts";

function absExact(shape: Parameters<typeof makeAbs>[0]): ReturnType<typeof makeAbs> {
  return makeAbs(shape, undefined, undefined, "exact");
}

function makeFn(
  name: string,
  line: number,
  cases: Array<{ name: string; args: ReturnType<typeof makeAbs>[]; source?: "callsite" }>,
  flags: { column?: number } = {},
): FunctionAnalysis {
  return {
    name,
    loc: { start: { line, column: flags.column ?? 0 }, end: { line, column: 0 } },
    paramNames: [],
    cases: cases.map((c) => ({
      name: c.name,
      argAbs: c.args,
      abs: absExact({ k: "unknown" }),
      throwsAbs: absExact({ k: "never" }),
      source: c.source,
    })),
  };
}

function makeAnalysis(functions: FunctionAnalysis[]): AnalysisResult {
  return { functions, diagnostics: [], bindings: new Map(), nodeAbsMap: new Map(), caseHints: [] };
}

/** 源文件里某行的行首缩进（0 基列） */
function indentOf(source: string, lineText: string): number {
  const line = source.split("\n").find((l) => l.includes(lineText));
  return line === undefined ? -1 : line.length - line.trimStart().length;
}

describe("Bug 507 — freeze 写回的 JSDoc 块按声明语句列缩进", () => {
  it("export function：块落在列 0（不是 function 关键字的列 7）", () => {
    const source = `export function greet(u) {
  return u.name;
}
const r = greet({ name: "Ada" });
`;
    const analysis = analyzeFile("/test/bug-507-export.js", source);
    const fn = analysis.functions.find((f) => f.name === "greet");
    // 前置：真实分析器给出的函数节点列确实是 7（`function` 关键字所在列）
    expect(fn?.loc.start.column).toBe(7);

    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(true);
    const blockLine = result.source.split("\n").find((l) => l.includes("/**"));
    expect(blockLine).toBe("/**");
    expect(indentOf(result.source, "/**")).toBe(0);
    // 指令行与块尾行同样在列 0
    expect(result.source.split("\n")[1]).toBe(' * @nudo:case "call@L4" ({ name: "Ada" })');
    expect(result.source.split("\n")[2]).toBe(" */");
  });

  it("export default function：块落在列 0（不是 function 关键字的列 15）", () => {
    const source = `export default function greet(u) {
  return u.name;
}
const r = greet({ name: "Ada" });
`;
    const analysis = analyzeFile("/test/bug-507-export-default.js", source);
    const fn = analysis.functions.find((f) => f.name === "greet");
    expect(fn?.loc.start.column).toBe(15);

    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(true);
    expect(result.source.split("\n")[0]).toBe("/**");
    expect(indentOf(result.source, "/**")).toBe(0);
  });

  it("负控制：嵌套函数仍按声明行的行首缩进（修复不把所有块拍平到列 0）", () => {
    const source = `function outer() {
  function inner(x) {
    return x;
  }
  return inner(1);
}
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("inner", 2, [{ name: "call@L5", args: [num()], source: "callsite" }], { column: 2 })]),
    );
    expect(result.source).toBe(`function outer() {
  /**
   * @nudo:case "call@L5" (number())
   */
  function inner(x) {
    return x;
  }
  return inner(1);
}
`);
  });

  it("负控制：已有 JSDoc 块时指令行沿用块自身的缩进（不按函数节点列）", () => {
    const source = `/**
 * Adds numbers.
 */
export function add(a, b) {
  return a + b;
}
const r = add(1, 2);
`;
    const analysis = analyzeFile("/test/bug-507-existing-block.js", source);
    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(true);
    expect(result.source.split("\n")[1]).toMatch(/^ \* @nudo:case "call@L\d+"/);
    // 块首行仍是原样（列 0）
    expect(result.source.split("\n")[0]).toBe("/**");
  });
});
