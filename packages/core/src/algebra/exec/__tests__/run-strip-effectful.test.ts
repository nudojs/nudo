import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../run.ts";

/**
 * analyze 模式顶层剥离（stripEffectfulTopLevel）的语义等价护栏。
 *
 * 旧实现是行级正则 + `endsWith(";")` / 括号计数启发式，三类输入静默改变
 * 程序语义（均已实证为旧行为）：
 * 1. 多行语句（回调体内行以 `;`/`}` 结尾）提前终止跳过 → 语句尾悬空
 *    → `new Function` SyntaxError（`setTimeout(fn, 100)` 整模块不可分析）；
 * 2. 字符串里的未配对 `(`（如 `"fetch("`）计入括号平衡 → 连带误删后续
 *    顶层 `export function`（导出整体静默变 unknown）；
 * 3. 列 0 的 `catch (` 头匹配「未知全局调用」正则 → catch 头被剥 →
 *    顶层 try/catch 一律 SyntaxError。
 *
 * 现实现为结构化（Babel 解析 transpile 产物，按顶层语句整条剥除）。本文件
 * 双向锁：剥离对象仍被整体剥除（不执行副作用、不 ReferenceError），未被
 * 剥离的语句与导出面保持语义等价（值 exact、导出名齐全）。
 */

function analyze(src: string): Record<string, unknown> {
  return runTranspiled(src, { mode: "analyze" });
}

function callF(run: Record<string, unknown>, name = "f"): unknown {
  return callTranspiledExportFull(run, name, []).result;
}

function litOf(abs: unknown): unknown {
  const term = (abs as { term?: { op: string; value: unknown } }).term;
  return term?.op === "lit" ? term.value : undefined;
}

describe("stripEffectfulTopLevel：analyze 模式剥离的语义等价", () => {
  it("多行语句 + 回调体字符串含 ';'：整条剥除，不悬空（旧：SyntaxError）", () => {
    const run = analyze(`setTimeout(function () { console.log("a;"); }, 100);
export function f() { return 42; }`);
    expect(litOf(callF(run))).toBe(42);
  });

  it("字符串含 'fetch(' 前缀（括号平衡旧误计）：for 剥除且后续导出完好（旧：export 静默丢失）", () => {
    const run = analyze(`for (let i = 0; i < 2; i++) { console.log("fetch( oops"); }
export function g() { return 7; }`);
    expect(Object.keys(run)).toContain("g");
    expect(litOf(callF(run, "g"))).toBe(7);
  });

  it("顶层 if + 字符串含 '((('：$fork 剥除且后续导出完好（旧：export 静默丢失）", () => {
    const run = analyze(`if (x > 0) { console.log("((("); }
export function h() { return 9; }`);
    expect(Object.keys(run)).toContain("h");
    expect(litOf(callF(run, "h"))).toBe(9);
  });

  it("顶层 $for 形态剥除：循环不执行（n=0），导出面不受牵连", () => {
    const run = analyze(`let n = 0;
for (let i = 0; i < 3; i++) { n = n + 1; }
export function f() { return n; }`);
    expect(litOf(callF(run))).toBe(0);
  });

  it("顶层 $whileSeq 剥除：循环不执行（a=0）", () => {
    const run = analyze(`let a = 0;
while (a < 3) { a = a + 1; }
export function f() { return a; }`);
    expect(litOf(callF(run))).toBe(0);
  });

  it("顶层 try/catch 完整保留：catch 吸收未知全局（旧：catch 头被剥 → SyntaxError）", () => {
    const run = analyze(`try { registerThing(); } catch (e) { }
export function f() { return 1; }`);
    expect(Object.keys(run)).toContain("f");
    expect(litOf(callF(run))).toBe(1);
  });

  it("无副作用顶层的常规文件：声明/本地调用/导出全保留，值 exact", () => {
    const run = analyze(`const a = 1;
let acc = 0;
function bump() { acc = acc + a; }
bump();
export function f() { return acc; }
export const k = a + 1;`);
    // bump：顶层 function 一律带 export 前缀（exportKw 口径，见 run-export-names.test.ts）
    expect(Object.keys(run).sort()).toEqual(["bump", "f", "k"]);
    expect(litOf(callF(run))).toBe(1);
    expect(litOf(run["k"])).toBe(2);
  });

  it("被保留语句里的模板字面量含 ';' 与 'fetch('：语义不变", () => {
    const run = analyze("const s = `fetch(x);\nmore`;\nconsole.log(s);\nexport function f() { return s.length; }");
    expect(litOf(callF(run))).toBe("fetch(x);\nmore".length);
  });

  it("顶层本地函数调用保留（诊断依赖）：副作用可见", () => {
    const run = analyze(`let acc = 0;
function bump() { acc = acc + 1; }
bump();
export function f() { return acc; }`);
    expect(litOf(callF(run))).toBe(1);
  });

  it("顶层 for-of 保留（口径）：循环执行（n=3）", () => {
    const run = analyze(`let n = 0;
for (const k of [1, 2]) { n = n + k; }
export function f() { return n; }`);
    expect(litOf(callF(run))).toBe(3);
  });

  it("顶层赋值保留：x=5 执行", () => {
    const run = analyze(`let x = 0;
x = 5;
export function f() { return x; }`);
    expect(litOf(callF(run))).toBe(5);
  });

  it("未知全局裸调用剥除：不 ReferenceError，导出完好", () => {
    const run = analyze(`registerThing(42);
export function f() { return 1; }`);
    expect(Object.keys(run)).toContain("f");
    expect(litOf(callF(run))).toBe(1);
  });

  it("顶层 throw 保留（口径）：模块级抛出 NudoThrow", () => {
    expect(() =>
      analyze(`throw new Error("boom");
export function f() { return 1; }`),
    ).toThrow();
  });

  it("多导出文件剥除后导出面完整（锁 export 整体丢失回归）", () => {
    const run = analyze(`fetch("http://x");
function g() { return 7; }
g();
export const a = 1;
export const b = 2;
export function h() { return g(); }`);
    expect(Object.keys(run).sort()).toEqual(["a", "b", "g", "h"]);
    expect(litOf(run["a"])).toBe(1);
    expect(litOf(run["b"])).toBe(2);
    expect(litOf(callF(run, "h"))).toBe(7);
  });
});
