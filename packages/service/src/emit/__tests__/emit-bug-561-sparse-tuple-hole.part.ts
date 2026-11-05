// emit-bug-561-sparse-tuple-hole.test.ts — Bug 561：
// `nudo test --freeze` 把稀疏元组的**洞**固化成**显式 `undefined` 元素**
// ⇒ 固化后同一调用点的见证从 `false` **翻成 `true`**（与事实相反）。
//
// 复现形态：`hasIdx1([1, , 3])` 的观测值是 `[1, , 3] => false`（洞保留，
// `1 in a` 为 false）；固化把指令写成 `([1, undefined, 3])` ⇒ 再解析时洞
// 变成稠密的显式 undefined 槽 ⇒ 同一调用点的见证翻成 `true`。
//
// 根因：洞位的 `elements[i]` 是 undefAbs()，与「显式 undefined 元素」的 Abs
// **完全同形** ⇒ 序列化不可区分；而 case 实参文法**没有空槽写法**。
//
// 修法：tuple 分支先读 `s.holes`——有洞 ⇒ 整条不可表达（返回 null，与 rest
// 槽同口径）⇒ `buildCaseDirective` 放弃该见证，不静默近似。
//
// 用例含：
// - 改前会失败的形态（带洞的元组不可序列化；带洞的见证不被写进源码）；
// - 负控制（稠密元组照常固化；洞与「显式 undefined 元素」在 Abs 层同形
//   ——不可区分性正是根因，故只有洞位走放弃路径）。
import { describe, it, expect } from "vitest";
import { abs as makeAbs, num, formatShape } from "@nudojs/core";
import { absLit } from "@nudojs/core/internal";
import { analyzeFile, type AnalysisResult, type FunctionAnalysis } from "@nudojs/service";
import {
  serializeCaseArg,
  buildCaseDirective,
  insertGeneratedCaseDirectives,
} from "../case-emitter.ts";

function absExact(shape: Parameters<typeof makeAbs>[0]): ReturnType<typeof makeAbs> {
  return makeAbs(shape, undefined, undefined, "exact");
}

/** 稀疏元组：[1, <洞>, 3]（洞位是 undefAbs()，与显式 undefined 元素同形） */
function sparseTuple(): ReturnType<typeof makeAbs> {
  return absExact({ k: "tuple", elements: [absLit(1), absLit(undefined), absLit(3)], holes: [1] });
}

function makeFn(name: string, line: number, args: ReturnType<typeof makeAbs>[]): FunctionAnalysis {
  return {
    name,
    loc: { start: { line, column: 0 }, end: { line, column: 0 } },
    paramNames: [],
    cases: [
      {
        name: "call@L5",
        argAbs: args,
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

describe("Bug 561 — 稀疏元组的洞不被固化成显式 undefined", () => {
  it("带洞的元组不可序列化（整条放弃，不静默近似）", () => {
    expect(serializeCaseArg(sparseTuple())).toBeNull();
    expect(buildCaseDirective("call@L5", [sparseTuple()])).toBeNull();
  });

  it("formatShape 仍把洞渲染成空槽（观测面不受影响）", () => {
    expect(formatShape(sparseTuple())).toBe("[1, , 3]");
  });

  it("带洞的见证不被写进源码（改前会写成 [1, undefined, 3]）", () => {
    const source = `export function hasIdx1(a) {
  return 1 in a;
}
const arr = [1, , 3];
hasIdx1(arr);
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("hasIdx1", 1, [sparseTuple()])]),
    );
    expect(result.changed).toBe(false);
    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual([
      { fn: "hasIdx1", reason: "no-serializable-cases", detail: "case call@L5 not serializable" },
    ]);
    expect(result.source).toBe(source);
    expect(result.source.includes("undefined")).toBe(false);
  });

  it("真实分析器：稀疏实参的见证被放弃，源码不被改写", () => {
    const source = `export function hasIdx1(a) {
  return 1 in a;
}
const arr = [1, , 3];
hasIdx1(arr);
`;
    const analysis = analyzeFile("/test/bug-561-sparse.js", source);
    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it("负控制：稠密元组照常固化（洞判据不误伤稠密元组）", () => {
    const dense = absExact({ k: "tuple", elements: [absLit(1), absLit(3)] });
    expect(serializeCaseArg(dense)).toBe("[1, 3]");
    const source = `export function first(a) {
  return a[0];
}
const arr = [1, 3];
first(arr);
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("first", 1, [dense])]),
    );
    expect(result.changed).toBe(true);
    expect(result.source).toContain('@nudo:case "call@L5" ([1, 3])');
  });

  it("负控制：显式 undefined 元素（无洞）仍可表达", () => {
    const denseUndef = absExact({ k: "tuple", elements: [absLit(1), absLit(undefined)] });
    expect(serializeCaseArg(denseUndef)).toBe("[1, undefined]");
  });
});
