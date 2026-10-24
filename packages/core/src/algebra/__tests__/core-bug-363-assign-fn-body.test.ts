/**
 * Bug 363 回归：`nudo:assign-mismatch` 必须覆盖**函数体内**的赋值。
 *
 * 机制（Bug 363）：赋值记录收集器（`setEvalAssignCollector`）的**作用域窗口**
 * 只包住**模块顶层求值**；而函数体在 `generalizeFromAst`（check.ts 的函数
 * 循环里）就**早于**收集器安装求过一遍 ⇒ 函数体内的 `$assignRecord` 全部
 * 落空 ⇒ `nudo:assign-mismatch` 只覆盖顶层（真实代码里赋值的主要发生地
 * 恰恰是函数体 ⇒ 假绿）。
 *
 * 修法（check.ts / checkSourceInner）：收集器的安装点**前移到函数循环之前**
 * （窗口 = 函数循环 + 其后的顶层求值段）；窗口扩大带来的「同一赋值点被多次
 * 求值」由 `dedupeAssignRecords`（点位 + prev/next 值）折叠。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

/** 函数体内的赋值（真实代码的主要形态） */
const FN_BODY = `export function g() { let n = 1; n = "str"; return n; }`;

/** 模块顶层的赋值（修前唯一被覆盖的面） */
const TOP_LEVEL = ["let n = 1;", 'n = "str";'].join("\n");

/** 顶层赋值 + 函数体赋值（两条都该报，且各一条） */
const MIX = [
  "let n = 1;",
  'n = "str";',
  'export function f() { let m = 1; m = "str"; return m; }',
].join("\n");

/** 顶层赋值 + 一个函数体赋值 + 第二个函数调用第一个（同一赋值点被多次求值） */
const MIX_CALLED = [
  "let n = 1;",
  'n = "str";',
  'export function g() { let m = 1; m = "str"; return m; }',
  "export function h() { return g(); }",
].join("\n");

function assignIssues(src: string, file = "bug-363.js") {
  return checkSource(file, src, pTrue, { entryThrows: "off" }).issues.filter(
    (i) => i.code === "nudo:assign-mismatch",
  );
}

describe("Bug 363：assign-mismatch 必须覆盖函数体内的赋值", () => {
  it("函数体内的标量改型 ⇒ 报 nudo:assign-mismatch（修前 0 条）", () => {
    const issues = assignIssues(FN_BODY);
    expect(issues.length).toBe(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toBe("n: assignment ⊭ existing shape");
    // 位置 = 函数体内那处赋值（第 1 行）
    expect(issues[0]!.line).toBe(1);
  });

  it("函数体内的对象改型 ⇒ 报 nudo:assign-mismatch", () => {
    const issues = assignIssues(
      `export function f() { let a = {x:1}; a = {y:2}; return a; }`,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toBe("a: assignment ⊭ existing shape");
  });

  it("函数体内改写模块级绑定 ⇒ 报 nudo:assign-mismatch", () => {
    const issues = assignIssues(
      [
        'let config = {host:"localhost",port:8080};',
        'export function f(){ config = {host:"y"}; return config; }',
      ].join("\n"),
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toBe("config: assignment ⊭ existing shape");
  });

  it("控制组：模块顶层赋值仍然报（修前覆盖面不得回退）", () => {
    const issues = assignIssues(TOP_LEVEL);
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toBe("n: assignment ⊭ existing shape");
  });

  it("顶层 + 函数体各报一条（不多不少）", () => {
    const issues = assignIssues(MIX);
    expect(issues.map((i) => i.message).sort()).toEqual([
      "m: assignment ⊭ existing shape",
      "n: assignment ⊭ existing shape",
    ]);
  });

  it("同一赋值点被多次求值 ⇒ 只报一条（窗口扩大不得制造同文双计）", () => {
    const issues = assignIssues(MIX_CALLED);
    expect(issues.map((i) => i.message).sort()).toEqual([
      "m: assignment ⊭ existing shape",
      "n: assignment ⊭ existing shape",
    ]);
  });
});
