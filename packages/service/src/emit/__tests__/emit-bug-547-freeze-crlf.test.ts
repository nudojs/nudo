// emit-bug-547-freeze-crlf.test.ts — Bug 547：
// `nudo test --freeze` 把新 `@nudo:case` 块写进 **CRLF 源文件** ⇒ **混合行尾**
//（源文件被污染：原行保留 CRLF，新插入的行是裸 LF）。
//
// 复现形态：CRLF 文件固化后 `file(1)` 从「with CRLF line terminators」变成
// 「with CRLF, LF line terminators」。
//
// 修法：新插入的行按**源文件的主导行尾**写回（case-emitter.ts 的
// dominantEol / insertGeneratedCaseDirectives）——CRLF 主导 ⇒ 新行自带 "\r"。
//
// 用例含：
// - 改前会失败的形态（CRLF 文件写回后不得出现裸 LF）；
// - 负控制（LF 文件仍是 LF；原行行尾逐行保留；指令文本本身不变；
//   二次固化幂等 ⇒ already-generated、不再写盘）。
import { describe, it, expect } from "vitest";
import { abs as makeAbs, num } from "@nudojs/core";
import { analyzeFile, type AnalysisResult, type FunctionAnalysis } from "@nudojs/service";
import { insertGeneratedCaseDirectives } from "../case-emitter.ts";

function absExact(shape: Parameters<typeof makeAbs>[0]): ReturnType<typeof makeAbs> {
  return makeAbs(shape, undefined, undefined, "exact");
}

function makeFn(name: string, line: number, caseName: string): FunctionAnalysis {
  return {
    name,
    loc: { start: { line, column: 0 }, end: { line, column: 0 } },
    paramNames: [],
    cases: [
      {
        name: caseName,
        argAbs: [num()],
        abs: absExact({ k: "unknown" }),
        throwsAbs: absExact({ k: "never" }),
        source: "callsite",
      },
    ],
  };
}

function makeAnalysis(functions: FunctionAnalysis[]): AnalysisResult {
  return { functions, diagnostics: [], bindings: new Map(), nodeAbsMap: new Map(), caseHints: [] };
}

/** 文件里的裸 LF 数（不含 CRLF 的 "\r\n"） */
function bareLfCount(text: string): number {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  return lf - crlf;
}

describe("Bug 547 — freeze 写回不污染 CRLF 源文件的行尾", () => {
  const CRLF_SOURCE = "export function f(x) {\r\n  return x + 1;\r\n}\r\n";

  it("CRLF 文件：固化后仍是纯 CRLF（新块不带裸 LF）", () => {
    const result = insertGeneratedCaseDirectives(
      CRLF_SOURCE,
      makeAnalysis([makeFn("f", 1, "call@L2")]),
    );
    expect(result.changed).toBe(true);
    expect(bareLfCount(result.source)).toBe(0);
    // 期望形态：新块三行都以 CRLF 收尾
    expect(result.source).toBe(
      "/**\r\n" +
        ' * @nudo:case "call@L2" (number())\r\n' +
        " */\r\n" +
        "export function f(x) {\r\n" +
        "  return x + 1;\r\n" +
        "}\r\n",
    );
  });

  it("CRLF 文件：原行的行尾逐行保留（不被改写成 LF）", () => {
    const result = insertGeneratedCaseDirectives(
      CRLF_SOURCE,
      makeAnalysis([makeFn("f", 1, "call@L2")]),
    );
    const original = CRLF_SOURCE.split("\n");
    const emitted = result.source.split("\n");
    // 原三行（含各自的 "\r"）原样出现在写回结果里
    expect(emitted.slice(3)).toEqual(original);
  });

  it("CRLF 文件：真实分析器驱动的固化同样不混排行尾", () => {
    const source = "export function f(x) {\r\n  return x + 1;\r\n}\r\nf(1);\r\n";
    const analysis = analyzeFile("/test/bug-547-crlf.js", source);
    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(true);
    expect(bareLfCount(result.source)).toBe(0);
  });

  it("负控制：LF 文件写回后仍是 LF（不引入 CR）", () => {
    const source = "export function f(x) {\n  return x + 1;\n}\n";
    const result = insertGeneratedCaseDirectives(source, makeAnalysis([makeFn("f", 1, "call@L2")]));
    expect(result.changed).toBe(true);
    expect(result.source.includes("\r")).toBe(false);
    expect(result.source).toBe(
      "/**\n" +
        ' * @nudo:case "call@L2" (number())\n' +
        " */\n" +
        "export function f(x) {\n" +
        "  return x + 1;\n" +
        "}\n",
    );
  });

  it("负控制：二次固化幂等（CRLF 文件第二次不再写盘）", () => {
    const first = insertGeneratedCaseDirectives(
      CRLF_SOURCE,
      makeAnalysis([makeFn("f", 1, "call@L2")]),
    );
    const second = insertGeneratedCaseDirectives(
      first.source,
      makeAnalysis([makeFn("f", 1, "call@L2")]),
    );
    expect(second.changed).toBe(false);
    expect(second.written).toEqual([]);
    expect(second.skipped.map((s) => s.reason)).toContain("already-generated");
    expect(second.source).toBe(first.source);
  });
});
