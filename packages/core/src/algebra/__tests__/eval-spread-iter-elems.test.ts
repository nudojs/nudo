/**
 * 类 C 抽象求值回归（Bug 4 / 19）——spread / 迭代元素域污染：
 * - Bug 4：数组/字符串字面量 spread（`[...xs]` / `[...s]`）经 $concat，arr
 *   分支把空 tuple 的 join 操作数取成 unknown（top）→ 元素域被污染成
 *   `number | unknown`；抽象字符串接收者走 sideEl 无 prim-string 臂 →
 *   `unknown[]`（字符串按 code point 可迭代是 total 面，元素域恒 string）。
 * - Bug 19：`for (const c of s)` / `yield* s`（抽象字符串）循环变量 →
 *   unknown → `c.length` / `n += c` 级联污染（`+` 的字符串拼接臂凭空出现）。
 *   elemsOf 补 prim-string 臂（单代表元素 [string]，字面量 code point 展开
 *   优先级不变）。
 * 原生 ground truth：node v26 实测（[..."ab"] → ["a","b"]）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatAbs,
  abs,
} from "@nudojs/core";

const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
const arrNum = abs(
  { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "path") },
  undefined,
  undefined,
  "partial",
);

function callWith(
  src: string,
  args: unknown[],
  fnName = "f",
): { value: string; throws: string; lit: { ok: boolean; value?: unknown } } {
  const run = runTranspiled(src, { mode: "analyze" });
  let result: { result?: unknown; throws?: unknown } = {};
  try {
    result = callTranspiledExportFull(run, fnName, args as never[]) as never;
  } catch {
    /* 入口整抛 */
  }
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result),
    throws: norm(result.throws),
    lit: litValue(result.result),
  };
}

describe("Bug 4: 字面量 spread 元素域不被污染", () => {
  it("[...xs]（xs: number[]）→ number[]（不再 number | unknown[]）", () => {
    const r = callWith(`export function f(xs) { return [...xs]; }`, [arrNum]);
    expect(r.value).toBe("number[]");
  });

  it("[...xs, 1] → number[]（尾元素 lit 并入 number 域，不污染 unknown）", () => {
    const r = callWith(`export function f(xs) { return [...xs, 1]; }`, [arrNum]);
    // join(number, 1) 吸收 lit → number（sound：native 元素 ∈ number）
    expect(r.value).toBe("number[]");
    expect(r.value).not.toContain("unknown");
  });

  it("[...s]（s: string）→ string[]（code point 迭代 total 面）", () => {
    const r = callWith(`export function f(s) { return [...s]; }`, [strAbs]);
    expect(r.value).toBe("string[]");
  });

  it("级联下标读：[...xs][0] → number；[...s][0] → string", () => {
    expect(callWith(`export function f(xs) { return [...xs][0]; }`, [arrNum]).value).toBe("number");
    expect(callWith(`export function f(s) { return [...s][0]; }`, [strAbs]).value).toBe("string");
  });

  it("字面量接收者精确面不变", () => {
    expect(callWith(`export function f() { return [...[1, 2], 3]; }`, []).value).toBe("[1, 2, 3]");
    expect(callWith(`export function f() { return [..."ab"]; }`, []).value).toBe('["a", "b"]');
  });

  it("any 接收者保持 any[]（anyMemberResult 口径不变）", () => {
    const r = callWith(`export function f(x) { return [...x]; }`, [
      abs({ k: "any" }, undefined, undefined, "path"),
    ]);
    expect(r.value).toBe("any[]");
  });
});

describe("Bug 19: 抽象字符串 for-of / yield* 循环变量 = string", () => {
  it("for (const c of s)：return c → string（不再 unknown）", () => {
    const r = callWith(
      `export function f(s) { for (const c of s) { return c; } return ""; }`,
      [strAbs],
    );
    // join(string, "") 吸收 lit → string（sound：native 返回值 ∈ string）
    expect(r.value).toBe("string");
  });

  it("for (const c of s)：n += c.length → number（不再 number | string）", () => {
    const r = callWith(
      `export function f(s) { let n = 0; for (const c of s) { n += c.length; } return n; }`,
      [strAbs],
    );
    expect(r.value).toBe("number");
  });

  it("yield* s：generator 元素域 string", () => {
    const r = callWith(`export function* g(s) { yield* s; }`, [strAbs], "g");
    expect(r.value).toContain('"0": string');
    expect(r.value).not.toContain("unknown");
  });

  it("spread 调用实参：f(...s) 元素 string（经 $elems 同口径）", () => {
    const r = callWith(
      `export function f(s) { return Math.max(...s); }`,
      [strAbs],
    );
    // Math.max(string...) → NaN 候选并入 number 域；不出现 unknown 实参臂
    expect(r.value).not.toContain("unknown");
  });

  it("字面量字符串 for-of 精确面不变", () => {
    const r = callWith(
      `export function f() { for (const c of "ab") { return c; } return ""; }`,
      [],
    );
    expect(r.lit).toEqual({ ok: true, value: "a" });
  });
});
