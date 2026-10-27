/**
 * Bug 244：原型 / 实例上的方法**写**（monkey-patch）被派发面忽略。
 *
 * 原生属性查找序 own → prototype：`A.prototype.m = fn`（写原型对象的自有
 * 属性）、`a.m = fn` / `this.m = fn`（写实例的自有属性）都**遮住**类注册表
 * 里的方法体 ⇒ `new A().m()` 跑的是用户写的函数。
 *
 * 引擎此前：写侧（$set / this 成员写 / defineProperty）把值落进 brand 内层 obj
 * 槽面（读面 chainProtoSlotOf 看得见），但**派发面只查注册表** ⇒ monkey-patch
 * 全部静默失效（跑的还是旧方法体）；写成非函数时也**不抛** TypeError。
 *
 * 钉：改前 engine=1 / native=2、3、5、4（全部 MISMATCH）+ 非函数写不抛。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError } from "../../__tests__/eval-helpers.ts";
import { litValue } from "../../abs.ts";
import { diffBody } from "../../__tests__/differential/harness.ts";

/** 断言结果折成具体字面量并值相等 */
function expectLit(src: string, expected: unknown) {
  const r = litValue(call(src, "f").result);
  if (!r.ok) {
    throw new Error(
      `expected literal ${String(expected)}, got non-literal result (domain / unknown)`,
    );
  }
  expect(r.value).toEqual(expected);
}

/** 断言调用定抛 TypeError（结果 never + throws 面是 TypeError） */
function expectTypeError(src: string) {
  const rec = call(src, "f");
  expect(isNever(rec.result)).toBe(true);
  expect(throwsError(rec.throws, "TypeError")).toBe(true);
}

describe("Bug 244: 原型 / 实例上的方法写参与派发（monkey-patch 生效）", () => {
  it("A.prototype.m = fn ⇒ new A().m() 跑用户函数（native 2）", () => {
    expectLit(
      `export function f() { class A244a { m(){ return 1; } } A244a.prototype.m = function(){ return 2; }; return new A244a().m(); }`,
      2,
    );
  });

  it("a.m = fn ⇒ a.m() 跑用户函数（native 5）", () => {
    expectLit(
      `export function f() { class A244b { m(){ return 1; } } const a = new A244b(); a.m = function(){ return 5; }; return a.m(); }`,
      5,
    );
  });

  it("ctor 内 this.m = fn ⇒ new A().m() 跑用户函数（native 3）", () => {
    expectLit(
      `export function f() { class A244c { constructor(){ this.m = function(){ return 3; }; } m(){ return 1; } } return new A244c().m(); }`,
      3,
    );
  });

  it("A.prototype.m = 5 ⇒ 调用定抛 TypeError（native: not a function）", () => {
    expectTypeError(
      `export function f() { class A244d { m(){ return 1; } } A244d.prototype.m = 5; return new A244d().m(); }`,
    );
  });

  it("Object.defineProperty(A.prototype,'m',{value:fn}) ⇒ 跑用户函数（native 4）", () => {
    expectLit(
      `export function f() { class A244e { m(){ return 1; } } Object.defineProperty(A244e.prototype, "m", { value: function(){ return 4; } }); return new A244e().m(); }`,
      4,
    );
  });

  it("实例自有槽遮住原型上的写（native 6）", () => {
    expectLit(
      `export function f() { class A244h { m(){ return 1; } } const a = new A244h(); a.m = function(){ return 6; }; A244h.prototype.m = function(){ return 2; }; return a.m(); }`,
      6,
    );
  });

  it("control：未打补丁 ⇒ 仍走注册表方法体（native 1）", () => {
    expectLit(`export function f() { class A244f { m(){ return 1; } } return new A244f().m(); }`, 1);
  });

  it("control：原型上新名字（注册表无此名）⇒ 走写面（native 7）", () => {
    expectLit(
      `export function f() { class A244g { } A244g.prototype.n = function(){ return 7; }; return new A244g().n(); }`,
      7,
    );
  });

  it("差分对账（native oracle）：改前 MISMATCH / 改后一致", () => {
    expect(
      diffBody(
        `class A244d1 { m(){ return 1; } } A244d1.prototype.m = function(){ return 2; }; return new A244d1().m();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A244d2 { m(){ return 1; } } const a = new A244d2(); a.m = function(){ return 5; }; return a.m();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A244d3 { constructor(){ this.m = function(){ return 3; }; } m(){ return 1; } } return new A244d3().m();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A244d4 { m(){ return 1; } } A244d4.prototype.m = 5; return new A244d4().m();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A244d5 { m(){ return 1; } } Object.defineProperty(A244d5.prototype, "m", { value: function(){ return 4; } }); return new A244d5().m();`,
      ),
    ).toBeNull();
  });
});
