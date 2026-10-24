/**
 * Bug 305 回归：%TypedArray%.prototype.set 缺**逐元素 ToNumber / ToBigInt**
 * 转换校验。
 *
 * 原生（node v26 实测）：
 *   new Uint8Array(2).set([1n])       → TypeError（Cannot convert a BigInt
 *     value to a number）
 *   new BigInt64Array(2).set([1])     → TypeError（Invalid argument type in
 *     ToBigInt operation）
 *   new BigInt64Array(2).set([1.5])   → TypeError
 *   new BigInt64Array(2).set([null])  → TypeError
 *   new BigInt64Array(2).set([undefined]) → TypeError
 * 合法（ToBigInt(true) / ToBigInt("2") / ToNumber(null) / ToNumber(undefined)）：
 *   new BigInt64Array(2).set([true])  → no-throw
 *   new BigInt64Array(2).set(["2"])   → no-throw
 *   new Uint8Array(2).set([null])     → no-throw
 *   new Uint8Array(2).set([undefined])→ no-throw
 *   new Uint8Array(2).set([1.5])      → no-throw
 *
 * 引擎此前 set 路径完全不接元素转换面（只读源长度做越界档）⇒ 原生 TypeError
 * 被折成 no-throw。修法：复用 binary.ts 的 enforceTaItem /
 * enforceTaItemConversion（构造器 / from / of 同一口径）做逐元素判定。
 *
 * 原生报错序（node v26）：越界（RangeError）先于元素转换（TypeError）——
 * new Uint8Array(2).set([1n, 2n, 3n]) → RangeError（既有 Bug 38 档）。
 */
import { describe, it, expect } from "vitest";
import { call, val, effects } from "./eval-helpers.ts";
import { l2Count } from "./nudo-constraints.ts";
import { checkSource } from "../check.ts";

/** 原生：定抛（try/catch 吸收后返回 "caught"） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛：无 try/catch 时 throws 面是相应 Error brand */
function expectThrows(src: string, name: string) {
  const r = call(src);
  const got = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(got, `throws ${name} for: ${src}`).toBe(name);
}

function check(src: string) {
  return checkSource("/t/eval-bug-305.js", src);
}

// ---------------------------------------------------------------------------
// 改前会失败的形态：逐元素转换 → definite TypeError
// ---------------------------------------------------------------------------

describe("Bug 305：TA set 逐元素转换 → definite TypeError", () => {
  it.each([
    ["number 域收 bigint 字面量", `const ta = new Uint8Array(2); ta.set([1n]); return "no-throw";`],
    ["number 域收 bigint 字面量（混合）", `const ta = new Uint8Array(2); ta.set([1, 2n]); return "no-throw";`],
    ["number 域收 symbol", `const ta = new Uint8Array(2); ta.set([Symbol("x")]); return "no-throw";`],
    ["bigint 域收 number 字面量", `const ta = new BigInt64Array(2); ta.set([1]); return "no-throw";`],
    ["bigint 域收小数字面量", `const ta = new BigInt64Array(2); ta.set([1.5]); return "no-throw";`],
    ["bigint 域收 null", `const ta = new BigInt64Array(2); ta.set([null]); return "no-throw";`],
    ["bigint 域收 undefined", `const ta = new BigInt64Array(2); ta.set([undefined]); return "no-throw";`],
    ["bigint 域收 symbol", `const ta = new BigInt64Array(2); ta.set([Symbol("x")]); return "no-throw";`],
    ["bigint 域收坏 string → SyntaxError", `const ta = new BigInt64Array(2); ta.set(["abc"]); return "no-throw";`],
  ])("%s", (_name, body) => {
    const name = body.includes("SyntaxError") || body.includes('"abc"') ? "SyntaxError" : "TypeError";
    expectThrows(`export function f() { ${body} }`, name);
    expectCaught(`export function f() { try { ${body}; return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("逐元素转换错误进 throws 域（此前 throws=never 假 total）", () => {
    const r = call(`export function f() { const ta = new Uint8Array(2); ta.set([1n]); return "no-throw"; }`);
    expect(r.result.shape.k).toBe("never");
  });
});

// ---------------------------------------------------------------------------
// 负控制：合法转换（ToBigInt(true) / ToBigInt("2") / ToNumber(null) / …）
// ---------------------------------------------------------------------------

describe("Bug 305 负控制：合法元素转换不回退", () => {
  it.each([
    ["bigint 域收 boolean", `const ta = new BigInt64Array(2); ta.set([true]); return "no-throw";`],
    ["bigint 域收数字字符串", `const ta = new BigInt64Array(2); ta.set(["2"]); return "no-throw";`],
    ["number 域收 null", `const ta = new Uint8Array(2); ta.set([null]); return "no-throw";`],
    ["number 域收 undefined", `const ta = new Uint8Array(2); ta.set([undefined]); return "no-throw";`],
    ["number 域收小数", `const ta = new Uint8Array(2); ta.set([1.5]); return "no-throw";`],
    ["number 域收数字字符串", `const ta = new Uint8Array(2); ta.set(["2"]); return "no-throw";`],
    ["number 域收 boolean", `const ta = new Uint8Array(2); ta.set([true]); return "no-throw";`],
    ["bigint 域收 bigint", `const ta = new BigInt64Array(2); ta.set([1n]); return "no-throw";`],
    ["number 域收 number", `const ta = new Uint8Array(2); ta.set([1]); return "no-throw";`],
  ])("%s → no-throw", (_name, body) => {
    expect(val(`export function f() { ${body} }`)).toEqual({ ok: true, value: "no-throw" });
  });

  it("字符串源：number 域不抛（ToNumber(字符) 恒 NaN→0）", () => {
    expect(val(`export function f() { const ta = new Uint8Array(3); ta.set("abc"); return "no-throw"; }`))
      .toEqual({ ok: true, value: "no-throw" });
  });

  it("越界档优先于元素转换档（原生报错序：u8.set([1n,2n,3n]) → RangeError）", () => {
    expectThrows(
      `export function f() { const ta = new Uint8Array(2); ta.set([1n, 2n, 3n]); return "no-throw"; }`,
      "RangeError",
    );
  });

  it("既有 Bug 38 档不回退：BigInt 家族越界 RangeError / nullish 源 TypeError", () => {
    expectThrows(
      `export function f() { const ta = new BigInt64Array(2); ta.set([1n, 2n, 3n]); return "no-throw"; }`,
      "RangeError",
    );
    expectThrows(
      `export function f() { const ta = new BigUint64Array(2); ta.set(null); return "no-throw"; }`,
      "TypeError",
    );
  });
});

// ---------------------------------------------------------------------------
// 门禁面
// ---------------------------------------------------------------------------

describe("Bug 305 gate 面", () => {
  it("逐元素转换错误进 L2（entry-may-throw 记账）", () => {
    const src = `export function f() { const ta = new Uint8Array(2); ta.set([1n]); return "no-throw"; }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
  });

  it("抽象元素 → may TypeError（不误报定抛）", () => {
    const src = `export function f(x) { const ta = new Uint8Array(2); ta.set([x]); return "no-throw"; }`;
    expect(effects(src)).toContain("TypeError");
  });
});
