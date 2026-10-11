/**
 * D 类 wrong-exact 缺陷（原型链语义未建模）：修前引擎对依赖原型链才能
 * 确定的值断言了精确结果——
 * - Bug 15：$in tuple 兑底臂对 Array.prototype 成员（"map" in []）、brand
 *   兑底臂对 Map/Set 的 size 访问器断言精确 false（原生恒 true）；
 * - Bug 16：$instanceof obj 臂对 open obj（Object.create 产物）+ 内建构造器
 *   断言精确 false（Object.create([]) instanceof Array 原生 true）；
 * - Bug 17：$get 缺槽兑底把 o.__proto__ 折精确 undefined（原生读出原型对象）；
 * - Bug 18：$forInKeys 只算自有可枚举键，Object.create({x:1}) 的 for-in
 *   折 0 次（原生跑 1 次）。
 * 修复口径：不引入通用原型链建模——tuple 臂复用静态 Array.prototype 名表、
 * brand 补访问器表（size）、open obj 诚实降级 boolean/抽象键序列、
 * __proto__ 读复用 Object.getPrototypeOf 的 protoOfRecv 投影。
 * 原生 ground truth 均为 node 实测。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

type Lit = { ok: boolean; value?: unknown };

function val(src: string): Lit {
  return litValue(call(src).result) as Lit;
}

/** 断言折叠为指定精确值 */
function expectExact(src: string, value: unknown) {
  expect(val(src)).toEqual({ ok: true, value });
}

/** 断言不折叠为指定精确值（允许抽象或相反精确值）——wrong-exact 消除 */
function expectNotExact(src: string, value: unknown) {
  const r = val(src);
  expect(r.ok && r.value === value).toBe(false);
}

describe("Bug 15 — `in` walks the prototype chain (tuple / brand arms)", () => {
  it("Array.prototype members on array literals are exact true", () => {
    expectExact(`export function f() { return "map" in []; }`, true);
    expectExact(`export function f() { return "push" in [1]; }`, true);
    expectExact(`export function f() { return "concat" in [1]; }`, true);
    expectExact(`export function f() { return "entries" in []; }`, true);
    expectExact(`export function f() { return "toString" in []; }`, true);
    expectExact(`export function f() { return "constructor" in []; }`, true);
  });

  it("Map/Set size accessor is exact true", () => {
    expectExact(`export function f() { return "size" in new Map(); }`, true);
    expectExact(`export function f() { return "size" in new Set(); }`, true);
  });

  it("precision controls stay exact (no over-approximation)", () => {
    expectExact(`export function f() { return "x" in [1]; }`, false);
    expectExact(`export function f() { return "0" in [1]; }`, true);
    expectExact(`export function f() { return "length" in [1]; }`, true);
    expectExact(`export function f() { return "a" in { a: 1 }; }`, true);
    expectExact(`export function f() { return "b" in { a: 1 }; }`, false);
    expectExact(`export function f() { return "toString" in {}; }`, true);
    expectExact(`export function f() { return "b" in {}; }`, false);
    expectExact(`export function f() { return "has" in new Map(); }`, true);
    expectExact(`export function f() { return "get" in new Set(); }`, false);
    expectExact(`export function f() { return "size" in new WeakMap(); }`, false);
    expectExact(`export function f() { const o = Object.create(null); return "toString" in o; }`, false);
  });
});

describe("Bug 16 — instanceof on open objects (Object.create receivers)", () => {
  it("no longer folds exact false when the proto chain may match", () => {
    // 原生 true：Object.create([]) 的原型链含 Array.prototype；引擎对
    // open obj（原型链未知）诚实降级 boolean，不再断言精确 false
    expectNotExact(`export function f() { return Object.create([]) instanceof Array; }`, false);
    expectNotExact(`export function f() { return Object.create(Function.prototype) instanceof Function; }`, false);
  });

  it("precision controls stay exact", () => {
    expectExact(`export function f() { return Object.create([]) instanceof Object; }`, true);
    expectExact(`export function f() { return ({}) instanceof Object; }`, true);
    expectExact(`export function f() { return ({}) instanceof Array; }`, false);
    expectExact(`export function f() { return Object.create(null) instanceof Object; }`, false);
    expectExact(`export function f() { return [] instanceof Array; }`, true);
  });
});

describe("Bug 17 — __proto__ member read yields the prototype, not undefined", () => {
  it("plain object literal: proto is the Object.prototype singleton", () => {
    expectExact(`export function f() { return ({}).__proto__ === Object.prototype; }`, true);
    expectExact(`export function f() { return typeof ({}).__proto__; }`, "object");
  });

  it("array / number receivers: proto is an object (boxed / Array.prototype)", () => {
    // 两个 protoBrandAbs("Array") 非同引用 → === 抽象 boolean（诚实面：
    // 不得折精确 false）；typeof 恢复 "object"
    expectNotExact(`export function f() { return [].__proto__ === Array.prototype; }`, false);
    expectExact(`export function f() { return typeof [].__proto__; }`, "object");
    expectExact(`export function f() { return typeof (1).__proto__; }`, "object");
  });

  it("null-proto objects read undefined (accessor absent, not null)", () => {
    expectExact(`export function f() { const o = Object.create(null); return o.__proto__; }`, undefined);
  });

  it("open objects (Object.create(proto)) stay honest, not exact undefined", () => {
    expectNotExact(`export function f() { return Object.create({ x: 1 }).__proto__ === undefined; }`, true);
    expectNotExact(`export function f() { return typeof Object.create({ x: 1 }).__proto__; }`, "undefined");
  });

  it("missing-slot precision controls stay exact", () => {
    expectExact(`export function f() { return ({ a: 1 }).b; }`, undefined);
    expectExact(`export function f() { return ({}).x; }`, undefined);
    expectExact(`export function f() { return Object.getPrototypeOf({}) === Object.prototype; }`, true);
  });
});

describe("Bug 18 — for-in over proto-linked objects (open obj downgrade)", () => {
  it("inherited enumerable keys no longer fold exact zero iterations", () => {
    // 原生 1：for-in over Object.create({x:1}) 访问继承键 "x"；引擎对
    // open obj（原型链未跟踪）降级抽象键序列，体 0..N 次
    expectNotExact(`export function f() { let n = 0; for (const k in Object.create({ x: 1 })) n++; return n; }`, 0);
  });

  it("closed / null-proto receivers keep the exact own-key answer", () => {
    expectExact(`export function f() { let n = 0; for (const k in { x: 1 }) n++; return n; }`, 1);
    expectExact(`export function f() { let n = 0; for (const k in { a: 1, b: 2 }) n++; return n; }`, 2);
    expectExact(`export function f() { let n = 0; for (const k in [1, 2]) n++; return n; }`, 2);
    expectExact(`export function f() { let n = 0; for (const k in Object.create(null)) n++; return n; }`, 0);
  });
});
