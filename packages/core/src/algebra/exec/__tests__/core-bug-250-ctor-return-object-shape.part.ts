/**
 * Bug 250：原生 [[Construct]] 的返回值判定——「返回值**是 Object** 就用它」。
 *
 * 原生（node 实测）：
 * - `function F(){ this.a=1; return [1,2]; }` → `new F()` 是**数组**
 *   （`Array.isArray` true、`JSON.stringify` → "[1,2]"），且
 *   `new F() instanceof F` **false**（原型取 newTarget，构造器返回对象
 *   替换 this）。
 * - 构造器返回**函数** → `typeof new F()` === "function"。
 * - 构造器返回**原始值** → 忽略，返回 this（`typeof` 仍是 "object"）。
 *
 * 引擎此前把「对象」窄化成 `brand|obj` 两个形态 ⇒ 数组 / 函数返回被静默
 * 换回 this（`Array.isArray` 假 false、`instanceof` 假 true）。
 */
import { describe, it, expect } from "vitest";
import { val } from "../../__tests__/eval-helpers.ts";

describe("Bug 250：构造器返回值是对象就用它（不窄化成 brand|obj）", () => {
  it("宿主构造器返回数组：new F() 是数组", () => {
    expect(
      val(
        `export function f(){ function F(){ this.a=1; return [1,2]; } const x = new F(); return Array.isArray(x); }`,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("宿主构造器返回数组：内容可读（不是被换回的 this）", () => {
    expect(
      val(
        `export function f(){ function F(){ this.a=1; return [1,2]; } const x = new F(); return JSON.stringify(x); }`,
      ),
    ).toEqual({ ok: true, value: "[1,2]" });
  });

  it("宿主构造器返回函数：typeof new F() === 'function'", () => {
    expect(
      val(
        `export function f(){ function F(){ return function inner(){ return 1; }; } return typeof new F(); }`,
      ),
    ).toEqual({ ok: true, value: "function" });
  });

  it("宿主构造器返回箭头函数：typeof new F() === 'function'", () => {
    expect(
      val(
        `export function f(){ function F(){ return ()=>1; } return typeof new F(); }`,
      ),
    ).toEqual({ ok: true, value: "function" });
  });

  it("宿主构造器返回原始值：忽略并返回 this（typeof 仍 'object'）", () => {
    expect(
      val(
        `export function f(){ function F(){ return 5; } return typeof new F(); }`,
      ),
    ).toEqual({ ok: true, value: "object" });
  });

  it("宿主构造器返回普通对象：仍用它（既有口径不退化）", () => {
    expect(
      val(
        `export function f(){ function F(){ return {a:1}; } return typeof new F(); }`,
      ),
    ).toEqual({ ok: true, value: "object" });
  });

  it("类构造器返回数组：new C() 是数组（既有口径不退化）", () => {
    expect(
      val(`export function f(){ class C { constructor(){ return [1,2]; } } return Array.isArray(new C()); }`),
    ).toEqual({ ok: true, value: true });
  });
});
