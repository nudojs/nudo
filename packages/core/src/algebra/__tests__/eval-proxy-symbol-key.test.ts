/**
 * Bug 149：Proxy 陷阱收到的**符号键**必须是**真 symbol**（规范 PropertyKey），
 * 不是引擎内部的 "@@X" 字符串槽键投影。
 *
 * 根因：转译期把 `obj[Symbol.x]` 投影成 `$get(obj, "@@x")`（Bug 73 的内部
 * 槽键表示），陷阱派发处（runtime/containers/member.ts 的 get/set 陷阱、
 * runtime/members.ts 的 has 陷阱）把该内部表示当 PropertyKey 传出 ⇒ 按
 * symbol 分派的 handler 全部失灵（typeof k 得 "string"、String(k) 得
 * "@@iterator"、k === Symbol.iterator 恒 false）；`Symbol.iterator in p` 更
 * 是在 propertyKeyOf 对 symbol 返 undefined 处提前 return bool() ⇒ has
 * 陷阱**完全不派发**。
 *
 * 修法：符号投影键在**陷阱边界**还原成真 symbol（读侧随 $get 的
 * symbolKey 标记传递；`in` 侧按键的宿主身份反查槽键）。
 *
 * 不变量（负控制）：用户字面量字符串键 "@@iterator" 与符号键是**两个不同
 * 的 PropertyKey**——不得混叠（陷阱仍须收到字符串）。
 *
 * 已知遗留（不属本条，见报告族 02）：has/set 陷阱返回值未做 ToBoolean
 * （Bug 209）——本文件只用返回真布尔的 handler 断言，不依赖该口径。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 149: Proxy 陷阱的符号键是真 symbol（不是 \"@@X\" 串）", () => {
  it("get 陷阱：typeof k → \"symbol\"", () => {
    expect(
      v(`export function f() { const p = new Proxy({}, { get(t, k) { return typeof k; } }); return p[Symbol.iterator]; }`),
    ).toEqual({ ok: true, value: "symbol" });
  });

  it("get 陷阱：String(k) → \"Symbol(Symbol.iterator)\"", () => {
    expect(
      v(`export function f() { const p = new Proxy({}, { get(t, k) { return String(k); } }); return p[Symbol.iterator]; }`),
    ).toEqual({ ok: true, value: "Symbol(Symbol.iterator)" });
  });

  it("get 陷阱：k === Symbol.iterator → true", () => {
    expect(
      v(`export function f() { const p = new Proxy({}, { get(t, k) { return k === Symbol.iterator ? "isSym" : "notSym"; } }); return p[Symbol.iterator]; }`),
    ).toEqual({ ok: true, value: "isSym" });
  });

  it("get 陷阱：k.description → \"Symbol.iterator\"", () => {
    expect(
      v(`export function f() { const p = new Proxy({}, { get(t, k) { return k.description; } }); return p[Symbol.iterator]; }`),
    ).toEqual({ ok: true, value: "Symbol.iterator" });
  });

  it("set 陷阱：typeof k → \"symbol\"", () => {
    expect(
      v(`export function f() { let seen = ""; const p = new Proxy({}, { set(t, k, v) { seen = typeof k; return true; } }); p[Symbol.iterator] = 1; return seen; }`),
    ).toEqual({ ok: true, value: "symbol" });
  });

  it("has 陷阱：符号键**派发**且收到真 symbol", () => {
    expect(
      v(`export function f() { let seen = ""; const p = new Proxy({}, { has(t, k) { seen = typeof k; return true; } }); const r = Symbol.iterator in p; return seen + "/" + r; }`),
    ).toEqual({ ok: true, value: "symbol/true" });
  });

  it("deleteProperty / defineProperty 陷阱：符号键是真 symbol（回归钉）", () => {
    expect(
      v(`export function f() { let seen = ""; const p = new Proxy({}, { deleteProperty(t, k) { seen = typeof k; return true; } }); delete p[Symbol.iterator]; return seen; }`),
    ).toEqual({ ok: true, value: "symbol" });
    expect(
      v(`export function f() { let seen = ""; const p = new Proxy({}, { defineProperty(t, k, d) { seen = typeof k; return true; } }); Object.defineProperty(p, Symbol.iterator, { value: 1 }); return seen; }`),
    ).toEqual({ ok: true, value: "symbol" });
  });

  it("动态符号键（Symbol(\"x\")）经 $idx 路径：陷阱收到真 symbol（回归钉）", () => {
    expect(
      v(`export function f() { const s = Symbol("x"); const p = new Proxy({}, { get(t, k) { return typeof k; } }); return p[s]; }`),
    ).toEqual({ ok: true, value: "symbol" });
  });

  it("负控制：字面量字符串键 \"@@iterator\" 仍是字符串键（不得与符号键混叠）", () => {
    expect(
      v(`export function f() { const p = new Proxy({}, { get(t, k) { return typeof k; } }); return p["@@iterator"]; }`),
    ).toEqual({ ok: true, value: "string" });
  });

  it("负控制：普通字符串键仍是字符串", () => {
    expect(
      v(`export function f() { const p = new Proxy({}, { get(t, k) { return typeof k; } }); return p.plain; }`),
    ).toEqual({ ok: true, value: "string" });
  });

  it("负控制：非 Proxy 对象的符号键存在性（槽寻址按 \"@@X\" 投影）", () => {
    expect(
      v(`export function f() { const o = { [Symbol.iterator]: 1 }; return Symbol.iterator in o; }`),
    ).toEqual({ ok: true, value: true });
    expect(v(`export function f() { return Symbol.iterator in {}; }`)).toEqual({ ok: true, value: false });
    expect(v(`export function f() { return Symbol.iterator in [1]; }`)).toEqual({ ok: true, value: true });
  });
});
