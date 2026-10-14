/**
 * Bug 57/71：Proxy target/handler 保留。修复前 makeProxyAbs 丢弃两者——
 * `Array.isArray(new Proxy([], {}))` 假 false（Bug 57）、读折 undefined/NaN、
 * `in` 假 false、赋值绕过 set 陷阱、陷阱返回 false 不抛（Bug 71）。
 * 修复：brand inner = target Abs + match-iter 侧表挂 handler；get/has/set
 * 陷阱经 $call 派发（this = handler、首参 target），无陷阱回退靶语义。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 57: Array.isArray 看穿 Proxy 到靶形态", () => {
  it("new Proxy([], {}) → true", () => {
    expect(v(`export function f() { return Array.isArray(new Proxy([], {})); }`)).toEqual({ ok: true, value: true });
  });

  it("new Proxy(new Array(3), {}) → true", () => {
    expect(v(`export function f() { return Array.isArray(new Proxy(new Array(3), {})); }`)).toEqual({ ok: true, value: true });
  });

  it("非数组靶控制：new Proxy({}, {}) → false", () => {
    expect(v(`export function f() { return Array.isArray(new Proxy({}, {})); }`)).toEqual({ ok: true, value: false });
  });

  it("靶派生读：p.length + p[0] → 3（不再 NaN/unknown）", () => {
    expect(v(`export function f() { const p = new Proxy([1, 2], {}); return p.length + p[0]; }`)).toEqual({ ok: true, value: 3 });
  });
});

describe("Bug 71: in / 成员读 / 赋值走陷阱或靶", () => {
  it("\"a\" in new Proxy({a:1}, {}) → true（无陷阱回退靶包含）", () => {
    expect(v(`export function f() { const p = new Proxy({ a: 1 }, {}); return "a" in p; }`)).toEqual({ ok: true, value: true });
  });

  it("has 陷阱：{ has() { return true; } } → true", () => {
    expect(v(`export function f() { const p = new Proxy({}, { has() { return true; } }); return "x" in p; }`)).toEqual({ ok: true, value: true });
  });

  it("控制：\"toString\" in p → true（Object.prototype 面）", () => {
    expect(v(`export function f() { const p = new Proxy({}, {}); return "toString" in p; }`)).toEqual({ ok: true, value: true });
  });

  it("无陷阱读：new Proxy({a:1},{}).a + 1 → 2", () => {
    expect(v(`export function f() { return new Proxy({ a: 1 }, {}).a + 1; }`)).toEqual({ ok: true, value: 2 });
  });

  it("get 陷阱：q.a + 1 → 2；字符串陷阱拼接 \"ss\"", () => {
    expect(v(`export function f() { const q = new Proxy({}, { get(t, k) { return 1; } }); return q.a + 1; }`)).toEqual({ ok: true, value: 2 });
    expect(v(`export function f() { const q = new Proxy({}, { get() { return "s"; } }); return q.a + q.b; }`)).toEqual({ ok: true, value: "ss" });
  });

  it("下标读走 get 陷阱：p[1] → 9", () => {
    expect(v(`export function f() { const p = new Proxy([1, 2], { get(t, k) { return 9; } }); return p[1]; }`)).toEqual({ ok: true, value: 9 });
  });

  it("set 陷阱：r.x = 5 落靶翻倍，r.x → 10", () => {
    expect(v(`export function f() { const r = new Proxy({}, { set(t, k, v) { t[k] = v * 2; return true; } }); r.x = 5; return r.x; }`)).toEqual({ ok: true, value: 10 });
  });

  it("set 陷阱返回字面量 false → strict TypeError（硬抛，catch 可吸收）", () => {
    const r = call(`export function f() { const r = new Proxy({}, { set() { return false; } }); r.x = 5; return "no-throw"; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    // catch 吸收后继续
    expect(v(`export function f() { const r = new Proxy({}, { set() { return false; } }); try { r.x = 5; } catch (e) { return "caught"; } return "ok"; }`)).toEqual({ ok: true, value: "caught" });
  });

  it("组合 get+set 陷阱：转发读 + 翻倍写 → 2", () => {
    expect(v(`export function f() { const p = new Proxy({}, { get(t, k) { return t[k]; }, set(t, k, v) { t[k] = v * 2; return true; } }); p.x = 1; return p.x; }`)).toEqual({ ok: true, value: 2 });
  });

  it("下标写走 set 陷阱：p[0] = 5 → 读回 10", () => {
    expect(v(`export function f() { const p = new Proxy([1, 2], { set(t, k, v) { t[k] = v * 2; return true; } }); p[0] = 5; return p[0]; }`)).toEqual({ ok: true, value: 10 });
  });

  it("控制：new Proxy(1, {}) / new Proxy({}, null) → definite TypeError（Bug 37）", () => {
    expect(throwsError(call(`export function f() { return new Proxy(1, {}); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(call(`export function f() { return new Proxy({}, null); }`).throws, "TypeError")).toBe(true);
  });
});
