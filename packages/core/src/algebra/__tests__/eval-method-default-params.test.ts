/**
 * N3：方法形参默认值绑定（含 this 引用）。修复前 paramsOf/methodBindNames
 * 只发标识符左名——默认值表达式被静默丢弃：类方法非标识符形参无名可绑
 *（体引用成自由标识符折 never），对象方法默认值不求值（缺参折 undefined
 * 而非默认值）。修复：非简单形参（默认值/解构/rest）与读 arguments 的
 * 方法同走 `...__margs` + emitParamBindingFromArgs 统一绑定，默认表达式
 * 以方法边界 opts 求值（__this 在作用域内——实例 receiver / R5 静态类值，
 * 与原生默认参以调用点 this 求值一致）。连带：$arrRest 读 $arguments 的
 * Arguments brand 槽此前折 unknown（rest 形参丢精度），setter 形参默认值/
 * 解构此前同样丢弃。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, tupleEls } from "./eval-helpers.ts";

function v(src: string): unknown {
  return litValue(call(src, "f").result);
}

describe("N3: 类方法默认参引用 this", () => {
  it("instance 方法：m(a = this.v) 缺参折默认值", () => {
    expect(
      v(`export function f() {
        class C { constructor() { this.v = 7; } m(a = this.v) { return a; } }
        return new C().m();
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("instance 方法：显式实参覆盖默认值；显式 undefined 仍取默认", () => {
    expect(
      v(`export function f() {
        class C { constructor() { this.v = 7; } m(a = this.v) { return a; } }
        return new C().m(5);
      }`),
    ).toEqual({ ok: true, value: 5 });
    expect(
      v(`export function f() {
        class C { constructor() { this.v = 7; } m(a = this.v) { return a; } }
        return new C().m(undefined);
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("static 方法：this = 类值（R5 __this 通道进默认参）", () => {
    expect(
      v(`export function f() {
        class C { static n = 5; static m(a = this.n) { return a; } }
        return C.m();
      }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("默认参内箭头词法捕获 this", () => {
    expect(
      v(`export function f() {
        class C { constructor() { this.v = 7; } m(a = (() => this.v)()) { return a; } }
        return new C().m();
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("解构默认参 m({x = this.v} = {})", () => {
    expect(
      v(`export function f() {
        class C { constructor() { this.v = 7; } m({x = this.v} = {}) { return x; } }
        return new C().m();
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("默认参可读前参 + rest 形参经 $arguments 槽绑定（Arguments brand 委托）", () => {
    expect(
      v(`export function f() {
        class C { m(a = 2, b = a * 3, ...r) { return [a, b, r.length]; } }
        return new C().m(undefined, undefined, 8, 9).join(",");
      }`),
    ).toEqual({ ok: true, value: "2,6,2" });
  });

  it("私有方法 / generator 方法 / 派生类方法默认参", () => {
    expect(
      v(`export function f() {
        class C { constructor() { this.v = 7; } #p(a = this.v) { return a; } m() { return this.#p(); } }
        return new C().m();
      }`),
    ).toEqual({ ok: true, value: 7 });
    expect(
      v(`export function f() {
        class C { constructor() { this.v = 7; } *g(a = this.v) { yield a; } }
        return new C().g().next().value;
      }`),
    ).toEqual({ ok: true, value: 7 });
    expect(
      v(`export function f() {
        class A { constructor() { this.v = 6; } }
        class B extends A { m(a = this.v) { return a; } }
        return new B().m();
      }`),
    ).toEqual({ ok: true, value: 6 });
  });

  it("默认参读 arguments（mHasArgs 既有路径保持）", () => {
    expect(
      v(`export function f() {
        class C { m(a = arguments.length) { return a; } }
        return new C().m(1, 2, 3);
      }`),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("N3: 对象字面量方法默认参", () => {
  it("方法简写：({ v: 7, m(a = this.v) }).m() → 7", () => {
    expect(
      v(`export function f() {
        const o = ({ v: 7, m(a = this.v) { return a; } });
        return o.m();
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("方法型 FunctionExpression：({ m: function(a = this.v) {} }).m()", () => {
    expect(
      v(`export function f() {
        const o = ({ v: 7, m: function (a = this.v) { return a; } });
        return o.m();
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("计算键方法 + rest 形参折精确元组（$arrRest 委托 Arguments brand）", () => {
    expect(
      v(`export function f() {
        const k = "m";
        const o = ({ v: 7, [k](a = this.v, ...r) { return r.length; } });
        return o.m(undefined, 8, 9);
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("fn.length 通道不回归（$fnVal length: nativeParamArity）", () => {
    expect(v(`export function f() { return ({ m(a = 1) {} }).m.length; }`)).toEqual({ ok: true, value: 0 });
    expect(v(`export function f() { return ({ m(a, b = 1) {} }).m.length; }`)).toEqual({ ok: true, value: 1 });
  });
});

describe("N3: setter 形参默认值 / 解构（赋 undefined 触发默认值）", () => {
  it("对象 setter：o.s = undefined → 默认 this.v", () => {
    expect(
      v(`export function f() {
        const o = ({ v: 7, set s(a = this.v) { this.w = a; } });
        o.s = undefined;
        return o.w;
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("对象 setter 解构形参：o.s = {x:9} → 绑 x（此前自由标识符折 never）", () => {
    expect(
      v(`export function f() {
        const o = ({ set s({ x }) { this.w = x; } });
        o.s = { x: 9 };
        return o.w;
      }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("类 setter 默认参 + 继承赋值路径", () => {
    expect(
      v(`export function f() {
        class C { constructor() { this.v = 7; } set s(a = this.v) { this.w = a; } }
        const c = new C();
        c.s = undefined;
        return c.w;
      }`),
    ).toEqual({ ok: true, value: 7 });
    expect(
      v(`export function f() {
        class A { set s(a = 42) { this.w = a; } }
        class B extends A {}
        const b = new B();
        b.s = undefined;
        return b.w;
      }`),
    ).toEqual({ ok: true, value: 42 });
  });
});

describe("N3: 控制组（无 this 默认参 / 简单形参路径零回归）", () => {
  it("简单形参方法（全 Identifier）仍走宿主直绑 + $absVal 归一", () => {
    expect(
      v(`export function f() {
        class C { m(a, b) { return a + b; } }
        return new C().m(3, 4);
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("无 this 默认参（纯字面量）", () => {
    expect(
      v(`export function f() {
        class C { m(a = 3) { return a; } }
        return new C().m();
      }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("默认参副作用写 receiver 透传", () => {
    const els = tupleEls(
      call(`export function f() {
        class C { constructor() { this.n = 0; } m(a = (this.n = this.n + 1, this.n)) { return a; } }
        const c = new C();
        return [c.m(), c.n];
      }`).result,
    );
    expect(els).toEqual([1, 1]);
  });

  it("缺参默认表达式抛错保持（(null).x 定抛）", () => {
    const r = call(`export function f() {
      class C { m(a = (null).x) { return 1; } }
      return new C().m();
    }`);
    expect(r.result.shape.k).toBe("never");
  });
});
