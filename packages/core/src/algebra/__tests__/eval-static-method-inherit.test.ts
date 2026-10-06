/**
 * Bug 18（运行时内建建模）：空派生类静态方法继承断链——$invoke 类值分支
 * 与 $staticInvoke 只查自有 staticMethods，不沿 superName 链。原生静态
 * 方法挂构造器 [[Prototype]] 链（B.__proto__ = A），`class B extends A {}`
 * 的 B.m() 不断链。
 * 修复：findStaticMethod(startName, method) 沿 superName 链查（与
 * findMethod 实例链同口径），两处共用。
 */
import { describe, it, expect } from "vitest";
import { type Abs, runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, name: string, args: Abs[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, name, args);
}

describe("Bug 18: static methods inherit along the superName chain", () => {
  it("class B extends A {} 的 B.m() → 1", () => {
    const r = call(
      `export function staticInherit() { class A { static m() { return 1; } } class B extends A {} return B.m(); }`,
      "staticInherit",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("三级链 C extends B extends A 的 C.m() → 1", () => {
    const r = call(
      `export function staticInherit3() { class A { static m() { return 1; } } class B extends A {} class C extends B {} return C.m(); }`,
      "staticInherit3",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("自有静态方法不回归：A.m() → 2", () => {
    const r = call(
      `export function staticOwn() { class A { static m() { return 2; } } return A.m(); }`,
      "staticOwn",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("派生类静态覆盖优先：B.m() → 2", () => {
    const r = call(
      `export function staticOverride() { class A { static m() { return 1; } } class B extends A { static m() { return 2; } } return B.m(); }`,
      "staticOverride",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("静态方法读 this（沿链调用派发到定义类，this 是调用类值）", () => {
    const r = call(
      `export function f() { class A { static m() { return 1; } } class B extends A {} return B.m(); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("实例方法继承不回归（findMethod 链）", () => {
    const r = call(
      `export function instInherit() { class A { m() { return 1; } } class B extends A {} return new B().m(); }`,
      "instInherit",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("静态方法内沿链 super 静态调用组合（多级）", () => {
    const r = call(
      `export function f() { class A { static n() { return 10; } } class B extends A { static n() { return super.n() + 5; } } class C extends B {} return C.n(); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 15 });
  });
});
