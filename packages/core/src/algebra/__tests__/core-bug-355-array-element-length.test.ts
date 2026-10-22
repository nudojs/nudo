/**
 * Bug 355 —— 侧车 `array(string().max(1))` 的**元素长度界整条被丢弃** ⇒
 * L3 前置条件**假绿**（门禁 0 error），而 **zod 产物面**同时在执法 ⇒
 * **跨产物面自相矛盾**（CI 判绿、运行时校验器判红）。
 *
 * 根因：`min` / `max` 把界写成 `ge/le(length(self), n)`，其中 `self` 是
 * **当前 builder 自己的项**。当 builder 是 `string()` 时 `self` 就是被检查的
 * 那个字符串 ⇒ `length(s) ≤ 1` 可执法；当它被 `array(item)` 消费时 `item`
 * 变成**数组的元素约束** ⇒ `self` 变成**元素项** ⇒ 元素执法路径里没有
 * 「对元素求 length」的位置 ⇒ 该 pred **既不被求值、也不被报告**（静默丢弃）。
 *
 * 修法：数组的**元素**长度界进 Abs 投影（元素项带自己的 pred）+ 执法面按
 * 元素位（`length(a[0])`）求值 ⇒ 与 zod 面的 `z.array(z.string().max(1))`
 * 给出同一个裁决。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SIDE = `
import { fn, array, string, number } from "@nudojs/core";
export const f = fn({ a: array(string().max(1)) }, number());
`;

const LIB = `export function f(a) { return a.length; }`;

const CALLER = `
import { f } from "./file.js";
export function g() { return f(["abc"]); }
`;

/** 跨文件形态：被调方 file.js + 它的同名侧车 file.nudo.js 在调用方 caller.js 里被 import */
function checkCaller(caller: string) {
  const files = makeFiles({
    "/t/file.js": LIB,
    "/t/file.nudo.js": SIDE,
  });
  return checkSource("/t/caller.js", caller, pTrue, {
    loadModule: files.loadModule,
    resolve: files.resolve,
    fromFile: "/t/caller.js",
  });
}

function violated(caller: string): number {
  return checkCaller(caller).issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("Bug 355：数组元素的长度界被执法（此前静默丢弃 = 门禁假绿）", () => {
  it("元素超长 ⇒ 报违例（改前 0 error 假绿）", () => {
    expect(violated(CALLER)).toBe(1);
  });

  it("元素合规 ⇒ 不报违例（负控制）", () => {
    const ok = `
import { f } from "./file.js";
export function g() { return f(["a", "b"]); }
`;
    expect(violated(ok)).toBe(0);
  });

  it("违例文案点名元素位（length(a[0]) ≤ 1）而不是整个数组", () => {
    const r = checkCaller(CALLER);
    const issue = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(issue).toBeDefined();
    expect(issue!.expected).toContain("length(a[0])");
    expect(issue!.expected).toContain("≤ 1");
  });
});
