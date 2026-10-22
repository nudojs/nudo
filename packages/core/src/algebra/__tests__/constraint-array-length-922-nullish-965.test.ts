/**
 * Bug 922 —— 数组**自身**的长度界（`array(number()).min(3)`）在约束 → Abs
 * 投影里整条蒸发 ⇒ 契约面 / zod 面 / standard 面 / 门禁面全都看不见这条界
 * ⇒ 门禁 exit 0 放行（完全静默的假绿），用户写下的约束在任何产物里都不留
 * 痕迹。
 *
 * 根因：`constraintOnTermAbs` 的数组分支提前返回，**pred 槽写死 undefined**
 * ⇒ 数组约束的顶层 preds（`.min(n)` / `.max(n)` 写入的 `ge/le(length(self), n)`）
 * 没有任何承载位（对照组：prim 分支保留 pred ⇒ 字符串长度界能执法）。
 *
 * 修法（两半）：
 * 1. 数组分支承载顶层 preds（与 prim 分支同款）⇒ Abs 面有位置；
 * 2. 执法面（`scan-literal-calls.ts`）的 length 通道对**数组值**求值（此前
 *    只处理字符串 ⇒ 数组实参的长度界整条被跳过）。
 *
 * Bug 965 —— `lit(null)` / `lit(undefined)` 的整条约束在 Abs 里消失（pred
 * 被丢弃 + shape 退成 unknown）⇒ 形参退化成 `unknown`、调用点前置条件不再
 * 执法（假绿）⇒ 三个面三种答案。
 *
 * 修法：`constraintOnTermAbs` 的 allEqNullish 分支**不再丢 pred**；执法面的
 * eq 通道补 nullish 字面量（此前只认 number/string/boolean ⇒ `lit(null)`
 * 契约整条不执法）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, constraintToEntryAbs, pTrue } from "@nudojs/core";
import { array, litC, number } from "@nudojs/core";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `
import { number, array, lit } from "@nudojs/core";
export const atLeast3 = array(number()).min(3);
export const atMost2 = array(number()).max(2);
export const onlyNull = lit(null);
export const onlyUndef = lit(undefined);
`;

const IMP = `/// @nudo:import { atLeast3, atMost2, onlyNull, onlyUndef } from "./std922.nudo.js"\n`;

function check(src: string) {
  return checkSource("/t/std922.js", IMP + src, pTrue, sidecarOpts("std922", SIDE));
}

/** 契约违例（调用点前置条件）条数 */
function violated(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("Bug 922 —— 数组自身的长度界：Abs 承载 + 门禁执法", () => {
  it("Abs 投影承载数组自身的长度界（ge(length(xs), 3)）", () => {
    const a = constraintToEntryAbs(array(number()).min(3), "xs");
    expect(a.shape.k).toBe("arr");
    expect(a.pred).toBeDefined();
    expect(a.pred?.op).toBe("ge");
  });

  it("门禁：数组实参长度不足 ⇒ 报违例（改前 exit 0 假绿）", () => {
    const r = check(`
/** @nudo:contract xs atLeast3 */
export function g(xs) { return xs.length; }
export function use() { return g([1, 2]); }
`);
    expect(violated(r)).toBe(1);
  });

  it("门禁：数组实参长度足够 ⇒ 不报违例（负控制）", () => {
    const r = check(`
/** @nudo:contract xs atLeast3 */
export function g(xs) { return xs.length; }
export function use() { return g([1, 2, 3]); }
`);
    expect(violated(r)).toBe(0);
  });

  it("门禁：.max(2) 上界同样执法", () => {
    const r = check(`
/** @nudo:contract xs atMost2 */
export function g(xs) { return xs.length; }
export function use() { return g([1, 2, 3]); }
`);
    expect(violated(r)).toBe(1);
  });
});

describe("Bug 965 —— lit(null) / lit(undefined)：Abs 保留 pred + 门禁执法", () => {
  it("Abs 投影不再丢 pred（lit(null) 的 eq 约束留在 pred 槽）", () => {
    const a = constraintToEntryAbs(litC(null), "x");
    expect(a.pred).toBeDefined();
    expect(a.pred?.op).toBe("eq");
  });

  it("Abs 投影：lit(undefined) 同样保留 pred", () => {
    const a = constraintToEntryAbs(litC(undefined), "x");
    expect(a.pred).toBeDefined();
    expect(a.pred?.op).toBe("eq");
  });

  it("门禁：lit(null) 契约收到非 null 实参 ⇒ 报违例（改前 exit 0 假绿）", () => {
    const r = check(`
/** @nudo:contract x onlyNull */
export function f(x) { return 1; }
export function use() { return f(2); }
`);
    expect(violated(r)).toBe(1);
  });

  it("门禁：lit(null) 契约收到 null 实参 ⇒ 不报违例", () => {
    const r = check(`
/** @nudo:contract x onlyNull */
export function f(x) { return 1; }
export function use() { return f(null); }
`);
    expect(violated(r)).toBe(0);
  });

  it("门禁：lit(undefined) 契约收到 undefined 实参 ⇒ 不报违例", () => {
    const r = check(`
/** @nudo:contract x onlyUndef */
export function f(x) { return 1; }
export function use() { return f(undefined); }
`);
    expect(violated(r)).toBe(0);
  });

  it("门禁：lit(undefined) 契约收到 null 实参 ⇒ 报违例（两个域不同）", () => {
    const r = check(`
/** @nudo:contract x onlyUndef */
export function f(x) { return 1; }
export function use() { return f(null); }
`);
    expect(violated(r)).toBe(1);
  });
});
