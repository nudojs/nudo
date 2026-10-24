/**
 * Bug 162 回归：解构的**成员目标**带**默认值**时（`({ a: o.x = 1 } = src)`），
 * 赋值**写回不能丢**。
 *
 * 修复前：成员目标落进「嵌套 + 默认」分支后被当子模式递归——成员写回
 * **静默丢弃** ⇒ 目标成员保持旧值（错值）。原生语义是
 * 「读属性 → undefined 取默认 → 写回目标成员」。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

describe("Bug 162：解构成员目标带默认值 → 写回不丢", () => {
  it("属性为 undefined → 取默认值并写回成员", () => {
    expect(
      val(`export function f() { const src = { a: undefined }; const o = { x: 0 }; ({ a: o.x = 1 } = src); return o.x; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("属性有值 → 写回该值（默认值不生效）", () => {
    expect(
      val(`export function f() { const o = { x: 0 }; ({ a: o.x = 1 } = { a: 5 }); return o.x; }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("嵌套成员目标（o.x.y = 7）同样写回", () => {
    expect(
      val(`export function f() { const o = { x: { y: 0 } }; ({ a: o.x.y = 7 } = { a: undefined }); return o.x.y; }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("数组模式的成员目标带默认值（[o.x = 1] = src）同样写回", () => {
    expect(
      val(`export function f() { const o = { x: 0 }; [o.x = 1] = [undefined]; return o.x; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o = { x: 0 }; [o.x = 1] = [9]; return o.x; }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("负控制：标识符目标带默认值（{ a = 1 }）行为不变", () => {
    expect(val(`export function f() { const { a = 1 } = {}; return a; }`))
      .toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const { a = 1 } = { a: 5 }; return a; }`))
      .toEqual({ ok: true, value: 5 });
  });

  it("负控制：成员目标**不带**默认值仍写回（既有行为不回归）", () => {
    expect(
      val(`export function f() { const o = { x: 0 }; ({ a: o.x } = { a: 3 }); return o.x; }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("负控制：嵌套模式 + 默认（{ a: { b } = {} }）行为不变", () => {
    expect(val(`export function f() { const { a: { b } = { b: 4 } } = {}; return b; }`))
      .toEqual({ ok: true, value: 4 });
  });
});
