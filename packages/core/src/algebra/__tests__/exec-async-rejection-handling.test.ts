/**
 * async 函数拒绝域回归（F2 家族）：
 * - 体 throw 不同步抛调用点：调用恒返回 promise，体抛错 ⇒ 确定拒绝
 *   （inner=never + rejected 通道）。此前 NudoThrow 直接穿透 $async 调用点，
 *   被 .catch 处理的拒绝也变成 caller throw（差分 knownFalseThrows 项）。
 * - await 确定拒绝的 promise：体内抛 reason（原生 reject → await throw），
 *   不得折假精确 resolved 值；try/catch 内由既有 catch 机制吸收。
 * - async 体 `return <promise>`：原生递归采纳 thenable，不假嵌套
 *   promise<promise<…>>。
 * 每条断言与 Node 真实执行对齐（值域 + throws 域双钉）。
 */
import { describe, it, expect } from "vitest";
import { call, val, isNever } from "./eval-helpers.ts";
import { formatShape } from "../format.ts";
import { $await } from "../exec/runtime/async.ts";
import { litValue } from "../abs.ts";

describe("async rejection does not surface as caller throw", () => {
  it("handled .catch rejection stays out of the sync result (F2)", () => {
    const src = `export function f() {
async function h() { throw new Error('boom'); }
let m = '';
h().catch(e => { m = e.message; });
return m;
}`;
    const r = call(src, "f");
    expect(val(src, [])).toEqual({ ok: true, value: "" });
    expect(isNever(r.throws)).toBe(true);
  });

  it("handled two-arg .then onRejected stays out of the sync result", () => {
    const src = `export function f() {
async function h() { throw new Error('boom'); }
let m = '';
h().then(v => { m = 'v'; }, e => { m = 'e'; });
return m;
}`;
    const r = call(src, "f");
    expect(val(src, [])).toEqual({ ok: true, value: "" });
    expect(isNever(r.throws)).toBe(true);
  });

  it("async call itself returns a promise object, never a throw", () => {
    const src = `export function f() {
async function h() { throw new Error('boom'); }
return typeof h();
}`;
    const r = call(src, "f");
    expect(val(src, [])).toEqual({ ok: true, value: "object" });
    expect(isNever(r.throws)).toBe(true);
  });

  it("unhandled rejection policy unchanged: value path not disturbed", () => {
    const src = `export function f() {
async function h() { throw new Error('boom'); }
let m = '';
h().catch(e => { m = 'x'; });
h();
return 1;
}`;
    const r = call(src, "f");
    expect(val(src, [])).toEqual({ ok: true, value: 1 });
    expect(isNever(r.throws)).toBe(true);
  });

  it("rejected promise carries reason on the rejected channel", () => {
    const src = `export function f() {
async function h() { throw new Error('boom'); }
return h();
}`;
    const r = call(src, "f");
    // promise<never>：fulfilled 臂不可能；rejected 通道携带 reason
    expect(formatShape(r.result)).toContain("promise<never>");
    expect(isNever(r.throws)).toBe(true);
  });
});

describe("await of definite-rejected promise", () => {
  it("awaits reject the async chain instead of folding a resolved value", () => {
    const src = `export function f() {
async function h() { throw new Error('boom'); }
async function g() { await h(); return 'no'; }
return g();
}`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toContain("promise<never>");
    expect(isNever(r.throws)).toBe(true);
  });

  it("try/catch around await recovers the reason path", () => {
    const src = `export function f() {
async function h() { throw new Error('boom'); }
async function g() { try { await h(); } catch (e) { return 'caught'; } return 'no'; }
return g();
}`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toContain("caught");
    expect(isNever(r.throws)).toBe(true);
  });

  it("await Promise.reject rejects the chain", () => {
    const src = `export function f() {
async function g() { await Promise.reject(new Error('x')); return 'no'; }
return g();
}`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toContain("promise<never>");
    expect(isNever(r.throws)).toBe(true);
  });

  it("await Promise.reject inside try/catch recovers", () => {
    const src = `export function f() {
async function g() { try { await Promise.reject(new Error('x')); } catch { return 'caught'; } return 'no'; }
return g();
}`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toContain("caught");
    expect(isNever(r.throws)).toBe(true);
  });
});

describe("async return of a promise adopts it", () => {
  it("return h() of a rejected async call is rejected, not nested", () => {
    const src = `export function f() {
async function h() { throw new Error('boom'); }
async function g() { return h(); }
return g();
}`;
    const r = call(src, "f");
    const s = formatShape(r.result);
    expect(s).toContain("promise<never>");
    expect(s).not.toContain("promise<promise");
    expect(isNever(r.throws)).toBe(true);
  });

  it("return Promise.resolve(v) adopts the resolved value", () => {
    const src = `export function f() {
async function g() { return Promise.resolve(5); }
return g();
}`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 5 });
  });

  it("plain async return still wraps as promise", () => {
    const src = `export function f() {
async function g() { return 5; }
return g();
}`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 5 });
  });
});
