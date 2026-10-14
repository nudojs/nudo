/**
 * P2b：类值 .length = 构造器元数（首个默认值（AssignmentPattern）/rest
 * 形参**前**的形参数——Bug 69 nativeParamArity 同口径）。隐式构造器：
 * 基类 `constructor(){}`、派生 `constructor(...args){super(...args)}`——
 * 均 0（原生派生空类不继承父元数）。transpile 期经 spec.ctorLength 通道
 * 记录，$get 类值分支折 exact；自有静态 length 槽/静态访问器优先
 * （原生静态成员初始化覆盖构造器自有 length）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";
import { diffBody } from "./differential/harness.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

function expectNum(src: string, expected: number) {
  expect(v(src)).toEqual({ ok: true, value: expected });
}

describe("P2b: 类值 length = 构造器元数", () => {
  it("constructor(a, b = 1) → 1（默认参截断）", () => {
    expectNum(`export function f() { class C { constructor(a, b = 1) {} } return C.length; }`, 1);
  });

  it("class C {} → 0（隐式基类构造器零参）", () => {
    expectNum(`export function f() { class C {} return C.length; }`, 0);
  });

  it("constructor(...a) → 0（rest 截断）", () => {
    expectNum(`export function f() { class C { constructor(...a) {} } return C.length; }`, 0);
  });

  it("constructor(a, b, c) → 3（全简单形参）", () => {
    expectNum(`export function f() { class C { constructor(a, b, c) {} } return C.length; }`, 3);
  });

  it("constructor(a = 1, b) → 0（首参默认值）", () => {
    expectNum(`export function f() { class C { constructor(a = 1, b) {} } return C.length; }`, 0);
  });

  it("constructor(a, [b]) → 2（无默认值的解构形参计入——与原生 fn.length 同口径）", () => {
    expectNum(`export function f() { class C { constructor(a, [b]) {} } return C.length; }`, 2);
  });
});

describe("P2b: 派生类与隐式构造器", () => {
  it("class B extends A {}（无 ctor）→ 0（隐式派生 ctor 是 (...args) rest 形，非父元数）", () => {
    expectNum(
      `export function f() { class A { constructor(a, b = 1) {} } class B extends A {} return B.length; }`,
      0,
    );
  });

  it("派生类显式 ctor → 自身元数", () => {
    expectNum(
      `export function f() { class A { constructor(a) {} } class B extends A { constructor(a, b, c) { super(a); } } return B.length; }`,
      3,
    );
  });
});

describe("P2b: 静态成员与 length 的优先级", () => {
  it("static length = 5 覆盖构造器自有 length", () => {
    expectNum(
      `export function f() { class C { constructor(a) {} static length = 5; } return C.length; }`,
      5,
    );
  });

  it("静态 getter length 覆盖构造器自有 length", () => {
    expectNum(
      `export function f() { class C { constructor(a) {} static get length() { return 7; } } return C.length; }`,
      7,
    );
  });

  it("实例 getter length 不遮构造器自有 length（getter 挂 .prototype，不在构造器 [[Prototype]] 链）", () => {
    expectNum(
      `export function f() { class C { constructor(a, b) {} get length() { return 99; } } return C.length; }`,
      2,
    );
  });

  it("继承静态字段恰名 length：class B extends A {} B.length → A 的槽值（构造器 [[Prototype]] 链）", () => {
    expectNum(
      `export function f() { class A { static length = 5; } class B extends A {} return B.length; }`,
      5,
    );
  });

  it("静态方法恰名 length：覆盖构造器自有元数，值读折函数可调用", () => {
    expect(
      v(`export function f() { class C { constructor(a) {} static length() { return 3; } } return C.length(); }`),
    ).toEqual({ ok: true, value: 3 });
  });
});

describe("P2b: 类表达式与差分对账", () => {
  it("命名变量绑定的类表达式：const C = class { constructor(a, b = 1){} } → 1", () => {
    expectNum(`export function f() { const C = class { constructor(a, b = 1) {} }; return C.length; }`, 1);
  });

  it("差分：混合元数面板与 native 精确一致", () => {
    expect(
      diffBody(
        `class A { constructor(a, b = 1) {} static m() {} }
         class B extends A {}
         class D { constructor(...a) {} }
         class E {}
         class F { constructor(x, [y]) {} }
         return [A.length, B.length, D.length, E.length, F.length].join(",");`,
      ),
    ).toBeNull();
  });
});
