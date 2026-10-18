/**
 * Bug 119（静态字段初始化器 super 走实例链）：class-emit 静态字段 thunk 的
 * fieldOpts 只展开 methodOptsBase、不带 staticSuperSrc——super.x 落
 * $getSuper（实例原型链 accessors/methods 表），父类**静态**字段/访问器/
 * 方法全折 exact undefined（算术折 NaN）。静态方法（staticOpts）与静态
 * 访问器（accBodyOpts）都已注入，唯静态字段缺。
 *
 * 修复：静态字段 fieldOpts 补 staticSuperSrc: superSrc（与静态方法/访问器
 * 同口径）。实例字段 opts 不注入——实例 super 合法读原型链（$getSuper
 * 已正确），见 controls。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

const run = (src: string) => litValue(call(src).result);

describe("Bug 119: 静态字段初始化器 super.x 读父类静态面", () => {
  it("static t = super.s → typeof \"number\"（此前 exact \"undefined\"）", () => {
    expect(
      run(`export function f() { class A { static s = 1; } class B extends A { static t = super.s; } return typeof B.t; }`),
    ).toEqual({ ok: true, value: "number" });
  });

  it("static t = super.s + 1 → 2（此前 NaN）；B.t === undefined → false", () => {
    expect(
      run(`export function f() { class A { static s = 1; } class B extends A { static t = super.s + 1; } return B.t; }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      run(`export function f() { class A { static s = 1; } class B extends A { static t = super.s; } return B.t === undefined; }`),
    ).toEqual({ ok: true, value: false });
    expect(
      run(`export function f() { class A { static s = 1; } class B extends A { static t = super.s * 2; } return B.t === 2; }`),
    ).toEqual({ ok: true, value: true });
  });

  it("静态 getter / 静态方法值：super.x / super.m", () => {
    expect(
      run(`export function f() { class A { static get x() { return 3; } } class B extends A { static t = super.x; } return B.t; }`),
    ).toEqual({ ok: true, value: 3 });
    expect(
      run(`export function f() { class A { static m() { return 5; } } class B extends A { static t = typeof super.m; } return B.t; }`),
    ).toEqual({ ok: true, value: "function" });
  });

  it("静态方法调用 super.m()（$staticSuperInvoke 面随 opts 生效）", () => {
    expect(
      run(`export function f() { class A { static m() { return 7; } } class B extends A { static t = super.m() + 1; } return B.t; }`),
    ).toEqual({ ok: true, value: 8 });
  });

  it("三级链：C.u = super.t 沿父类静态面", () => {
    expect(
      run(`export function f() { class A { static s = 1; } class B extends A { static t = super.s; } class C extends B { static u = super.t; } return typeof C.u; }`),
    ).toEqual({ ok: true, value: "number" });
  });
});

describe("Bug 119 controls：既有 super 面不回归", () => {
  it("静态方法体 super.s / super.m()（staticOpts 注入面）", () => {
    expect(
      run(`export function f() { class A { static s = 1; } class B extends A { static t() { return super.s; } } return B.t(); }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      run(`export function f() { class A { static m() { return 7; } } class B extends A { static m() { return super.m() + 1; } } return B.m(); }`),
    ).toEqual({ ok: true, value: 8 });
  });

  it("实例 super（$getSuper 面）：派生 getter 链与实例字段初始化器", () => {
    expect(
      run(`export function f() { class A { get x() { return 3; } } class B extends A { get x() { return super.x + 1; } } return new B().x; }`),
    ).toEqual({ ok: true, value: 4 });
    // 实例字段 opts 未注入 staticSuperSrc：super.x 仍走 $getSuper 实例链
    expect(
      run(`export function f() { class A { get x() { return 3; } } class B extends A { f = super.x; } return new B().f; }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("非 super 静态字段读取不回归", () => {
    expect(
      run(`export function f() { class A { static s = 1; } return A.s; }`),
    ).toEqual({ ok: true, value: 1 });
  });
});
