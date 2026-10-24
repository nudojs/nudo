/**
 * Bug 265：**非 prim / 非 obj** 接收者（数组元组 / 内建 brand / 用户类实例）
 * 上调用**确实不存在**的方法 ⇒ 引擎**不记 may-throw** ⇒ L2 门禁**假绿**
 * （原生恒抛 `TypeError`）。
 *
 * 根因：「缺失方法终判」链只覆盖 prim / obj / 注册用户类实例
 * （`callSiteHasNoCallableTarget`）——tuple / arr / 内建 brand 一律折
 * unknown 且不记 throws。
 *
 * 修复：`invoke.ts` 的缺失方法终判新增「已知形状」分支
 * （`knownSurfaceMemberAbsent`）——tuple / arr 查 Array.prototype 封闭面
 * （ARRAY_PROTO_METHOD_NAMES），内建 brand 查 BUILTIN_BRAND_METHODS 全列；
 * 命中「确定不存在」→ 原生 TypeError（与 P4a 分支同口径）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../../abs.ts";
import { call, isNever, throwsError } from "../../__tests__/eval-helpers.ts";

describe("Bug 265: missing method on non-prim / non-obj receivers throws", () => {
  it("数组元组上调用不存在的方法 → 原生 TypeError", () => {
    for (const src of [
      `export function f() { return [].missing(); }`,
      `export function f() { return [1, 2].missing(); }`,
      `export function f() { const a = [1]; return a.missing(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("内建 brand 上调用不存在的方法 → 原生 TypeError", () => {
    for (const src of [
      `export function f() { return new Map().missing(); }`,
      `export function f() { return new Set().missing(); }`,
      `export function f() { return new Date().missing(); }`,
      `export function f() { return new Error("x").missing(); }`,
      `export function f() { return new RegExp("a").missing(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("TypeError 可被 try/catch 吸收（原生同口径）", () => {
    const r = call(
      `export function f() { try { return [].missing(); } catch (e) { return 'throw'; } }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "throw" });
  });

  it("原型面内的方法不回归：数组方法照常派发", () => {
    const r = call(
      `export function f() { const a = [1, 2]; return a.map((x) => x + 1).join(","); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "2,3" });
  });

  it("原型面内的方法不回归：内建 brand 方法照常派发", () => {
    const r = call(
      `export function f() { const m = new Map(); m.set("a", 1); return m.get("a"); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("Object.prototype 名不回归（数组上的 toString / hasOwnProperty）", () => {
    const r = call(
      `export function f() { const a = [1]; return String(a.hasOwnProperty("length")); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true" });
  });

  it("注册用户类实例不回归（域不同：callSiteHasNoCallableTarget 判）", () => {
    const r = call(
      `export class PlainBox { constructor() { this.v = 1; } present() { return this.v; } }
       export function f() { return new PlainBox().absent(); }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("闭对象接收者不回归（既有 definitelyUncallableMember 路径）", () => {
    const r = call(`export function f() { return ({}).missing(); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("prim 接收者的软判定不回归（number 上缺失方法 → unknown + may-throw）", () => {
    const r = call(`export function f() { return (5).missing(); }`);
    expect(isNever(r.result)).toBe(false);
  });
});
