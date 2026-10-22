/**
 * Bug 260：派生类的 `static` 字段**不遮蔽**继承的 `static` 方法
 * → `B.m()` 调到父类方法（原生是 `TypeError: B.m is not a function`）。
 *
 * 根因：`findStaticMethod`（`exec/class/declare.ts`）只查类注册表
 * `spec.staticMethods` 并沿 `superName` 链走，**不看类值 own 槽**——静态
 * 字段 `static m = 2` 落在类值 own 槽里（原生 own 属性优先于
 * [[Prototype]] 链上的继承静态成员），于是被继承的静态方法遮蔽。
 *
 * 修复：每级链先查**类值 own 静态槽**——可调用则调用它；确定非可调用则
 * 原生 `TypeError`；抽象值保守（仍遮蔽继承链）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../../abs.ts";
import { call, isNever, throwsError } from "../../__tests__/eval-helpers.ts";

describe("Bug 260: derived static field shadows inherited static method", () => {
  it("派生类 static 字段遮蔽继承的 static 方法 → 原生 TypeError", () => {
    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m = 2; }
         return B.m();
       }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("三级链同样遮蔽（C extends B extends A）", () => {
    const r = call(
      `export function f() {
         class A { static m() { return 'A'; } }
         class B extends A {}
         class C extends B { static m = 7; }
         return C.m();
       }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("读面不受影响：B.m 仍是 own 静态字段值 2", () => {
    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m = 2; }
         return B.m;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("无自有静态字段时不回归：空派生类继承父类 static 方法", () => {
    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A {}
         return B.m();
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "base" });
  });

  it("自有静态方法覆盖不回归（own static method wins）", () => {
    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m() { return 'own'; } }
         return B.m();
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "own" });
  });

  it("祖先的静态字段同样遮蔽（原生 own 查找序：B.__proto__ = A）", () => {
    const r = call(
      `export function f() {
         class A { static m = 5; }
         class B extends A {}
         return B.m();
       }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("own 静态字段值可调用 → 调用它（this = 类值）", () => {
    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m = () => 'field'; }
         return B.m();
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "field" });
  });

  it("TypeError 可被 try/catch 吸收（原生同口径）", () => {
    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m = 2; }
         try { return String(B.m()); } catch (e) { return 'throw'; }
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "throw" });
  });
});
