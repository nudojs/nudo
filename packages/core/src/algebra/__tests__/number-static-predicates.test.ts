/**
 * Number.is* / 全局 isNaN 谓词折叠回归。
 * 回归背景：Number.isInteger / Number.isNaN / Number.isFinite 不做 ToNumber
 * ——非 number 字面量恒 false，缺省实参也恒 false。此前只对 typeof number
 * 折叠，其余一律 boolPrim（假未知，漏报/漏折叠）。
 * 全局 isNaN 会 ToNumber：isNaN('x')===true、isNaN(true)===false、
 * isNaN(null)===false、isNaN(undefined)===true、isNaN('')===false。
 * 同类：global.ts isFinite 已按 ToNumber 处理，isNaN 是同族漏网点。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
} from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function val(src: string) {
  return litValue(call(src).result);
}

describe("Number.isInteger / isNaN / isFinite on non-number lits", () => {
  it("Number.isInteger non-numbers fold to false", () => {
    expect(val(`export function f() { return Number.isInteger('5'); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isInteger(true); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isInteger(null); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isInteger(undefined); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isInteger(); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isInteger(5n); }`)).toEqual({ ok: true, value: false });
  });

  it("Number.isInteger numbers still fold correctly", () => {
    expect(val(`export function f() { return Number.isInteger(5); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return Number.isInteger(5.5); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isInteger(NaN); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isInteger(Infinity); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isInteger(-0); }`)).toEqual({ ok: true, value: true });
  });

  it("Number.isNaN non-numbers fold to false (no coercion)", () => {
    expect(val(`export function f() { return Number.isNaN('x'); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isNaN(true); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isNaN(null); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isNaN(undefined); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isNaN(); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isNaN('NaN'); }`)).toEqual({ ok: true, value: false });
  });

  it("Number.isNaN numbers fold correctly", () => {
    expect(val(`export function f() { return Number.isNaN(NaN); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return Number.isNaN(5); }`)).toEqual({ ok: true, value: false });
  });

  it("Number.isFinite non-numbers fold to false (no coercion)", () => {
    expect(val(`export function f() { return Number.isFinite('5'); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isFinite(true); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isFinite(null); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isFinite(undefined); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isFinite(); }`)).toEqual({ ok: true, value: false });
  });

  it("Number.isFinite numbers fold correctly", () => {
    expect(val(`export function f() { return Number.isFinite(5); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return Number.isFinite(Infinity); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isFinite(NaN); }`)).toEqual({ ok: true, value: false });
  });

  it("abstract args stay abstract", () => {
    const exports = runTranspiled(
      `export function f(x) { return Number.isInteger(x); }`,
      { mode: "analyze" },
    );
    const absX = { shape: { k: "any" as const }, conf: "partial" as const };
    const r = callTranspiledExportFull(exports, "f", [absX]);
    expect(litValue(r.result)).toEqual({ ok: false });
  });

  it("f() with no args binds x to undefined → false", () => {
    // 调用 f() 时 x === undefined，Number.isInteger(undefined) 恒 false
    expect(val(`export function f(x) { return Number.isInteger(x); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Number.isInteger(undefined); }`)).toEqual({ ok: true, value: false });
  });
});

describe("global isNaN does ToNumber (unlike Number.isNaN)", () => {
  it("isNaN coerces strings/bools/null/undefined", () => {
    expect(val(`export function f() { return isNaN('x'); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return isNaN('42'); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return isNaN(''); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return isNaN(true); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return isNaN(false); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return isNaN(null); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return isNaN(undefined); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return isNaN(); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return isNaN(NaN); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return isNaN(42); }`)).toEqual({ ok: true, value: false });
  });
});
