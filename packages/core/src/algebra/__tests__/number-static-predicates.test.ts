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
    expect(val(`export function f() { return Number.isInteger('5'); }`)).toBe(false);
    expect(val(`export function f() { return Number.isInteger(true); }`)).toBe(false);
    expect(val(`export function f() { return Number.isInteger(null); }`)).toBe(false);
    expect(val(`export function f() { return Number.isInteger(undefined); }`)).toBe(false);
    expect(val(`export function f() { return Number.isInteger(); }`)).toBe(false);
    expect(val(`export function f() { return Number.isInteger(5n); }`)).toBe(false);
  });

  it("Number.isInteger numbers still fold correctly", () => {
    expect(val(`export function f() { return Number.isInteger(5); }`)).toBe(true);
    expect(val(`export function f() { return Number.isInteger(5.5); }`)).toBe(false);
    expect(val(`export function f() { return Number.isInteger(NaN); }`)).toBe(false);
    expect(val(`export function f() { return Number.isInteger(Infinity); }`)).toBe(false);
    expect(val(`export function f() { return Number.isInteger(-0); }`)).toBe(true);
  });

  it("Number.isNaN non-numbers fold to false (no coercion)", () => {
    expect(val(`export function f() { return Number.isNaN('x'); }`)).toBe(false);
    expect(val(`export function f() { return Number.isNaN(true); }`)).toBe(false);
    expect(val(`export function f() { return Number.isNaN(null); }`)).toBe(false);
    expect(val(`export function f() { return Number.isNaN(undefined); }`)).toBe(false);
    expect(val(`export function f() { return Number.isNaN(); }`)).toBe(false);
    expect(val(`export function f() { return Number.isNaN('NaN'); }`)).toBe(false);
  });

  it("Number.isNaN numbers fold correctly", () => {
    expect(val(`export function f() { return Number.isNaN(NaN); }`)).toBe(true);
    expect(val(`export function f() { return Number.isNaN(5); }`)).toBe(false);
  });

  it("Number.isFinite non-numbers fold to false (no coercion)", () => {
    expect(val(`export function f() { return Number.isFinite('5'); }`)).toBe(false);
    expect(val(`export function f() { return Number.isFinite(true); }`)).toBe(false);
    expect(val(`export function f() { return Number.isFinite(null); }`)).toBe(false);
    expect(val(`export function f() { return Number.isFinite(undefined); }`)).toBe(false);
    expect(val(`export function f() { return Number.isFinite(); }`)).toBe(false);
  });

  it("Number.isFinite numbers fold correctly", () => {
    expect(val(`export function f() { return Number.isFinite(5); }`)).toBe(true);
    expect(val(`export function f() { return Number.isFinite(Infinity); }`)).toBe(false);
    expect(val(`export function f() { return Number.isFinite(NaN); }`)).toBe(false);
  });

  it("abstract args stay abstract", () => {
    const exports = runTranspiled(
      `export function f(x) { return Number.isInteger(x); }`,
      { mode: "analyze" },
    );
    const absX = { shape: { k: "any" as const }, conf: "partial" as const };
    const r = callTranspiledExportFull(exports, "f", [absX]);
    expect(litValue(r.result)).toBeUndefined();
  });

  it("f() with no args binds x to undefined → false", () => {
    // 调用 f() 时 x === undefined，Number.isInteger(undefined) 恒 false
    expect(val(`export function f(x) { return Number.isInteger(x); }`)).toBe(false);
    expect(val(`export function f() { return Number.isInteger(undefined); }`)).toBe(false);
  });
});

describe("global isNaN does ToNumber (unlike Number.isNaN)", () => {
  it("isNaN coerces strings/bools/null/undefined", () => {
    expect(val(`export function f() { return isNaN('x'); }`)).toBe(true);
    expect(val(`export function f() { return isNaN('42'); }`)).toBe(false);
    expect(val(`export function f() { return isNaN(''); }`)).toBe(false);
    expect(val(`export function f() { return isNaN(true); }`)).toBe(false);
    expect(val(`export function f() { return isNaN(false); }`)).toBe(false);
    expect(val(`export function f() { return isNaN(null); }`)).toBe(false);
    expect(val(`export function f() { return isNaN(undefined); }`)).toBe(true);
    expect(val(`export function f() { return isNaN(); }`)).toBe(true);
    expect(val(`export function f() { return isNaN(NaN); }`)).toBe(true);
    expect(val(`export function f() { return isNaN(42); }`)).toBe(false);
  });
});
