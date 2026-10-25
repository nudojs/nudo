/**
 * Object.assign 单一实现回归：second-class 静态读面与直接调用面同语义。
 *
 * 原生 Object.assign 是**引用语义**（就地 [[Set]] 并返回同一目标），因此
 * 别名（`const u = t`）与语句位都看得见写。修复前两条路径各自实现：
 * - 直接面 `Object.assign(t, s)` → runtimeAssignObject（就地）；
 * - second-class 面 `const g = Object.assign; g(t, s)` / `.call` / `.apply`
 *   → evalObjectMethod("assign") 不可变构造新 Abs ⇒ 别名读不到写
 *   （`u.b` 折 undefined #exact 假精确）。
 * 现两条路径都走 descriptor.ts 的 performObjectAssign（就地写、返回原 Abs）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, val, throwsError } from "./eval-helpers.ts";

describe("Object.assign second-class 调用面：引用语义（就地写）", () => {
  it("别名看得见 obj 目标的写", () => {
    expect(
      val(`export function f() {
        const t = {};
        const u = t;
        const g = Object.assign;
        g(t, { b: 2 });
        return u.b;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("语句位丢弃返回值也生效", () => {
    expect(
      val(`export function f() {
        const t = { a: 1 };
        const g = Object.assign;
        g(t, { b: 2 });
        return t.a + t.b;
      }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("数组目标的下标写穿到别名（且扩展 length）", () => {
    expect(
      val(`export function f() {
        const t = [];
        const u = t;
        const g = Object.assign;
        g(t, [1]);
        return u[0] + u.length;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("Object.assign.call(null, t, src) 同样就地写", () => {
    expect(
      val(`export function f() {
        const t = {};
        const u = t;
        Object.assign.call(null, t, { b: 2 });
        return u.b;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("Object.assign.apply(null, [t, src]) 同样就地写", () => {
    expect(
      val(`export function f() {
        const t = {};
        const u = t;
        Object.assign.apply(null, [t, { b: 2 }]);
        return u.b;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("直接调用面保持就地写（对照组）", () => {
    expect(
      val(`export function f() {
        const t = {};
        const u = t;
        Object.assign(t, { b: 2 });
        return u.b;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("多源按序覆盖（second-class）", () => {
    expect(
      val(`export function f() {
        const t = { a: 1 };
        const g = Object.assign;
        g(t, { b: 2 }, { a: 3 });
        return t.a * 10 + t.b;
      }`),
    ).toEqual({ ok: true, value: 32 });
  });
});

describe("Object.assign second-class 调用面：[[Set]]/抛错域同源", () => {
  it("自有 setter 派发（this = 目标）", () => {
    expect(
      val(`export function f() {
        const t = { set x(v) { this.y = v; } };
        const g = Object.assign;
        g(t, { x: 5 });
        return t.y;
      }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("getter-only 目标 → TypeError", () => {
    const r = call(`export function f() {
      const t = { get x() { return 1; } };
      const g = Object.assign;
      g(t, { x: 5 });
      return 0;
    }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("frozen 目标 → TypeError（此前不可变路径不读不变性侧表）", () => {
    const r = call(`export function f() {
      const t = Object.freeze({ a: 1 });
      const g = Object.assign;
      g(t, { b: 2 });
      return 0;
    }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("__proto__ 源键走原型 setter（null 值 → null-proto）", () => {
    expect(
      val(`export function f() {
        const t = {};
        const g = Object.assign;
        g(t, JSON.parse('{"__proto__":null}'));
        return Object.getPrototypeOf(t) === null;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("non-enumerable 源键不复制（EnumerableOwnProperties 视图）", () => {
    expect(
      litValue(
        call(`export function f() {
          const s = {};
          Object.defineProperty(s, "hidden", { value: 1, enumerable: false });
          const t = {};
          const g = Object.assign;
          g(t, s);
          return Object.keys(t).length;
        }`).result,
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it("symbol 键随拷贝（@@X 投影槽保留标记）", () => {
    expect(
      val(`export function f() {
        const t = {};
        const g = Object.assign;
        g(t, { a: 1, [Symbol.toStringTag]: 2 });
        return String(t[Symbol.toStringTag]);
      }`),
    ).toEqual({ ok: true, value: "2" });
  });

  it("prim/boxed 目标口径不变：string 折原始串 / bigint 定抛", () => {
    expect(
      val(`export function f() {
        const g = Object.assign;
        return g("ab", { a: 2 });
      }`),
    ).toEqual({ ok: true, value: "ab" });
    const r = call(`export function f() {
      const g = Object.assign;
      try { g(1n, { a: 2 }); } catch (e) { return "caught"; }
      return "missed";
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
  });
});

describe("Object.assign second-class 调用面：brand（原型对象）目标", () => {
  it("写进原型对象的自有属性（for-in / 实例读可见）", () => {
    expect(
      val(`export function f() {
        class Q1 {}
        const g = Object.assign;
        g(Q1.prototype, { b: 1 });
        const keys = [];
        for (const k in new Q1()) keys.push(k);
        return keys.join(",") + "/" + String(new Q1().b) + "/" + String(Q1.prototype.b);
      }`),
    ).toEqual({ ok: true, value: "b/1/1" });
  });
});
