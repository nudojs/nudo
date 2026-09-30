/**
 * ToPropertyKey 回归：计算键 `o[k]` / `k in o` / `delete o[k]` / `o[k]=v`
 * 对 null / undefined / boolean 字面量必须走 ToString：
 *   o[null] ≡ o["null"]，o[undefined] ≡ o["undefined"]，o[true] ≡ o["true"]
 *
 * 回归背景：$idx 用 litValue(i) 取键——lit(undefined) 被哨兵吞成「无 lit」，
 * 落进「抽象下标 → join 全部元素」；null/boolean 非 string|number 也被当成
 * 未知键。$in 对 null/undefined 键直接返回 unknown（注释误写「原生抛
 * TypeError」——原生是 ToPropertyKey 成 "null"/"undefined"）。
 * $del 的 keyStr 只认 string|number，漏掉 boolean/null/undefined。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatAbs } from "@nudojs/core";

function run(src: string) {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  return callTranspiledExportFull(exports, "f", []);
}

function val(src: string) {
  return litValue(run(src).result);
}

function fmt(src: string) {
  return formatAbs(run(src).result);
}

describe("ToPropertyKey for null/undefined/boolean computed keys", () => {
  it("o[null] reads key 'null'", () => {
    expect(val(`export function f() { const o = { null: 1 }; return o[null]; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const o = { a: 1 }; return o[null]; }`)).toEqual({ ok: true, value: undefined });
  });

  it("o[undefined] reads key 'undefined' (not join-all)", () => {
    expect(val(`export function f() { const o = { undefined: 1 }; return o[undefined]; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const o = { a: 1 }; return o[undefined]; }`)).toEqual({ ok: true, value: undefined });
  });

  it("array a[undefined] is a[\"undefined\"] → undefined, not join of elements", () => {
    expect(val(`export function f() { const a = [1,2,3]; return a[undefined]; }`)).toEqual({ ok: true, value: undefined });
    expect(val(`export function f() { const a = [1,2,3]; return a[null]; }`)).toEqual({ ok: true, value: undefined });
  });

  it("null / undefined / boolean in operator uses ToPropertyKey", () => {
    expect(val(`export function f() { const o = { null: 1 }; return null in o; }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { const o = { undefined: 1 }; return undefined in o; }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { const o = { true: 1 }; return true in o; }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { const o = { a: 1 }; return null in o; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { const o = { a: 1 }; return undefined in o; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { const a = [1,2]; return undefined in a; }`)).toEqual({ ok: true, value: false });
  });

  it("delete o[null|undefined|true] removes the string key", () => {
    expect(val(`export function f() {
      const o = { null: 1 }; delete o[null]; return o["null"];
    }`)).toEqual({ ok: true, value: undefined });
    expect(val(`export function f() {
      const o = { undefined: 1 }; delete o[undefined]; return o["undefined"];
    }`)).toEqual({ ok: true, value: undefined });
    expect(val(`export function f() {
      const o = { true: 1 }; delete o[true]; return o["true"];
    }`)).toEqual({ ok: true, value: undefined });
  });

  it("o[undefined]=v writes key 'undefined'", () => {
    expect(val(`export function f() {
      const o = {}; o[undefined] = 5; return o["undefined"];
    }`)).toEqual({ ok: true, value: 5 });
    expect(val(`export function f() {
      const o = {}; o[null] = 5; return o["null"];
    }`)).toEqual({ ok: true, value: 5 });
    expect(val(`export function f() {
      const o = {}; o[true] = 5; return o["true"];
    }`)).toEqual({ ok: true, value: 5 });
  });

  it("string s[undefined] is s['undefined'] → undefined", () => {
    expect(val(`export function f() { const s = "abc"; return s[undefined]; }`)).toEqual({ ok: true, value: undefined });
    expect(val(`export function f() { const s = "abc"; return s[null]; }`)).toEqual({ ok: true, value: undefined });
    expect(val(`export function f() { const s = "abc"; return s[true]; }`)).toEqual({ ok: true, value: undefined });
  });
});
