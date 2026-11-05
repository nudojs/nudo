/**
 * Bug 257：`$new` 的 Proxy 分支必须先判 **IsConstructor(target)**。
 *
 * 原生（node 实测）：
 * - `new Proxy(() => 1, { construct(){ ... } })` → **TypeError**（"not a
 *   constructor"），且**构造陷阱不派发**（陷阱副作用不发生）。
 * - `new Proxy({}, { construct(){ ... } })` → 同抛 TypeError。
 * - 靶**可构造**时（函数 / 类）⇒ 陷阱照常派发。
 *
 * 引擎此前**先查陷阱再派发**，无 IsConstructor 判定 ⇒ 靶非构造器时引擎
 * 照样派发 construct 陷阱（副作用发生、构造"成功"）⇒ 假绿 + 假值。
 */
import { describe, it, expect } from "vitest";
import { call, val, isNever, throwsError } from "../../__tests__/eval-helpers.ts";

describe("Bug 257：Proxy construct 的靶可构造性判定", () => {
  it("靶不可构造（箭头函数）：定抛 TypeError", () => {
    const r = call(
      `export function f(){ const t = () => 1; const p = new Proxy(t, { construct(){ return {a:9}; } }); return new p(); }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("靶不可构造（普通对象）：定抛 TypeError", () => {
    const r = call(
      `export function f(){ const t = {}; const p = new Proxy(t, { construct(){ return {a:9}; } }); return new p(); }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("靶不可构造：construct 陷阱**不派发**（副作用不发生）", () => {
    expect(val(
      `export function f(){ let seen = 0; const t = () => 1; const p = new Proxy(t, { construct(){ seen = 1; return {a:9}; } }); try { new p(); } catch (e) {} return seen; }`,
    )).toEqual({ ok: true, value: 0 });
  });

  it("靶可构造（函数表达式）：construct 陷阱照常派发", () => {
    expect(val(
      `export function f(){ const t = function(){ this.a = 1; }; const p = new Proxy(t, { construct(){ return {a:9}; } }); return new p().a; }`,
    )).toEqual({ ok: true, value: 9 });
  });
});
