/**
 * JSON.stringify space 实参的 ToIntegerOrInfinity / min(10,·) 语义。
 *
 * 回归背景：evalJsonMethod 对 number space 预处理成
 * `Number.isFinite(sv) ? Math.min(10, Math.max(0, Math.floor(sv))) : 0`，
 * 与原生不一致：
 *   JSON.stringify({a:1}, null, Infinity)  原生 10 空格，引擎 0（紧凑）
 *   JSON.stringify({a:1}, null, 0.1)       原生换行+空 indent，引擎紧凑
 *   JSON.stringify({a:1}, null, 5e-324)    同上
 *
 * 规范（ES JSON.stringify）：
 *   space 为 Number → spaceCount = ToIntegerOrInfinity(space); space = min(10, spaceCount)
 *   随后 gap 非空 **或** 原 space 为正数（含 (0,1)）→ pretty-print
 *   Infinity → min(10, Inf) = 10；0 / -0 / 负数 → 紧凑
 *
 * 修法：number space 原样交给宿主 JSON.stringify（其内部即规范算法），
 * 不再 isFinite/floor/max 预折——那是同族 ToIntegerOrInfinity 漏网点。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function val(src: string) {
  return litValue(call(src).result);
}

describe("JSON.stringify number space is min(10, ToIntegerOrInfinity(space))", () => {
  it("Infinity space pretty-prints with 10 spaces (not compact)", () => {
    expect(val(`export function f() { return JSON.stringify({a:1}, null, Infinity); }`)).toEqual({ ok: true, value: '{\n          "a": 1\n}', });
  });

  it("-Infinity stays compact (min(10, -Inf) unused → empty gap)", () => {
    expect(val(`export function f() { return JSON.stringify({a:1}, null, -Infinity); }`)).toEqual({ ok: true, value: '{"a":1}', });
  });

  it("positive fraction in (0,1) pretty-prints with empty indent", () => {
    // ToIntegerOrInfinity(0.1)=0，但原 space>0 仍走 pretty（换行、indent=""）
    expect(val(`export function f() { return JSON.stringify({a:1}, null, 0.1); }`)).toEqual({ ok: true, value: '{\n"a": 1\n}', });
    expect(val(`export function f() { return JSON.stringify({a:1}, null, 5e-324); }`)).toEqual({ ok: true, value: '{\n"a": 1\n}', });
  });

  it("0 / -0 / negatives stay compact", () => {
    expect(val(`export function f() { return JSON.stringify({a:1}, null, 0); }`)).toEqual({ ok: true, value: '{"a":1}' });
    expect(val(`export function f() { return JSON.stringify({a:1}, null, -0); }`)).toEqual({ ok: true, value: '{"a":1}' });
    expect(val(`export function f() { return JSON.stringify({a:1}, null, -3); }`)).toEqual({ ok: true, value: '{"a":1}' });
    expect(val(`export function f() { return JSON.stringify({a:1}, null, -0.5); }`)).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("finite ints and fractions above 1 still clamp / floor correctly", () => {
    expect(val(`export function f() { return JSON.stringify({a:1}, null, 2); }`)).toEqual({ ok: true, value: '{\n  "a": 1\n}', });
    expect(val(`export function f() { return JSON.stringify({a:1}, null, 2.7); }`)).toEqual({ ok: true, value: '{\n  "a": 1\n}', });
    expect(val(`export function f() { return JSON.stringify({a:1}, null, 100); }`)).toEqual({ ok: true, value: '{\n          "a": 1\n}', });
    expect(val(`export function f() { return JSON.stringify({a:1}, null, 10.9); }`)).toEqual({ ok: true, value: '{\n          "a": 1\n}', });
  });

  it("string space still takes the first 10 code units (host handles it)", () => {
    expect(val(`export function f() { return JSON.stringify({a:1}, null, '1234567890123'); }`)).toEqual({ ok: true, value: '{\n1234567890"a": 1\n}', });
    expect(val(`export function f() { return JSON.stringify({a:1}, null, '\\t'); }`)).toEqual({ ok: true, value: '{\n\t"a": 1\n}', });
  });
});
