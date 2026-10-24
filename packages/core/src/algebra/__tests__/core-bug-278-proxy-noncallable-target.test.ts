/**
 * Bug 278：Proxy 的 `[[Call]]` **不检查靶是否可调用** —— 代理一个不可调用
 * 靶（`{}` / `[]` / 类）时，引擎恒判「可调用」⇒ 调用不抛且**不记
 * may-throw** ⇒ 声称「永不抛」⇒ L2 `nudo:entry-may-throw` 假绿。
 *
 * 规范：ProxyCreate 只在**靶可调用**时才给代理装 `[[Call]]` 内部槽——
 * 靶不可调用时代理没有 `[[Call]]`，调用它定抛 TypeError（且**不派发**
 * apply 陷阱）。
 *
 * 修复（packages/core/src/algebra/exec/call.ts）：
 * - `$callDispatch` 遇 Proxy brand → `callProxyAbs`：先按**靶**判可调用性
 *   （callableFacetOf 三档：true / false / 不可判），false ⇒ hard NudoThrow。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 278: Proxy 靶不可调用 → 调用定抛 TypeError", () => {
  it("靶是普通对象 → throws TypeError（此前 unknown + never）", () => {
    const r = call(
      `export function f() {
  const p = new Proxy({}, {});
  return p();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("靶是数组 → throws TypeError", () => {
    const r = call(
      `export function f() {
  const p = new Proxy([], {});
  return p();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("靶是类值 → throws TypeError（类构造器不带 new 被调）", () => {
    const r = call(
      `class A {}
export function f() {
  const p = new Proxy(A, {});
  return p();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("靶不可调用 → apply 陷阱**不派发**（原生同口径）", () => {
    expect(
      v(`export function f() {
  const log = [];
  const p = new Proxy({}, { apply(t, thisArg, args) { log.push("apply"); return 1; } });
  try { p(); return "nothrow|" + log.join(","); } catch (e) { return "threw:" + e.name + "|" + log.join(","); }
}`),
    ).toEqual({ ok: true, value: "threw:TypeError|" });
  });

  it("控制组：可调用靶的代理调用正常（不抛）", () => {
    expect(
      v(`export function f() {
  const p = new Proxy(function (x) { return x * 2; }, {});
  return p(21);
}`),
    ).toEqual({ ok: true, value: 42 });
  });

  it("控制组：代理的读面正常（get 陷阱不受影响）", () => {
    expect(
      v(`export function f() {
  const p = new Proxy({ x: 1 }, {});
  return p.x;
}`),
    ).toEqual({ ok: true, value: 1 });
  });
});
