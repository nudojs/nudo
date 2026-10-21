/**
 * Bug 197：[[Set]] 写门只看**自有**槽与类注册表——原型链上的访问器 / 不可写
 * 槽被跳过，显式 `writable:false` 在 fn / 索引臂根本不被查。
 *
 * 修法（containers/member.ts 的 $set 写面 + containers/arr-index.ts 的
 * $idxSet 写面 + exec/runtime/proto-set.ts 新叶子）：
 * - receiver **无自有该键**时沿 [[Prototype]] 链上溯（OrdinarySet）：
 *   访问器（无 setter）→ strict TypeError；带 setter → 派发 setter；
 *   数据属性 writable:false / frozen 原型 → strict TypeError；
 * - fn 臂 / 静态类值臂 / 数组下标臂补查 defineProperty 的 writable:false。
 *
 * 负控制：自有可写属性、类字面量访问器、Object.assign 到继承 non-writable
 * （既有已正确）——不得被本次修复波及。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 定抛探针：结果 never + throws 面是指定错误类型 */
function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 197: [[Set]] 原型链写门 / writable:false 全面覆盖", () => {
  it("原型链 getter-only（Object.create）→ strict TypeError", () => {
    expect(
      threw(`export function f() {
        const p = { get a() { return 7; } };
        const o = Object.create(p);
        o.a = 5;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("原型链 writable:false 数据属性 → strict TypeError", () => {
    expect(
      threw(`export function f() {
        const p = {};
        Object.defineProperty(p, "x", { value: 1, writable: false });
        const o = Object.create(p);
        o.x = 2;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("原型链 frozen → strict TypeError", () => {
    expect(
      threw(`export function f() {
        const p = { a: 1 };
        Object.freeze(p);
        const o = Object.create(p);
        o.a = 2;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("两级原型链 getter → strict TypeError", () => {
    expect(
      threw(`export function f() {
        const p = { get x() { return 1; } };
        const o = Object.create(p);
        const q = Object.create(o);
        q.x = 5;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("原型链带 setter 的访问器 → 派发 setter（不是静默建自有属性）", () => {
    expect(
      v(`export function f() {
        let seen = 0;
        const p = { set a(v) { seen = v; } };
        const o = Object.create(p);
        o.a = 9;
        return seen;
      }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("fn 上 defineProperty writable:false → strict TypeError", () => {
    expect(
      threw(`export function f() {
        function g() {}
        Object.defineProperty(g, "x", { value: 3, writable: false });
        g.x = 4;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("数组下标 defineProperty writable:false → strict TypeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2];
        Object.defineProperty(a, "0", { value: 5, writable: false });
        a[0] = 6;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：自有可写属性写 → 成功（值生效）", () => {
    expect(
      v(`export function f() {
        const o = { a: 1 };
        o.a = 5;
        return o.a;
      }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("负控制：原型链普通可写属性 → receiver 建自有属性（值生效）", () => {
    expect(
      v(`export function f() {
        const p = { a: 1 };
        const o = Object.create(p);
        o.a = 5;
        return o.a;
      }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("负控制：类字面量访问器（继承面）→ TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        class A { get y() { return 7; } }
        class B extends A {}
        const b = new B();
        b.y = 1;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：Object.assign 到继承 non-writable → TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const p = {};
        Object.defineProperty(p, "x", { value: 1, writable: false });
        const t = Object.create(p);
        Object.assign(t, { x: 2 });
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：函数 expando 写（未 defineProperty）→ 仍成功", () => {
    expect(
      threw(`export function f() {
        function g() {}
        g.x = 4;
        return "no-throw";
      }`),
    ).toBe(false);
  });
});
