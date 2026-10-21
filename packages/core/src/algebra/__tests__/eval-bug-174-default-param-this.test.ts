/**
 * Bug 174 回归：默认参数表达式里的 `this` 绑到**外层作用域**的 this。
 *
 * 原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this`
 * 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层
 * 作用域的 this。
 *
 * 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒
 * 默认表达式沿用外层 `thisParam`：
 *   - `const o = { v: 3, m(){ return (function (x = this.v) { return x; })(); } }`
 *     原生抛 TypeError（严格模式 this = undefined ⇒ `undefined.v`），引擎给 3
 *     （**外层对象**的 v）——自信错值 + 漏抛；
 *   - `function (x = this) {}` + `.call({ v: 1 })` 原生返回接收者，引擎给
 *     undefined（外层 this = undefined）。
 *
 * 不变量（负控制钉住）：普通调用仍是 undefined（严格模式）；箭头表达式的
 * `this` 仍词法继承外层；方法**自身**的默认值（`m(x = this.v)`）仍是 3。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { callLit, isNever, throwsError } from "./eval-helpers.ts";

/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue(callLit(src, "f", ...args).result);
}

describe("Bug 174 — 默认参数表达式的 this 是本函数自己的 this", () => {
  it("函数表达式 + .call(receiver)：默认值读到接收者", () => {
    const src = `export function f() {
      const g = function (x = this) { return x; };
      return g.call({ v: 1 }) === undefined ? "undef" : "recv";
    }`;
    expect(v(src)).toEqual({ ok: true, value: "recv" });
  });

  it("函数声明 + .call(receiver)：默认值读到接收者", () => {
    const src = `export function g(x = this) { return x; }
    export function f() {
      return g.call({ v: 1 }) === undefined ? "undef" : "recv";
    }`;
    expect(v(src)).toEqual({ ok: true, value: "recv" });
  });

  it("方法体内的函数表达式：默认值 this = undefined ⇒ TypeError（原生同）", () => {
    const src = `export function f() {
      const o = { v: 3, m(){ return (function (x = this.v) { return x; })(); } };
      return o.m();
    }`;
    const rec = callLit(src, "f");
    expect(isNever(rec.result)).toBe(true);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("方法体内的函数声明：默认值 this = undefined ⇒ TypeError（原生同）", () => {
    const src = `export function f() {
      const o = { v: 3, m(){ function h(x = this.v) { return x; } return h(); } };
      return o.m();
    }`;
    const rec = callLit(src, "f");
    expect(isNever(rec.result)).toBe(true);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });
});

describe("Bug 174 — 负控制：this 归属不被改写", () => {
  it("普通调用（严格模式）this = undefined（不是全局对象）", () => {
    const src = `export function f() {
      const g = function (x = this) { return x; };
      return g() === undefined ? "undef" : "recv";
    }`;
    expect(v(src)).toEqual({ ok: true, value: "undef" });
  });

  it("箭头表达式的 this 仍词法继承外层（箭头无自己的 this）", () => {
    const src = `export function f() {
      const o = { v: 3, m(){ return (() => this.v)(); } };
      return o.m();
    }`;
    expect(v(src)).toEqual({ ok: true, value: 3 });
  });

  it("方法自身的默认值（m(x = this.v)）仍是 3", () => {
    const src = `export function f() {
      const o = { v: 3, m(x = this.v){ return x; } };
      return o.m();
    }`;
    expect(v(src)).toEqual({ ok: true, value: 3 });
  });

  it("箭头默认值的 this 词法继承外层方法（`() => this.v` 同）", () => {
    const src = `export function f() {
      const o = { v: 3, m(){ return ((x = this.v) => x)(); } };
      return o.m();
    }`;
    expect(v(src)).toEqual({ ok: true, value: 3 });
  });
});
