/**
 * Bug 200 回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。
 *
 * ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举
 * 属性，再沿**原型链**向上继续（同名键不重复）。class / function 的实例的
 * 原型链上有 `prototype.b = 2` 这类可枚举属性 ⇒ 原生 `for..in` 能看到它们。
 *
 * 修复前：引擎的 `for..in`（brand 接收者）只枚举**实例自身**槽 ⇒ 原型上的
 * 可枚举键**丢失**（wrong-exact）：`for (const x in new A())` 原生 `"ab"`，
 * 引擎 `"a"`。
 *
 * 负控制：原型上的**方法**（class 方法是非可枚举的）不出现在 `for..in`；
 * 普通对象的 `for..in` 不变；`Object.keys` 仍只给自有可枚举键。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

describe("Bug 200：for..in 遍历 brand 实例沿原型链枚举可枚举键", () => {
  it("class 实例：原型上的可枚举属性被枚举", () => {
    expect(
      val(`export function f() {
        class A200t1 { constructor() { this.a = 1; } }
        A200t1.prototype.b = 2;
        let k = "";
        for (const x in new A200t1()) k += x;
        return k;
      }`),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("class 实例：for..in 的枚举个数包含原型键", () => {
    expect(
      val(`export function f() {
        class A200t2 { constructor() { this.a = 1; } }
        A200t2.prototype.b = 2;
        let n = 0;
        for (const x in new A200t2()) n++;
        return n;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("function 原型：原型上的可枚举属性被枚举", () => {
    expect(
      val(`export function f() {
        function F() { this.a = 1; }
        F.prototype.b = 2;
        let n = 0;
        for (const x in new F()) n++;
        return n;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("派生类：整条原型链的可枚举键都被枚举", () => {
    expect(
      val(`export function f() {
        class A200t4 { constructor() { this.a = 1; } }
        class B200t4 extends A200t4 { constructor() { super(); this.b = 2; } }
        A200t4.prototype.p = 9;
        let k = "";
        for (const x in new B200t4()) k += x;
        return k;
      }`),
    ).toEqual({ ok: true, value: "abp" });
  });

  it("派生类：原型上的方法（class 方法非可枚举）不出现", () => {
    expect(
      val(`export function f() {
        class A200t5 { constructor() { this.a = 1; } }
        class B200t5 extends A200t5 { m() {} constructor() { super(); this.b = 2; } }
        let k = "";
        for (const x in new B200t5()) k += x;
        return k;
      }`),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("原型键被覆写后仍只枚举一次", () => {
    expect(
      val(`export function f() {
        class A200t6 { constructor() { this.a = 1; } }
        A200t6.prototype.b = 2;
        A200t6.prototype.b = 3;
        let k = "";
        for (const x in new A200t6()) k += x;
        return k;
      }`),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("负控制：class 方法非可枚举 ⇒ 不出现在 for..in", () => {
    expect(
      val(`export function f() {
        class A200t7 { m() {} constructor() { this.a = 1; } }
        let n = 0;
        for (const x in new A200t7()) n++;
        return n;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：普通对象的 for..in 不变", () => {
    expect(val(`export function f() { const o = { a: 1, b: 2 }; let k = ""; for (const x in o) k += x; return k; }`)).toEqual({
      ok: true,
      value: "ab",
    });
  });

  it("负控制：Object.keys 仍只给自有可枚举键（原型键不混入）", () => {
    expect(
      val(`export function f() {
        class A200t9 { constructor() { this.a = 1; } }
        A200t9.prototype.b = 2;
        return Object.keys(new A200t9()).join(",");
      }`),
    ).toEqual({ ok: true, value: "a" });
  });

  it("负控制：原型上的属性读取仍正常", () => {
    expect(
      val(`export function f() {
        class A200t10 { constructor() { this.a = 1; } }
        A200t10.prototype.b = 2;
        return String(new A200t10().b);
      }`),
    ).toEqual({ ok: true, value: "2" });
  });
});
