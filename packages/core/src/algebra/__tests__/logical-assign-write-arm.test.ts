/**
 * 逻辑赋值（||= / &&= / ??=）只在**实际写入的臂**写回回归（报告 Bug 138）。
 *
 * 原生语义：只有实际写入的分支发生 PutValue——`o.a ||= 2` 在左侧为真值时
 * **不写**（不触发 setter、只读访问器不抛 TypeError）。
 *
 * 修前写回包在整个短路 fork 结果之外（`setSrc(sc)`）——「保留原值」臂也
 * 照样走一次 $set：只读访问器假抛 TypeError（门禁假红）、带 setter 的属性
 * setter 被多调一次（可观测 `_v`）。
 *
 * 修法：写回下沉到写入臂内，「保留原值」臂只返回读值；写回根进 fork 绑定
 * 集（extraBindingNames），臂内写经 fork 绑定-join 协议收口。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, isNever, throwsError } from "./eval-helpers.ts";

describe("逻辑赋值只在写入臂写（||= / &&= / ??=）", () => {
  it("||= 遇只读访问器（真值）不写、不抛（修前 FALSE-THROW）", () => {
    const r = call(
      `export function f() { const o = { get a() { return 1; } }; o.a ||= 2; return "ok"; }`,
      "f",
    );
    expect(isNever(r.throws)).toBe(true);
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok" });
  });

  it("??= 遇只读访问器（非 nullish）不写、不抛（修前抛 TypeError）", () => {
    const r = call(
      `export function f() { const o = { get a() { return 1; } }; o.a ??= 2; return "ok"; }`,
      "f",
    );
    expect(isNever(r.throws)).toBe(true);
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok" });
  });

  it("&&= 遇只读访问器（假值）不写、不抛", () => {
    const r = call(
      `export function f() { const o = { get a() { return 0; } }; o.a &&= 2; return "ok"; }`,
      "f",
    );
    expect(isNever(r.throws)).toBe(true);
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok" });
  });

  it("||= 遇只读访问器（假值）确实要写 → 抛 TypeError（原生同款）", () => {
    const r = call(
      `export function f() { const o = { get a() { return 0; } }; o.a ||= 2; return "ok"; }`,
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("类 getter：a.a ||= 2 后 a.a 仍是 1", () => {
    const r = call(
      `export function f() { class A { get a() { return 1; } } const a = new A(); a.a ||= 2; return a.a; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("类 getter+setter：||= 不调 setter（_v 仍 undefined）", () => {
    const r = call(
      `export function f() { class A { get a() { return 1; } set a(v) { this._v = v; } } const a = new A(); a.a ||= 2; return a.a + "|" + a._v; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "1|undefined" });
  });

  it("setter 不被多调一次：o.a ||= 2 后 o._v 仍为 0", () => {
    const r = call(
      `export function f() { const o = { _v: 0, get a() { return 1; }, set a(v) { this._v = v; } }; o.a ||= 2; return o._v; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("数据属性：o.a ||= 2（a=0）→ 2", () => {
    const r = call(`export function f() { const o = { a: 0 }; o.a ||= 2; return o.a; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("数据属性：o.a ||= 2（a=1）→ 1", () => {
    const r = call(`export function f() { const o = { a: 1 }; o.a ||= 2; return o.a; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("数据属性：o.a &&= 2（a=0）→ 0", () => {
    const r = call(`export function f() { const o = { a: 0 }; o.a &&= 2; return o.a; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("数据属性：o.a &&= 2（a=1）→ 2", () => {
    const r = call(`export function f() { const o = { a: 1 }; o.a &&= 2; return o.a; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("数据属性：o.a ??= 2（a=0，非 nullish）→ 0", () => {
    const r = call(`export function f() { const o = { a: 0 }; o.a ??= 2; return o.a; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("下标目标：a[0] ||= 9（a[0]=1）→ 1", () => {
    const r = call(`export function f() { const a = [1]; a[0] ||= 9; return a[0]; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("标识符臂不受影响：x ||= 2（x=1）→ 1；（x=0）→ 2", () => {
    const a = call(`export function f() { let x = 1; x ||= 2; return x; }`, "f");
    expect(litValue(a.result)).toEqual({ ok: true, value: 1 });
    const b = call(`export function f() { let x = 0; x ||= 2; return x; }`, "f");
    expect(litValue(b.result)).toEqual({ ok: true, value: 2 });
  });
});
