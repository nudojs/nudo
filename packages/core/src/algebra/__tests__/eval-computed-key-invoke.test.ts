/**
 * 计算键成员调用（obj[key]()，key 是非字面量表达式）——接收者不丢。
 *
 * 修复前 transpile 把 computed 非字面量键 callee 落通用尾部分支
 * $call($idx(obj, key), …)：$call 无接收者通道 → 方法体 this 读失败 /
 * 内建 brand 校验假定抛 → 整调用折 never（差分 FALSE-THROW，三例：
 * "ab"[k]() / [1,2][k]().next().value / obj[key]()）。修复后发射
 * $invokeKey(recv, key, args)：键运行时折叠槽名（ToPropertyKey 字面量 +
 * well-known symbol → "@@name" 投影）后复用 $invoke 既有派发；@@iterator
 * 键对 tuple/arr/字符串接收者折迭代器对象（复用 invokeArrMethod 的
 * values 臂——原生 Array.prototype[Symbol.iterator] === values）。
 *
 * ground truth：node 原生实测（差分 harness 对账）。
 * 回归面：静态键 obj.m() / obj["m"]() / obj[1]()、super.m()/super[k]()、
 * add.bind(x)() 表达式 callee 的发射与结果不变。
 */
import { describe, it, expect } from "vitest";
import { call, val, isNever, throwsError } from "./eval-helpers.ts";
import { abs, type Abs } from "../abs.ts";

const litOf = (src: string): unknown => {
  const r = val(src) as { ok: boolean; value: unknown };
  return r.ok ? r.value : undefined;
};

const resultShapeK = (src: string, args?: Abs[]): string | undefined =>
  (call(src, "f", args)?.result as { shape?: { k?: string } } | undefined)?.shape?.k;

/** 抽象 string 键（path 面，无 term）：键不可折叠 */
const abstractStrKey = (): Abs[] => [
  abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
];

describe("computed-key member invoke keeps the receiver", () => {
  it("obj[key]()：运行时串键方法读到 this（native 7）", () => {
    expect(
      litOf(`export function f() {
  const key = "m";
  const obj = { v: 7, m() { return this.v; } };
  return obj[key]();
}`),
    ).toBe(7);
  });

  it("obj[key]()：函数表达式槽同读 this（native 7）", () => {
    expect(
      litOf(`export function f() {
  const key = "m";
  const obj = { v: 7, m: function () { return this.v; } };
  return obj[key]();
}`),
    ).toBe(7);
  });

  it("类实例计算键方法调用（native 6）", () => {
    expect(
      litOf(`export function f() {
  class C { constructor() { this.v = 6; } m() { return this.v; } }
  const c = new C();
  const key = "m";
  return c[key]();
}`),
    ).toBe(6);
  });

  it("ToPropertyKey 运行时折叠：数字/布尔/nullish 键（native 11/3/5/4）", () => {
    expect(
      litOf(`export function f() {
  const key = 1;
  const obj = { 1() { return 11; } };
  return obj[key]();
}`),
    ).toBe(11);
    expect(
      litOf(`export function f() {
  const key = true;
  const obj = { true() { return 3; } };
  return obj[key]();
}`),
    ).toBe(3);
    expect(
      litOf(`export function f() {
  const key = null;
  const obj = { null() { return 5; } };
  return obj[key]();
}`),
    ).toBe(5);
    expect(
      litOf(`export function f() {
  const key = undefined;
  const obj = { undefined() { return 4; } };
  return obj[key]();
}`),
    ).toBe(4);
  });

  it("闭对象缺失方法名 → definite TypeError（native 同抛）", () => {
    const r = call(`export function f() {
  const key = "nope";
  const obj = { v: 7, m() { return this.v; } };
  return obj[key]();
}`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    // 结果面 never（调用定抛，catch 可吸收）
    expect(isNever(r.result)).toBe(true);
  });

  it("抽象键（path string 形参）→ 诚实 unknown，不折 never", () => {
    const k = resultShapeK(
      `export function f(key) {
  const obj = { m() { return 3; } };
  return obj[key]();
}`,
      abstractStrKey(),
    );
    expect(k).toBe("unknown");
  });

  it(`用户 symbol 键（Symbol("x")）→ 诚实 unknown，不折 never`, () => {
    const k = resultShapeK(`export function f() {
  const s = Symbol("x");
  const o = {};
  o[s] = function () { return 1; };
  return o[s]();
}`);
    expect(k).toBe("unknown");
  });
});

describe("computed-key @@iterator invoke folds the iterator protocol", () => {
  it(`"ab"[k]() 折迭代器：next() 链按序产出（native "a"→"b"→done）`, () => {
    expect(
      litOf(`export function f() {
  const k = Symbol.iterator;
  return "ab"[k]().next().value;
}`),
    ).toBe("a");
    expect(
      litOf(`export function f() {
  const k = Symbol.iterator;
  const it = "ab"[k]();
  it.next();
  return it.next().value;
}`),
    ).toBe("b");
    expect(
      litOf(`export function f() {
  const k = Symbol.iterator;
  const it = "ab"[k]();
  it.next(); it.next();
  const last = it.next();
  return last.done;
}`),
    ).toBe(true);
  });

  it("[1,2][k]().next().value 折 1；推进后第二个 next 折 2（native）", () => {
    expect(
      litOf(`export function f() {
  const k = Symbol.iterator;
  return [1, 2][k]().next().value;
}`),
    ).toBe(1);
    expect(
      litOf(`export function f() {
  const k = Symbol.iterator;
  const it = [1, 2][k]();
  it.next();
  return it.next().value;
}`),
    ).toBe(2);
  });

  it(`迭代器对象可 spread：[..."ab"[k]()] 折字符序（native "ab"）`, () => {
    expect(
      litOf(`export function f() {
  const k = Symbol.iterator;
  return [..."ab"[k]()].join("");
}`),
    ).toBe("ab");
  });

  it(`boxed String 接收者拆箱迭代（native "a"）`, () => {
    expect(
      litOf(`export function f() {
  return new String("ab")[Symbol.iterator]().next().value;
}`),
    ).toBe("a");
  });

  it("生成器对象 @@iterator 自返槽不被迭代器臂劫持（native true）", () => {
    expect(
      litOf(`export function f() {
  function* g() { yield 1; }
  const it = g();
  return it[Symbol.iterator]() === it;
}`),
    ).toBe(true);
  });
});

describe("optional-chain computed-key invoke keeps the receiver", () => {
  it("可选链计算键调用：obj?.[key]() / obj[key]?.() 接收者不丢（native 7/7）", () => {
    expect(
      litOf(`export function f() {
  const key = "m";
  const obj = { v: 7, m() { return this.v; } };
  return obj?.[key]();
}`),
    ).toBe(7);
    expect(
      litOf(`export function f() {
  const key = "m";
  const obj = { v: 7, m() { return this.v; } };
  return obj[key]?.();
}`),
    ).toBe(7);
  });

  it("可选链短路臂折 exact undefined（nullish 接收者 / nullish 方法值）", () => {
    expect(
      litOf(`export function f() {
  const key = "m";
  const o2 = null;
  return o2?.[key]();
}`),
    ).toBe(undefined);
    expect(
      litOf(`export function f() {
  const key = "m";
  const obj = { m: null };
  return obj[key]?.();
}`),
    ).toBe(undefined);
  });

  it("链中缀计算键调用 a.b[key]() / a?.b[key]()（native 8/8）", () => {
    expect(
      litOf(`export function f() {
  const key = "m";
  const a = { b: { v: 8, m() { return this.v; } } };
  return a.b[key]();
}`),
    ).toBe(8);
    expect(
      litOf(`export function f() {
  const key = "m";
  const a = { b: { v: 8, m() { return this.v; } } };
  return a?.b[key]();
}`),
    ).toBe(8);
  });
});

describe("existing invoke branches unchanged (regression)", () => {
  it("静态键 obj.m() / obj[\"m\"]() / obj[1]()（native 7/7/9）", () => {
    expect(litOf(`export function f() {
  const obj = { v: 7, m() { return this.v; } };
  return obj.m();
}`)).toBe(7);
    expect(litOf(`export function f() {
  const obj = { v: 7, m() { return this.v; } };
  return obj["m"]();
}`)).toBe(7);
    expect(litOf(`export function f() {
  const obj = { 1() { return 9; } };
  return obj[1]();
}`)).toBe(9);
  });

  it("super.m() / super[k]() 沿父类链（native 2/2）", () => {
    expect(litOf(`export function f() {
  class A { m() { return 1; } }
  class B extends A { m() { return super.m() + 1; } }
  return new B().m();
}`)).toBe(2);
    expect(litOf(`export function f() {
  class A { m() { return 1; } }
  class B extends A { m() { return super["m"]() + 1; } }
  return new B().m();
}`)).toBe(2);
  });

  it("表达式 callee add.bind(x)() 仍走 $call（native 3）", () => {
    expect(litOf(`export function f() {
  function add(x, y) { return x + y; }
  return add.bind(null, 1)(2);
}`)).toBe(3);
  });

  it("require.resolve 静态折叠不受计算键分支影响", () => {
    expect(litOf(`export function f() { return require.resolve("a"); }`)).toBe("a");
  });
});
