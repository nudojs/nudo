/**
 * Bug 264：内建**命名空间对象**上调用**不存在**的静态方法 ⇒ 引擎不记
 * may-throw ⇒ L2 门禁**假绿**（原生确定抛 TypeError）。
 *
 * 原生：`Math.clamp(1,0,2)` / `JSON.foo(1)` / `Object.foo(1)` /
 * `Number.foo(1)` / `Reflect.foo(1)` 全部抛 TypeError（not a function）；
 * 成员**存在**但不是函数（`Math.PI()`）也抛。
 *
 * 引擎此前：命名空间分支回落 `unknown` 且**不记 throws** ⇒ 引擎声称
 * 「不可能抛」（throws 面 = never）⇒ L2 门禁放行。
 *
 * 钉：改前 engine=unknown / throws=never（MISSED-THROW，engineNoThrow）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError } from "../../__tests__/eval-helpers.ts";
import { diffBody } from "../../__tests__/differential/harness.ts";

/** 断言调用定抛 TypeError（结果 never + throws 面是 TypeError） */
function expectTypeError(src: string) {
  const rec = call(src, "f");
  expect(isNever(rec.result)).toBe(true);
  expect(throwsError(rec.throws, "TypeError")).toBe(true);
}

describe("Bug 264: 命名空间上不存在的静态方法定抛 TypeError", () => {
  it("Math.clamp(1,0,2) ⇒ TypeError", () => {
    expectTypeError(`export function f() { return Math.clamp(1, 0, 2); }`);
  });

  it("JSON.foo(1) ⇒ TypeError", () => {
    expectTypeError(`export function f() { return JSON.foo(1); }`);
  });

  it("Object.foo(1) ⇒ TypeError", () => {
    expectTypeError(`export function f() { return Object.foo(1); }`);
  });

  it("Number.foo(1) ⇒ TypeError", () => {
    expectTypeError(`export function f() { return Number.foo(1); }`);
  });

  it("Reflect.foo(1) ⇒ TypeError", () => {
    expectTypeError(`export function f() { return Reflect.foo(1); }`);
  });

  it("成员存在但不是函数（Math.PI()）⇒ TypeError", () => {
    expectTypeError(`export function f() { return Math.PI(); }`);
  });

  it("control：Math.max(1,3) ⇒ 3（原生一致）", () => {
    const rec = call(`export function f() { return Math.max(1, 3); }`, "f");
    expect(rec.result.term?.op).toEqual("lit");
  });

  it("control：JSON.parse(\"2\") ⇒ 2（原生一致）", () => {
    const rec = call(`export function f() { return JSON.parse("2"); }`, "f");
    expect(rec.result.term?.op).toEqual("lit");
  });

  it("差分对账（native oracle）：改前 MISSED-THROW / 改后一致", () => {
    expect(diffBody(`return Math.clamp(1, 0, 2);`)).toBeNull();
    expect(diffBody(`return JSON.foo(1);`)).toBeNull();
    expect(diffBody(`return Object.foo(1);`)).toBeNull();
    expect(diffBody(`return Number.foo(1);`)).toBeNull();
  });
});
