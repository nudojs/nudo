/**
 * Bug 46（this 绑定调用点化）：成员调用的接收者注入此前由函数定义位点
 * 决定——`{ bindThis: true }` 只盖对象字面量属性值位的函数表达式；
 * 赋值 RHS（o.get = function(){…}）/ 再赋值 / 计算键赋值的同一函数
 * 走通用路径无标记，$invoke 不传接收者 → $rawThis(this) 恒 undefined →
 * 假 always-throw（never + TypeError），接收者派生域全体丢失。
 *
 * 修复口径：receiver 统一经 $call 第三参（thisVal 通道）传递——
 * $invoke（成员调用）传接收者；bindThis impl（对象方法）由 $call 派发
 * 注入首参；普通 fn 经 apply 钩子进宿主 this；函数声明泄漏值经
 * asAbsVal 桥转发 thisVal；直接调用 / call/apply/bind 缺省 ≡ strict
 * this undefined。native 对照走 differential diffBody。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

describe("Bug 46: 动态赋值方法的 this 绑定（成员调用注入接收者）", () => {
  it("o.get = function(){ return this.v; }; o.get() → 1（非 never/TypeError）", () => {
    const r = call(
      `export function f() { const o = {v:1}; o.get = function(){ return this.v; }; return o.get(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("const g = function(){…}; o.get = g; o.get() → 1", () => {
    const r = call(
      `export function f() { const o = {v:1}; const g = function(){ return this.v; }; o.get = g; return o.get(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("再赋值 o.m = f; o.m = g; o.m() → 2（最后一次赋值的接收者派生）", () => {
    const r = call(
      `export function f() { const o = {v:2}; const f2 = function(){ return 1; }; const g = function(){ return this.v; }; o.m = f2; o.m = g; return o.m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("计算键 o[k] = function(){…}; o.get() → 1", () => {
    const r = call(
      `export function f() { const o = {v:1}; const k = "get"; o[k] = function(){ return this.v; }; return o.get(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("函数声明赋值成员：function g(){ return this.v; } o.get = g; o.get() → 1", () => {
    const r = call(
      `export function f() { const o = {v:1}; function g(){ return this.v; } o.get = g; return o.get(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 46: 统一 thisVal 通道不回归既有面", () => {
  it("对象方法 bindThis：o.get() / call / apply / bind 全注入", () => {
    const r = call(
      `export function f() { const o = {v:7, m(x){ return this.v + x; }}; return o.m(1) + o.m.call(o, 2) + o.m.apply(o, [3]) + o.m.bind(o)(4); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 38 });
  });

  it("方法型 FunctionExpression 属性（{ get: function(){…} }）保持接收者", () => {
    const r = call(
      `export function f() { const o = {v:4, get: function(){ return this.v; }}; return o.get(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 4 });
  });

  it("自由调用解绑方法 → strict TypeError（不位移实参）", () => {
    const r = call(
      `export function f() { const o = {v:7, m(x){ return x; }}; const g = o.m; return g(1); }`,
    );
    // 原生 strict：o.m 提取后 this=undefined；m 体读 this.v → TypeError。
    // 此处 m 只用 x——1 必须落到 x 位（不得被接收者槽位挤占）
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("自由调用读 this 成员 → TypeError（native 对账）", () => {
    expect(
      diffBody(`const o = {v:7, m(){ return this.v; }}; const g = o.m; return g();`),
    ).toBeNull();
  });

  it("fn.call(obj)：普通函数声明的 thisArg 承接", () => {
    const r = call(
      `export function f() { function g(){ return this.v; } return g.call({v:9}); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 9 });
  });

  it("new 方法型函数表达式值：新实例走首参注入", () => {
    const r = call(
      `export function f() { const o = { C: function(){ this.x = 5; } }; const c = new o.C(); return c.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("Object.defineProperty 访问器 getter 的 this（bindThis / 普通fn 双形态）", () => {
    const r = call(
      `export function f() { const o = {}; Object.defineProperty(o, "g", { get: function(){ return this.v; }, configurable: true }); o.v = 12; return o.g; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 12 });
  });

  it("类值 static [Symbol.hasInstance] 方法/字段（适配器 bindThis 化后不回归）", () => {
    const r1 = call(
      `export function f() { class C { static [Symbol.hasInstance](x) { return typeof x === "number"; } } return 5 instanceof C; }`,
    );
    expect(litValue(r1.result)).toEqual({ ok: true, value: true });
    const r2 = call(
      `export function f() { class C { static [Symbol.hasInstance] = (x) => typeof x === "string"; } return "a" instanceof C; }`,
    );
    expect(litValue(r2.result)).toEqual({ ok: true, value: true });
  });
});

describe("Bug 46: differential native 对照（隐式 return 体）", () => {
  const corpus = [
    `const o = {v:1}; o.get = function(){ return this.v; }; return o.get();`,
    `const o = {v:1}; const g = function(){ return this.v; }; o.get = g; return o.get();`,
    `const o = {v:2}; const a = function(){ return 1; }; const g = function(){ return this.v; }; o.m = a; o.m = g; return o.m();`,
    `const o = {v:1}; const k = "get"; o[k] = function(){ return this.v; }; return o.get();`,
    `const o = {v:3, m(x){ return this.v + x; }}; return o.m.call(o, 4);`,
    `const o = {v:3, m(x){ return this.v + x; }}; const g = o.m.bind(o); return g(5);`,
    `const o = {v:10}; return [1].map(function(x){ return this.v + x; }, o)[0];`,
    `function g(){ return this.v; } const o = {v:8}; o.get = g; return o.get();`,
  ];
  it.each(corpus.map((body, i) => [i, body] as const))(
    "语料 #%i 与 native 一致",
    (_i, body) => {
      expect(diffBody(body)).toBeNull();
    },
  );
});
