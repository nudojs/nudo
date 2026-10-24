/**
 * Bug 181 回归：转译器的**解构临时名**（`_d0` / `_n1` / `_p0` / `_rest0`）
 * 必须与**用户标识符**避让。
 *
 * 修复前：临时名不带任何避让——用户自己声明同名标识符时，生成码出现
 * `const _d0`（用户已有 `let _d0`）⇒ **重复声明 SyntaxError** ⇒ 整个模块
 * 求值失败 ⇒ 全模块导出退化为 unknown（假 opaque-result）；另一面，函数体里
 * 的 `const _d0` 会**遮蔽**模块级同名绑定 ⇒ 用户读到错值。
 *
 * 修复后：临时名避开用户已占用的标识符（源文本里出现过的标识符词形，保守
 * 超集）；模块可正常求值，用户绑定读回真值。
 */
import { describe, it, expect } from "vitest";
import { val, callLit } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

/** 带实参调用 f 的字面量结果 */
const v = (src: string, ...args: unknown[]): { ok: boolean; value?: unknown } =>
  litValue(callLit(src, "f", ...args).result) as { ok: boolean; value?: unknown };

describe("Bug 181：解构临时名与用户标识符避让", () => {
  it("用户声明 _d0：模块仍可求值（不再重复声明 SyntaxError）", () => {
    expect(
      val(`export function f() { let _d0 = 5; const { a } = { a: 1 }; return a + _d0; }`),
    ).toEqual({ ok: true, value: 6 });
  });

  it("用户声明 _n1（嵌套解构临时名）：模块仍可求值", () => {
    expect(
      val(`export function f() { let _n1 = 5; const { a: { b } } = { a: { b: 1 } }; return b + _n1; }`),
    ).toEqual({ ok: true, value: 6 });
  });

  it("用户声明 _p0（形参占位名）：模块仍可求值", () => {
    expect(
      v(`export function f({ a }) { let _p0 = 5; return a + _p0; }`, { a: 1 }),
    ).toEqual({ ok: true, value: 6 });
  });

  it("用户声明 _rest0（rest 形参占位名）：模块仍可求值", () => {
    expect(
      v(`export function f([...xs]) { let _rest0 = 5; return xs.length + _rest0; }`, [1, 2]),
    ).toEqual({ ok: true, value: 7 });
  });

  it("用户声明 _pd0（默认参解构临时名）：模块仍可求值", () => {
    expect(
      v(`export function f({ a } = { a: 1 }) { let _pd0 = 5; return a + _pd0; }`, undefined),
    ).toEqual({ ok: true, value: 6 });
  });

  it("负控制：无撞名时解构行为不变（精确值）", () => {
    expect(val(`export function f() { const { a } = { a: 1 }; return a; }`))
      .toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const [a, b] = [1, 2]; return a + b; }`))
      .toEqual({ ok: true, value: 3 });
    expect(v(`export function f({ a }) { return a; }`, { a: 1 }))
      .toEqual({ ok: true, value: 1 });
  });
});
