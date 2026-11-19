/**
 * BUG-188：`X.prototype` 的身份是**绑定**而不是名字。
 *
 * 原生每次类 / 函数定义求值各建一个 prototype 对象：两个同名但不同绑定
 * 的类（不同作用域 / 模块）的 `A.prototype` 是两个不同对象；
 * `A.prototype.m = fn` 只写自己那份。此前引擎按裸名驻留原型（
 * protoBrandByName）⇒ 一个绑定的原型写泄漏到另一个绑定的实例读取面 ⇒
 * 原生必抛 TypeError 的调用折成 total（L2 门禁假绿 + 自信错值）。
 *
 * 本文件钉：同一绑定恒等不变（两次读 ===、gPo(实例) === X.prototype），
 * 同名不同绑定互不可见（类与 function 声明两种形态）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError, val } from "./eval-helpers.ts";

describe("X.prototype 按绑定驻留（同名不同绑定互不可见）", () => {
  it("BUG-188 同名 class 分处两个作用域：一处写 prototype.m，另一处的 new 读取抛 TypeError", () => {
    const r = call(`export function f() {
      function setup() { class A {} A.prototype.m = function () { return 1; }; return 1; }
      function caller() { class A {} return new A().m(); }
      setup();
      return caller();
    }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(isNever(r.result)).toBe(true);
  });

  it("BUG-188 同名 class 各自写自己的 prototype：各自读到自己的值（互不覆盖）", () => {
    const r = call(`export function f() {
      function setup() { class A {} A.prototype.m = function () { return 1; }; return 1; }
      function caller() { class A {} A.prototype.m = function () { return 2; }; return new A().m(); }
      setup();
      return caller();
    }`);
    expect(val(`export function f() {
      function setup() { class A {} A.prototype.m = function () { return 1; }; return 1; }
      function caller() { class A {} A.prototype.m = function () { return 2; }; return new A().m(); }
      setup();
      return caller();
    }`)).toEqual({ ok: true, value: 2 });
  });

  it("BUG-188 同一绑定恒等：A.prototype === A.prototype 且 gPo(new A()) === A.prototype", () => {
    expect(val(`export function f() { class A {} return A.prototype === A.prototype; }`)).toEqual({
      ok: true,
      value: true,
    });
    expect(
      val(`export function f() { class A {} return Object.getPrototypeOf(new A()) === A.prototype; }`),
    ).toEqual({ ok: true, value: true });
  });

  it("BUG-188 函数声明形态：同名 function 的 prototype 写不跨绑定泄漏", () => {
    const r = call(`export function f() {
      function setup() { function A() {} A.prototype.m = function () { return "fn"; }; return 1; }
      function caller() { function A() {} return new A().m(); }
      setup();
      return caller();
    }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(isNever(r.result)).toBe(true);
  });

  it("BUG-188 函数声明同一绑定仍然共享：F.prototype.m 写后 new F().m() 读到函数", () => {
    const r = call(`export function f() {
      function F() {}
      F.prototype.m = function () { return 3; };
      return new F().m();
    }`);
    expect(val(`export function f() {
      function F() {}
      F.prototype.m = function () { return 3; };
      return new F().m();
    }`)).toEqual({ ok: true, value: 3 });
  });
});
