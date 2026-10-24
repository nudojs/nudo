/**
 * Bug 1035：类值接收者（`A.m()`）的方法派发**先查实例方法表** ⇒ 跑错方法
 * 体、抛错方向**双向反转** ⇒ L2 门禁既**假绿**又**假红**。
 *
 * 原生：类值是构造器函数，`A.m` 沿构造器 [[Prototype]] 链解析（= 静态方法
 * 面）；**实例方法面不在其链上**（实例方法挂 A.prototype）⇒
 * - 同名 static + 实例方法并存 ⇒ `A.m()` 跑**静态**体；
 * - 类值上无该静态成员 ⇒ `A.m is not a function` **定抛 TypeError**。
 *
 * 引擎此前：先查实例方法表 ⇒ `A.m()` 跑实例体（"I"）；类值上无静态成员时
 * 也跑实例体（不抛）。
 *
 * 钉：改前 engine="I" / native="S"（MISMATCH）；类值上无静态成员时
 * engine="I" / native=THROW（MISMATCH）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError } from "../../__tests__/eval-helpers.ts";
import { litValue } from "../../abs.ts";
import { diffBody } from "../../__tests__/differential/harness.ts";

function expectLit(src: string, expected: unknown) {
  const r = litValue(call(src, "f").result);
  if (!r.ok) {
    throw new Error(
      `expected literal ${String(expected)}, got non-literal result (domain / unknown)`,
    );
  }
  expect(r.value).toEqual(expected);
}

function expectTypeError(src: string) {
  const rec = call(src, "f");
  expect(isNever(rec.result)).toBe(true);
  expect(throwsError(rec.throws, "TypeError")).toBe(true);
}

describe("Bug 1035: 类值接收者的派发先查静态面", () => {
  it("同名 static + 实例方法并存 ⇒ A.m() 跑静态体（native \"S\"）", () => {
    expectLit(
      `export function f() { class A1035a { m(){ return "I"; } static m(){ return "S"; } } return A1035a.m(); }`,
      "S",
    );
  });

  it("类值上无该静态成员 ⇒ 定抛 TypeError（native: A.m is not a function）", () => {
    expectTypeError(
      `export function f() { class A1035d { m(){ return "I"; } } return A1035d.m(); }`,
    );
  });

  it("control：实例接收者仍跑实例体（native \"I\"）", () => {
    expectLit(
      `export function f() { class A1035b { m(){ return "I"; } } return new A1035b().m(); }`,
      "I",
    );
  });

  it("control：只有静态方法 ⇒ A.m() 跑静态体（native \"S\"）", () => {
    expectLit(
      `export function f() { class A1035c { static m(){ return "S"; } } return A1035c.m(); }`,
      "S",
    );
  });

  it("control：静态方法沿构造器继承链（B extends A ⇒ B.m() → \"S\"）", () => {
    expectLit(
      `export function f() { class A1035f { static m(){ return "S"; } } class B1035f extends A1035f { } return B1035f.m(); }`,
      "S",
    );
  });

  it("差分对账（native oracle）：改前 MISMATCH / 改后一致", () => {
    expect(
      diffBody(
        `class A1035a { m(){ return "I"; } static m(){ return "S"; } } return A1035a.m();`,
      ),
    ).toBeNull();
    expect(diffBody(`class A1035d { m(){ return "I"; } } return A1035d.m();`)).toBeNull();
  });
});
