/**
 * BUG-010 回归：`simplifyTerm` 的 `x - 0 = x` 重写缺 **number 域守卫**
 * （重写规则与自身文档矛盾：`arithmetic/shared.ts` 明写「不用 simplifyTerm：
 * `x*1=x` / `x-0=x` 只对 number 成立」）。
 *
 * 修复前：`simplifyTerm(app("-", [lit("abc"), lit(0)]))` ⇒ `lit("abc")`
 * （原生 `"abc" - 0` 是 **NaN**，且域从 number 变成 string）；
 * `true - 0` ⇒ `lit(true)`（原生是 1）。
 *
 * 修法：与同文件 `surviveMulOne`（`x * 1`）同口径的域守卫——非 number 字面量
 * 走 ToNumber 折值（`"5"→5`、`true→1`、`null→0`、`"abc"/undefined→NaN`），
 * bigint 混型保留原项（原生 TypeError，交算术核 `foldBigintBinOp`）。
 * 非字面量项（var/app）的 `x - 0 → x` 化简保持（number 路径依赖它）。
 */
import { describe, it, expect } from "vitest";
import { app, lit, v as termVar, simplifyTerm, type Term } from "../term.ts";

const sub = (a: Term, b: Term) => app("-", [a, b]);

const isLit = (t: Term, value: unknown): boolean =>
  t.op === "lit" && Object.is(t.value, value);

describe("BUG-010: x - 0 = x 只在 number 域成立", () => {
  it("非 number 字面量不得被认成原字面量（此前 `\"abc\" - 0` ⇒ `\"abc\"`）", () => {
    const r = simplifyTerm(sub(lit("abc"), lit(0)));
    expect(isLit(r, "abc")).toBe(false);
    // ToNumber("abc") = NaN ⇒ number 域
    expect(r.op === "lit" && typeof r.value === "number" && Number.isNaN(r.value)).toBe(true);
  });

  it("boolean / null / 数字字符串走 ToNumber", () => {
    expect(isLit(simplifyTerm(sub(lit(true), lit(0))), 1)).toBe(true);
    expect(isLit(simplifyTerm(sub(lit(false), lit(0))), 0)).toBe(true);
    expect(isLit(simplifyTerm(sub(lit(null), lit(0))), 0)).toBe(true);
    expect(isLit(simplifyTerm(sub(lit("5"), lit(0))), 5)).toBe(true);
    const undef = simplifyTerm(sub(lit(undefined), lit(0)));
    expect(undef.op === "lit" && typeof undef.value === "number" && Number.isNaN(undef.value)).toBe(
      true,
    );
  });

  it("bigint 混型保留原项（原生 TypeError，不得折成字面量）", () => {
    const r = simplifyTerm(sub(lit(5n), lit(0)));
    expect(r.op).toBe("app");
    expect(r.op === "app" && r.fn === "-").toBe(true);
  });

  it("number 字面量仍可化简（`5 - 0` ⇒ 5）", () => {
    expect(isLit(simplifyTerm(sub(lit(5), lit(0))), 5)).toBe(true);
    expect(isLit(simplifyTerm(sub(lit(2.5), lit(1))), 1.5)).toBe(true);
  });

  it("非字面量项保持 number 路径化简（`x - 0` ⇒ x）", () => {
    const x = termVar("x");
    const r = simplifyTerm(sub(x, lit(0)));
    expect(r).toEqual(x);
  });

  it("对照：`x * 1` 的既有域守卫不变（`\"abc\" * 1` ⇒ NaN，不得留 string）", () => {
    const r = simplifyTerm(app("*", [lit("abc"), lit(1)]));
    expect(r.op === "lit" && typeof r.value === "number" && Number.isNaN(r.value)).toBe(true);
    expect(isLit(simplifyTerm(app("*", [lit("abc"), lit(1)])), "abc")).toBe(false);
  });
});
