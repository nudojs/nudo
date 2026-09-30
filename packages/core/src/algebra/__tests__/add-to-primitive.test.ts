/**
 * `+` / 字符串拼接 ToPrimitive / ToString 回归。
 *
 * 回归背景：JS `+` 对非原始值先 ToPrimitive（数组走 join/toString，
 * 普通对象 toString → "[object Object]"），对 undefined 走 ToString。
 * 此前 coerceToStringParts / add 混合分支完全不认 tuple/arr/obj/
 * lit(undefined)：
 *   [] + []            → unknown   （原生 ""）
 *   [1,2] + ''         → unknown   （原生 "1,2"）
 *   'x' + []           → unknown   （原生 "x"）
 *   undefined + 'x'    → unknown   （原生 "undefinedx"）
 *   {a:1} + ''         → unknown   （原生 "[object Object]"）
 *   [1] + 1            → number|string（原生 "11"，纯 string）
 *
 * 同类排查：null/bigint/boolean 字面量与 string 字面量拼接已正确；
 * 数组/对象/undefined 是同族 ToPrimitive 漏网点。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatShape,
} from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function val(src: string) {
  return litValue(call(src).result);
}

function shape(src: string) {
  return formatShape(call(src).result);
}

describe("array ToPrimitive in +", () => {
  it("[] + [] is empty string join", () => {
    expect(val(`export function f() { return [] + []; }`)).toEqual({ ok: true, value: "" });
  });

  it("array + string / string + array uses join", () => {
    expect(val(`export function f() { return [1,2] + ''; }`)).toEqual({ ok: true, value: "1,2" });
    expect(val(`export function f() { return '' + [1,2]; }`)).toEqual({ ok: true, value: "1,2" });
    expect(val(`export function f() { return 'x' + []; }`)).toEqual({ ok: true, value: "x" });
    expect(val(`export function f() { return 'x' + [1,2]; }`)).toEqual({ ok: true, value: "x1,2" });
  });

  it("array + number / number + array is string (ToPrimitive prefers string)", () => {
    expect(val(`export function f() { return [1] + 1; }`)).toEqual({ ok: true, value: "11" });
    expect(val(`export function f() { return 1 + [1]; }`)).toEqual({ ok: true, value: "11" });
    expect(val(`export function f() { return [1,2] + 3; }`)).toEqual({ ok: true, value: "1,23" });
  });

  it("array + array concatenates join results", () => {
    expect(val(`export function f() { return [1] + [2]; }`)).toEqual({ ok: true, value: "12" });
  });

  it("null/undefined elements in array join to empty", () => {
    expect(val(`export function f() { return [null] + ''; }`)).toEqual({ ok: true, value: "" });
    expect(val(`export function f() { return [undefined] + ''; }`)).toEqual({ ok: true, value: "" });
  });
});

describe("object / undefined ToString in +", () => {
  it("plain object + string is [object Object]", () => {
    expect(val(`export function f() { return {a:1} + ''; }`)).toEqual({ ok: true, value: "[object Object]", });
    expect(val(`export function f() { return '' + {a:1}; }`)).toEqual({ ok: true, value: "[object Object]", });
  });

  it("undefined + string folds ToString(undefined)", () => {
    expect(val(`export function f() { return undefined + 'x'; }`)).toEqual({ ok: true, value: "undefinedx", });
    expect(val(`export function f() { return 'x' + undefined; }`)).toEqual({ ok: true, value: "xundefined", });
    expect(val(`export function f() { return undefined + ''; }`)).toEqual({ ok: true, value: "undefined", });
    expect(val(`export function f() { return '' + undefined; }`)).toEqual({ ok: true, value: "undefined", });
  });

  it("true + array still joins (ToPrimitive array first)", () => {
    expect(val(`export function f() { return true + []; }`)).toEqual({ ok: true, value: "true" });
  });
});

describe("known-good neighbors stay exact", () => {
  it("null / bigint / boolean string concat still folds", () => {
    expect(val(`export function f() { return null + ''; }`)).toEqual({ ok: true, value: "null" });
    expect(val(`export function f() { return 10n + ''; }`)).toEqual({ ok: true, value: "10" });
    expect(val(`export function f() { return true + 'x'; }`)).toEqual({ ok: true, value: "truex" });
    expect(val(`export function f() { return 1 + 2; }`)).toEqual({ ok: true, value: 3 });
    expect(shape(`export function f() { return 'a' + 'b'; }`)).toBe('"ab"');
  });
});
