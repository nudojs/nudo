/**
 * Bug 279：Proxy 的 `[[Call]]` 既**不回退靶**、**不派发 `apply` 陷阱**
 * —— 引擎声称代理调用「永不抛」且结果恒 unknown（假绿 + 错值）。
 *
 * 规范（Proxy [[Call]]）：靶可调用时，`[[Call]]` 先取 handler 的 `apply`
 * 陷阱（实参 `(target, thisArg, args)`），**无** apply 陷阱才回退**靶**的
 * `[[Call]]`。
 *
 * 修复（packages/core/src/algebra/exec/call.ts` + `exec/match-iter.ts`）：
 * - `proxyTrapOf` 陷阱名联合补 `"apply"`（此前并集里没有 ⇒ 陷阱**从不派发**，
 *   陷阱副作用整体丢失）。
 * - `$callDispatch` 遇 Proxy brand → `callProxyAbs`：apply 陷阱优先、
 *   缺席回退靶；陷阱实参按原生口径 (target, thisArg, args)。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 279: Proxy [[Call]] 回退靶 + 派发 apply 陷阱", () => {
  it("无 apply 陷阱 → 回退靶的 [[Call]]（此前恒 unknown）", () => {
    expect(
      v(`export function f() {
  const p = new Proxy(function (x) { return x * 2; }, {});
  return p(21);
}`),
    ).toEqual({ ok: true, value: 42 });
  });

  it("apply 陷阱 → 派发并取其返回值", () => {
    expect(
      v(`export function f() {
  const p = new Proxy(function () {}, { apply(t, thisArg, args) { return args[0]; } });
  return p(42);
}`),
    ).toEqual({ ok: true, value: 42 });
  });

  it("apply 陷阱副作用保留（此前陷阱从未被调用）", () => {
    expect(
      v(`export function f() {
  let seen = 0;
  const p = new Proxy(function () { return 1; }, { apply() { seen = 1; return 7; } });
  const r = p();
  return String(seen) + "," + String(r);
}`),
    ).toEqual({ ok: true, value: "1,7" });
  });

  it("apply 陷阱实参口径：(target, thisArg, args)", () => {
    expect(
      v(`export function f() {
  const p = new Proxy(function () {}, { apply(t) { return typeof t; } });
  return p();
}`),
    ).toEqual({ ok: true, value: "function" });
    expect(
      v(`export function f() {
  const p = new Proxy(function () {}, { apply(t, thisArg) { return typeof thisArg; } });
  return p();
}`),
    ).toEqual({ ok: true, value: "undefined" });
    expect(
      v(`export function f() {
  const p = new Proxy(function () {}, { apply(t, thisArg, args) { return args.length; } });
  return p(1, 2, 3);
}`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("控制组：get 陷阱仍照旧派发（本次只加 apply 面）", () => {
    expect(
      v(`export function f() {
  const p = new Proxy({}, { get(t, k) { return k === "x" ? 42 : undefined; } });
  return p.x;
}`),
    ).toEqual({ ok: true, value: 42 });
  });
});
