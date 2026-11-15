/**
 * Bug 272：类值（class 声明 / 类表达式）**不带 new** 被调 —— 原生定抛
 * TypeError（"Class constructor A cannot be invoked without 'new'"）。
 * 类值只有 [[Construct]] 面：被当普通函数调即抛。
 *
 * 修复（packages/core/src/algebra/exec/call.ts）：
 * - `$callDispatch` 在可调用判定表之前加类值判定（isClassValueCallee）：
 *   brand 形（类值 brand 带 `ctor: true` facet + class-mark 类值标记）
 *   与 fn 形（空类体类表达式快路径 `$classExpr` 的签名）⇒ hard NudoThrow。
 *
 * 修复前：类值不在可调用判定表内 ⇒ 落 `return unknown` 且**不记 may-throw**
 * ⇒ 声称「永不抛」⇒ L2 `nudo:entry-may-throw` 假绿（漏报 TypeError）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 272: 类值不带 new 被调 → TypeError", () => {
  it("class 声明被调 → throws TypeError（此前 unknown + never）", () => {
    const r = call(
      `class A {}
export function f() {
  return A();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("class 声明被调（try/catch 吸收）→ catch 命中 TypeError", () => {
    expect(
      v(`class A {}
export function f() {
  try { A(); return "nothrow"; } catch (e) { return "threw:" + e.name; }
}`),
    ).toEqual({ ok: true, value: "threw:TypeError" });
  });

  it("非空类表达式被调 → throws TypeError", () => {
    const r = call(
      `const A = class { m() { return 1; } };
export function f() {
  return A();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("空类体类表达式被调（$classExpr 快路径）→ throws TypeError", () => {
    const r = call(
      `const A = class {};
export function f() {
  return A();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("控制组：new A() 正常构造；静态方法调用正常；普通函数调用正常", () => {
    expect(
      v(`class A { constructor() { this.x = 1; } }
export function f() {
  const a = new A();
  return a.x;
}`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      v(`class A { static s() { return 7; } }
export function f() {
  return A.s();
}`),
    ).toEqual({ ok: true, value: 7 });
    expect(
      v(`function g() { return 3; }
export function f() {
  return g();
}`),
    ).toEqual({ ok: true, value: 3 });
  });
});
