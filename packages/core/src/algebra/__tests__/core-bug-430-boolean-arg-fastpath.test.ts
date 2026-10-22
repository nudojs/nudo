/**
 * Bug 430 —— 实参快路径**不认 `BooleanLiteral`** ⇒ 同一个调用点，
 * **顶层语句报错、函数体内静默放行**（作用域相关的假绿）。
 *
 * 根因：`scan/literal-args.ts` 的 `parseCallArgs` 快路径分派表
 * （NumericLiteral / Unary(-) / Object / Array / String / Null / **缺 Boolean** /
 * Identifier / MemberExpression / SpreadElement / CallExpression / 兜底）里
 * **没有 `BooleanLiteral` 分支** ⇒ `f(true)` 落到兜底 `absUnknown()` ⇒
 * `hasInfo = false` ⇒ 静态路径整条跳过 ⇒ 只剩「执行态实参回退」能救场，
 * 而执行态记录**只在模块顶层语句真的被执行过**时才有 ⇒ 函数体内的调用点
 * 永远没有记录 ⇒ 静默。
 *
 * 修法（S0）：分派表补 `BooleanLiteral` 一个分支（`prim boolean` + `lit` term，
 * 与 `NullLiteral` 分支同款）⇒ `hasInfo` 不再依赖执行态回退 ⇒
 * **顶层与函数体内给出同一条诊断**。
 *
 * 注：`NullLiteral` 分支由族 06（Bug 965）补上；本条只剩 `BooleanLiteral`。
 */
import { describe, it, expect } from "vitest";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `
import { number, boolean } from "@nudojs/core";
export const numC = number();
export const boolC = boolean();
export const posC = number().gt(0);
`;

const IMP = `/// @nudo:import { numC, boolC, posC } from "./std430.nudo.js"\n`;

/** checkSource + 侧车（共享脚手架 sidecarOpts，不内联副本） */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(
    "/t/std430.js",
    IMP + src,
    pTrue,
    sidecarOpts("std430", SIDE),
  );
}

/** 契约违例（调用点前置条件）诊断 */
function violations(r: {
  issues: { code: string; severity: string; actual?: string; expected?: string }[];
}) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && i.severity === "error",
  );
}

describe("Bug 430 —— 布尔字面量实参走快路径（顶层与函数体内同判）", () => {
  it("顶层 `f(true)` ⇒ 报违例（改前也报，走的是执行态回退）", () => {
    const r = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
f(true);
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("true");
  });

  it("★ 函数体内 `f(true)` ⇒ 报违例（改前**零诊断**——假绿）", () => {
    const r = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
export function g() { f(true); return 1; }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("true");
    expect(vs[0].expected).toContain("number");
  });

  it("★ 函数体内 `f(false)` ⇒ 报违例（改前零诊断）", () => {
    const r = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
export function g() { f(false); return 1; }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("false");
  });

  it("作用域不再决定裁决：顶层与函数体内的诊断**逐字相同**", () => {
    const top = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
f(true);
`);
    const body = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
export function g() { f(true); return 1; }
`);
    const a = violations(top)[0];
    const b = violations(body)[0];
    expect(a.actual).toBe(b.actual);
    expect(a.expected).toBe(b.expected);
  });

  it("负控制：契约是 boolean() 时 `f(true)` ⇒ 不报违例", () => {
    const r = check(`
/** @nudo:contract x boolC */
export function f(x) { return x; }
export function g() { f(true); return 1; }
`);
    expect(violations(r).length).toBe(0);
  });

  it("负控制：契约是 boolean() 时 `f(false)` ⇒ 不报违例", () => {
    const r = check(`
/** @nudo:contract x boolC */
export function f(x) { return x; }
export function g() { f(false); return 1; }
`);
    expect(violations(r).length).toBe(0);
  });

  it("回归：`f(null)` 仍照常执法（族 06 的 NullLiteral 分支没被弄坏）", () => {
    const r = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
export function g() { f(null); return 1; }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("null");
  });

  it("回归：数值实参仍照常执法（两种作用域都报）", () => {
    const r = check(`
/** @nudo:contract x posC */
export function f(x) { return x; }
export function g() { f(0); return 1; }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("0");
  });
});
