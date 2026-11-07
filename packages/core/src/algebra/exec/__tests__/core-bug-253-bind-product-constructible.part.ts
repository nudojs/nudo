/**
 * Bug 253：`Function.prototype.bind` 产物**可构造**——原生
 * `new (f.bind(thisArg, ...bound))()` 走**绑定目标的 [[Construct]]**：
 * 以 newTarget.prototype 建新实例、绑定实参前置、`this` = 新实例
 * （**忽略**绑定的 thisArg）。
 *
 * 原生（node 实测）：
 * - `function F(a){ this.a = a; } const B = F.bind(null, 7); new B().a === 7`
 * - `class A { constructor(v){ this.v = v; } } const B = A.bind(null, 3);
 *   new B().v === 3`
 * - 二次 bind（`B.bind(null)`）仍可构造、`new C().a === 7`。
 *
 * 引擎此前 bind 产物只带 apply 钩子 ⇒ `$new` 复用 `impl.apply` ⇒ 目标
 * 构造器在 `this === boundThis`（null）上执行 ⇒ `new B()` 假抛 TypeError
 * （never）。构造 facet 走 declare.ts 的模块级 WeakMap 侧表（不改公共
 * 类型 AbsFnImpl）。
 */
import { describe, it, expect } from "vitest";
import { call, val, isNever, throwsError } from "../../__tests__/eval-helpers.ts";

describe("Bug 253：bind 产物的构造语义", () => {
  it("宿主函数 bind 产物：new B() 的 this = 新实例（绑定实参前置）", () => {
    const r = call(
      `export function f(){ function F(a){ this.a = a; } const B = F.bind(null, 7); const o = new B(); return o.a; }`,
    );
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(val(
      `export function f(){ function F(a){ this.a = a; } const B = F.bind(null, 7); const o = new B(); return o.a; }`,
    )).toEqual({ ok: true, value: 7 });
  });

  it("类值 bind 产物：new B() 造的是目标类的实例", () => {
    expect(val(
      `export function f(){ class A { constructor(v){ this.v = v; } } const B = A.bind(null, 3); const o = new B(); return o.v; }`,
    )).toEqual({ ok: true, value: 3 });
  });

  it("二次 bind 产物仍可构造（绑定实参逐层前置）", () => {
    expect(val(
      `export function f(){ function F(a){ this.a = a; } const B = F.bind(null, 7); const C = B.bind(null); const o = new C(); return o.a; }`,
    )).toEqual({ ok: true, value: 7 });
  });

  it("普通调用面不受影响（B(9) 走绑定 thisArg——原生同口径抛 TypeError）", () => {
    // 原生 strict：this 为 null → `this.a = a` 抛 TypeError
    const r = call(
      `export function f(){ function F(a){ this.a = a; } const B = F.bind(null, 7); return B(9); }`,
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});
