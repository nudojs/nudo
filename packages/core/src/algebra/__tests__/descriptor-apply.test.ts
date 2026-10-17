/**
 * Bug 84/86/117/118 回归：Object.defineProperty / defineProperties 描述符
 * 安装机器（descriptor.ts applyPropertyDescriptor + methods.ts 键投影）。
 *
 * - Bug 84：accessor→data 机制变化——旧 getter/setter 随键从侧表删除
 *   （成员读不再折旧 getter 值）、已有 flags 作基底合并（accessor 安装期
 *   的 enumerable:false 不被抹掉）、机制变化 writable 缺省 false、
 *   unconfigurable 属性改机制原生定抛 TypeError。
 * - Bug 86：tuple 接收者不再静默丢弃——下标键逐位装（增长段 hole、空
 *   描述符清 hole）、length 截断/延长、enumerable:false 下标从枚举视图
 *   剔除、frozen/sealed 语义。
 * - Bug 117：键走 ToPropertyKey 投影（bool/null/undefined/缺省 → 字符串
 *   键；well-known symbol → "@@X" 投影槽 + symbolKey 标记，读路径同键；
 *   Object.keys 不泄漏投影槽）。
 * - Bug 118：descriptor value 直取槽中 Abs 落槽（fn/obj/tuple/bigint/
 *   symbol/null 值不再经 litValue 往返丢失）。
 */
import { describe, it, expect } from "vitest";
import { val, call, throwsError, objSlots } from "./eval-helpers.ts";

describe("Bug 84: accessor→data redefinition drops the stale accessor", () => {
  it("member read returns the new data value, not the old getter", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "x", { get() { return 3; }, configurable: true }); Object.defineProperty(o, "x", { value: 2 }); return o.x; }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      val(`export function f() { const o = {}; Reflect.defineProperty(o, "x", { get() { return 3; }, configurable: true }); Reflect.defineProperty(o, "x", { value: 4 }); return o.x; }`),
    ).toEqual({ ok: true, value: 4 });
  });

  it("enumerable flags survive partial redefine (accessor install keeps enumerable:false)", () => {
    // accessor 安装期 enumerable 缺省 false → 数据重定义沿 current → keys 不含
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "x", { get() { return 3; }, configurable: true }); Object.defineProperty(o, "x", { value: 2 }); return Object.keys(o).length; }`),
    ).toEqual({ ok: true, value: 0 });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "x", { get() { return 3; }, configurable: true, enumerable: true }); Object.defineProperty(o, "x", { value: 2 }); return Object.keys(o).join(","); }`),
    ).toEqual({ ok: true, value: "x" });
  });

  it("mechanism change defaults writable to false (spec 6.b)", () => {
    expect(
      objSlots(call(`export function f() { const o = {}; Object.defineProperty(o, "x", { get() { return 3; }, configurable: true }); Object.defineProperty(o, "x", { value: 2 }); return Object.getOwnPropertyDescriptor(o, "x"); }`).result),
    ).toMatchObject({ value: 2, writable: false });
  });

  it("unconfigurable property cannot change access mechanism (native TypeError)", () => {
    const r = call(`export function f() { const o = {}; Object.defineProperty(o, "x", { value: 1 }); Object.defineProperty(o, "x", { get() { return 7; } }); return 0; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("control: accessor→accessor partial redefine keeps dispatch", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "x", { get() { return 3; }, configurable: true }); Object.defineProperty(o, "x", { get() { return 9; }, configurable: true }); return o.x; }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("control: plain data redefine keeps the previous value on partial descriptor", () => {
    expect(
      val(`export function f() { const o = { x: 1 }; Object.defineProperty(o, "x", { writable: false }); return o.x; }`),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 86: defineProperty on tuple receivers installs", () => {
  it("index define lands in the element", () => {
    expect(
      val(`export function f() { const a = [1]; Object.defineProperty(a, "0", { value: 8 }); return a[0]; }`),
    ).toEqual({ ok: true, value: 8 });
    expect(
      val(`export function f() { const a = [1, 2]; Object.defineProperty(a, "1", { value: 9 }); return a[1]; }`),
    ).toEqual({ ok: true, value: 9 });
    expect(
      val(`export function f() { const a = [1, 2]; Object.defineProperty(a, "1", { value: 9 }); return Object.entries(a).map((e) => e[1]).join(","); }`),
    ).toEqual({ ok: true, value: "1,9" });
  });

  it("growth beyond length leaves holes; empty descriptor un-holes", () => {
    expect(
      val(`export function f() { const a = [1]; Object.defineProperty(a, "3", { value: 9 }); return a.join(","); }`),
    ).toEqual({ ok: true, value: "1,,,9" });
    expect(
      val(`export function f() { const a = []; Object.defineProperty(a, "0", {}); return 0 in a; }`),
    ).toEqual({ ok: true, value: true });
  });

  it("length define truncates / extends with holes", () => {
    expect(
      val(`export function f() { const a = [1, 2, 3]; Object.defineProperty(a, "length", { value: 1 }); return a.join(","); }`),
    ).toEqual({ ok: true, value: "1" });
    expect(
      val(`export function f() { const a = [1]; Object.defineProperty(a, "length", { value: 3 }); return a.join(","); }`),
    ).toEqual({ ok: true, value: "1,," });
    const bad = call(`export function f() { const a = [1]; Object.defineProperty(a, "length", { value: 0.5 }); return 0; }`);
    expect(throwsError(bad.throws, "RangeError")).toBe(true);
  });

  it("enumerable:false index keys leave the enumeration view", () => {
    expect(
      val(`export function f() { const a = [1, 2]; Object.defineProperty(a, "0", { value: 1, enumerable: false }); return Object.keys(a).join(","); }`),
    ).toEqual({ ok: true, value: "1" });
  });

  it("frozen: identical redefine passes, different value throws", () => {
    expect(
      val(`export function f() { const a = [1]; Object.freeze(a); Object.defineProperty(a, "0", { value: 1 }); return a[0]; }`),
    ).toEqual({ ok: true, value: 1 });
    const r = call(`export function f() { const a = [1]; Object.freeze(a); Object.defineProperty(a, "0", { value: 2 }); return 0; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("sealed: new index throws, in-bounds write passes", () => {
    const r = call(`export function f() { const a = []; Object.seal(a); Object.defineProperty(a, "0", { value: 1 }); return 0; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(
      val(`export function f() { const a = [1]; Object.seal(a); Object.defineProperty(a, "0", { value: 5 }); return a[0]; }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("length writable:false blocks push (sealed approximation)", () => {
    const r = call(`export function f() { const a = [1]; Object.defineProperty(a, "length", { writable: false }); a.push(2); return 0; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("subsequent array methods see the defined element", () => {
    expect(
      val(`export function f() { const a = []; Object.defineProperty(a, "0", { value: 1 }); a.push(2); return a.join(","); }`),
    ).toEqual({ ok: true, value: "1,2" });
    expect(
      val(`export function f() { const a = [2, 1]; Object.defineProperty(a, "0", { value: 1 }); return a.slice().sort().join(","); }`),
    ).toEqual({ ok: true, value: "1,1" });
  });
});

describe("Bug 117: defineProperty key coercion (ToPropertyKey)", () => {
  it("well-known symbol keys install behind the @@projection", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, Symbol.iterator, { value: function () { return 1; } }); return typeof o[Symbol.iterator]; }`),
    ).toEqual({ ok: true, value: "function" });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, Symbol.iterator, { value: function () { return 1; } }); return o[Symbol.iterator](); }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, Symbol.toPrimitive, { value: 1 }); return o[Symbol.toPrimitive]; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("bool / null / undefined / fractional keys coerce to strings", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, true, { value: 1 }); return o[true]; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, null, { value: 1 }); return o[null]; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, undefined, { value: 1 }); return o[undefined]; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, 1.5, { value: 1 }); return o[1.5]; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("symbol keys never leak into Object.keys", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, Symbol.iterator, { value: 1 }); return Object.keys(o).join(","); }`),
    ).toEqual({ ok: true, value: "" });
    expect(
      val(`export function f() { const o = {}; o[Symbol.toPrimitive] = 1; return Object.keys(o).join(","); }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("defineProperties copies symbol-keyed descriptors too", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperties(o, { [Symbol.iterator]: { value: 1 } }); return o[Symbol.iterator]; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("control: string / number keys keep working", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "k", { value: 1 }); return o.k; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, 2, { value: 1 }); return o[2]; }`),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 118: descriptor value installs the Abs directly", () => {
  it("fn value stays callable", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "f", { value: function () { return 42; } }); return o.f(); }`),
    ).toEqual({ ok: true, value: 42 });
  });

  it("overwriting a pre-existing property with a fn value", () => {
    expect(
      val(`export function f() { const o = { f: function () { return 1; } }; Object.defineProperty(o, "f", { value: function () { return 2; } }); return o.f(); }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("obj / tuple values keep structure", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "v", { value: { a: 1 } }); return o.v.a; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "t", { value: [1, 2] }); return o.t[1]; }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("bigint / symbol / null values survive", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "b", { value: 10n }); return o.b === 10n; }`),
    ).toEqual({ ok: true, value: true });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "s", { value: Symbol("s") }); return typeof o.s; }`),
    ).toEqual({ ok: true, value: "symbol" });
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "n", { value: null }); return o.n; }`),
    ).toEqual({ ok: true, value: null });
  });

  it("gOPD reports the installed value", () => {
    expect(
      val(`export function f() { const o = {}; Object.defineProperty(o, "f", { value: function () { return 1; } }); return typeof Object.getOwnPropertyDescriptor(o, "f").value; }`),
    ).toEqual({ ok: true, value: "function" });
  });
});
