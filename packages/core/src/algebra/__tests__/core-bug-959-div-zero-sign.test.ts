/**
 * Bug 959 —— `div` 的 `0 / x` 字面量折叠**丢分母符号**。
 *
 * 根因（`arithmetic/muldiv.ts` 的 `div()`，issue #170 的折叠点）：折叠在判
 * 「分母可证非零」（`excludesZero`）后**直接 `return numLit(0)`** ⇒ 把 IEEE
 * 「`0 / x` 取 x 的符号」丢在门外（分母的符号在 `bb.hi.value < 0` 里现成，
 * 却只被用于判非零）⇒ 负分母的 `-0` 被折成 `+0`。
 *
 * 原生 oracle（node 实跑）：`0 / -5` = `-0`（`Object.is(0 / -5, -0)` 为 true）、
 * `1 / (-0)` = `-Infinity`；分母恒正时才是 `+0` / `+Infinity`。
 * 引擎此前两处都标 `conf: exact` ⇒ **错值 + 自信**（dts / guard / standard
 * 三个产物面会把这个符号当真）。
 *
 * 修法：折叠时**分母符号参与折叠** —— 分母恒正（`bb.lo` 严格 > 0）⇒ `+0`；
 * 分母恒负（`bb.hi` 严格 < 0）⇒ `-0`（`lit` 保真负零，term.ts 的 `lit` 不
 * 归一 `-0`）。分母符号不可证（可能正可能负 / 可能为 0）⇒ 不折（保守）。
 *
 * 对照（issue #170 既有口径不得回归）：分母可证非零且非负 ⇒ 仍折 `+0`；
 * 分母可能是 0 ⇒ 不折字面量。
 */
import { describe, it, expect } from "vitest";
import { abs, formatShape, lit, num, v } from "../index.ts";
import { lt, ge, ne, pTrue, and } from "../pred.ts";
import { div, numericBounds } from "../arithmetic.ts";
import { call } from "./eval-helpers.ts";

/** 分母 x：可证 < 0 */
const negX = abs(num().shape, v("x"), lt(v("x"), lit(0)), "path");
/** 分母 x：可证 >= 1（恒正） */
const posX = abs(num().shape, v("x"), ge(v("x"), lit(1)), "path");
/** 分母 x：可证 >= 0 且 ≠ 0（issue #170 的口径） */
const nonNegX = abs(num().shape, v("x"), ge(v("x"), lit(0)), "path");

function lit0() {
  return abs(num().shape, lit(0), undefined, "exact");
}
function lit1() {
  return abs(num().shape, lit(1), undefined, "exact");
}

/** 取字面量值（-0 需按 SameValue 判，不能用 ===） */
function litOf(a: unknown): unknown {
  const t = (a as { term?: { op: string; value?: unknown } }).term;
  return t?.op === "lit" ? t.value : undefined;
}

describe("Bug 959: 0 / x folding keeps the denominator sign", () => {
  it("分母恒负 ⇒ 0 / x 折 -0（原生 0 / -5 = -0）", () => {
    const r = div(lit0(), negX, pTrue, undefined);
    expect(Object.is(litOf(r), -0)).toBe(true);
    expect(formatShape(r)).toBe("-0");
  });

  it("分母恒负 ⇒ 1 / (0 / x) 折 -Infinity（原生 -Infinity）", () => {
    const inner = div(lit0(), negX, pTrue, undefined);
    const r = div(lit1(), inner, pTrue, undefined);
    expect(litOf(r)).toBe(-Infinity);
    expect(formatShape(r)).toBe("-Infinity");
  });

  it("分母恒正 ⇒ 仍折 +0 / +Infinity（原生口径不变）", () => {
    const r = div(lit0(), posX, pTrue, undefined);
    expect(Object.is(litOf(r), 0)).toBe(true);
    expect(formatShape(r)).toBe("0");
    const inner = div(lit0(), posX, pTrue, undefined);
    const recip = div(lit1(), inner, pTrue, undefined);
    expect(litOf(recip)).toBe(Infinity);
  });

  it("分母符号不可证（可能为 0 / 两侧都有界）⇒ 不折字面量（保守）", () => {
    // 分母 x >= 0（可能为 0）⇒ 0/0 = NaN ⇒ 不折
    const ambiguous = div(lit0(), nonNegX, pTrue, undefined);
    expect(litOf(ambiguous)).toBeUndefined();
    // 分母 x ∈ [-5, 5]（符号不可证）⇒ 不折
    const bothSides = abs(
      num().shape,
      v("y"),
      and(ge(v("y"), lit(-5)), lt(v("y"), lit(5))),
      "path",
    );
    const mixed = div(lit0(), bothSides, pTrue, undefined);
    expect(litOf(mixed)).toBeUndefined();
  });

  it("issue #170 既有口径不回归：x >= 0 ∧ x ≠ 0 ⇒ 折 +0 字面量", () => {
    const r = div(lit0(), nonNegX, and(ne(v("x"), lit(0))), undefined);
    expect(litOf(r)).toBe(0);
    expect(Object.is(litOf(r), -0)).toBe(false);
    // 无 ne 事实 ⇒ 不折
    const noNe = div(lit0(), nonNegX, pTrue, undefined);
    expect(litOf(noNe)).toBeUndefined();
  });

  it("numericBounds 的符号侧：x < 0 ⇒ hi 严格 0（分母恒负可判）", () => {
    const b = numericBounds(negX, pTrue);
    expect(b?.hi).toEqual({ value: 0, strict: true });
  });
});

describe("Bug 959 端到端：形参带 x < 0 约束", () => {
  it("0 / x（x < 0）⇒ 引擎折 -0（改前折 +0）", () => {
    const r = call(`export function f(x) { return 0 / x; }`, "f", [negX]);
    expect(formatShape(r.result)).toBe("-0");
  });

  it("1 / (0 / x)（x < 0）⇒ 引擎折 -Infinity（改前折 +Infinity）", () => {
    const r = call(`export function f(x) { return 1 / (0 / x); }`, "f", [negX]);
    expect(formatShape(r.result)).toBe("-Infinity");
  });

  it("分母恒正 ⇒ 端到端仍是 +0 / +Infinity", () => {
    const r = call(`export function f(x) { return 0 / x; }`, "f", [posX]);
    expect(formatShape(r.result)).toBe("0");
    const recip = call(`export function f(x) { return 1 / (0 / x); }`, "f", [posX]);
    expect(formatShape(recip.result)).toBe("Infinity");
  });
});
