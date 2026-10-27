/**
 * Bug 95 回归：RegExp 构造面 undefined pattern 此前被字符串化为
 * "undefined"（`new RegExp(undefined).source === "undefined"`）——原生
 * undefined 折空模式（(?:)。null 保持 "null"（String(null)，非字面缺参）。
 * 修复：builtins/regexp.ts 构造分支 pv === undefined 折 ""。
 * 注意：String.prototype.search/match/matchAll 的 undefined pattern 折空
 * 模式在 exec/regexp-runtime.ts（另一半修复面，独立批次）。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

describe("Bug 95：RegExp 构造 undefined pattern 折空模式", () => {
  it("new RegExp(undefined).source === '(?:)'（void 0 同）", () => {
    expect(val(`export function f() { return new RegExp(undefined).source; }`)).toEqual({
      ok: true,
      value: "(?:)",
    });
    expect(val(`export function f() { return new RegExp(void 0).source; }`)).toEqual({
      ok: true,
      value: "(?:)",
    });
  });

  it("new RegExp(undefined) 语义：空模式匹配任意字符串", () => {
    expect(val(`export function f() { return new RegExp(undefined).test("x"); }`)).toEqual({
      ok: true,
      value: true,
    });
    expect(val(`export function f() { return new RegExp(undefined).test(""); }`)).toEqual({
      ok: true,
      value: true,
    });
    expect(val(`export function f() { return new RegExp(undefined).flags; }`)).toEqual({
      ok: true,
      value: "",
    });
  });

  it("undefined pattern + flags 正交", () => {
    expect(val(`export function f() { return new RegExp(undefined, "g").source; }`)).toEqual({
      ok: true,
      value: "(?:)",
    });
    expect(val(`export function f() { return new RegExp(undefined, "g").global; }`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("controls：无参 / null / 'undefined' / 字面量互不混淆", () => {
    // 无参构造 === undefined pattern === 空模式
    expect(val(`export function f() { return new RegExp().source; }`)).toEqual({
      ok: true,
      value: "(?:)",
    });
    // null 按原生 String(null) 字面量化为 "null"
    expect(val(`export function f() { return new RegExp(null).source; }`)).toEqual({
      ok: true,
      value: "null",
    });
    expect(val(`export function f() { return new RegExp(null).test("null"); }`)).toEqual({
      ok: true,
      value: true,
    });
    expect(val(`export function f() { return new RegExp("undefined").source; }`)).toEqual({
      ok: true,
      value: "undefined",
    });
    expect(val(`export function f() { return new RegExp("a").source; }`)).toEqual({
      ok: true,
      value: "a",
    });
    // undefined flags 折无 flags
    expect(val(`export function f() { return new RegExp("a", undefined).source; }`)).toEqual({
      ok: true,
      value: "a",
    });
  });
});
