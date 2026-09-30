/**
 * 全局转换函数 litValue 哨兵回归。
 * 回归背景：litValue(lit(undefined)) 与「无字面量」同为 undefined，
 * global.ts 用 `a0 !== undefined` 判「有字面量」——String(undefined)/
 * String()/Boolean(undefined)/Boolean()/Number(undefined)/Number()/
 * isFinite(undefined) 全部落 boolPrim/numPrim/str()（假未知）。
 * 同类：strictEqAbs / typeofAbs 已改为看 term.op === "lit"；
 * global.ts 的 String/Boolean/Number/isFinite 是同族漏网点。
 * Number 另漏 ToNumber(null)=0 与 Number(5n)=5。
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

describe("String / Boolean fold undefined literal and missing args", () => {
  it("String(undefined) is 'undefined'; String() is ''", () => {
    expect(val(`export function f() { return String(undefined); }`)).toEqual({ ok: true, value: "undefined" });
    expect(val(`export function f() { return String(); }`)).toEqual({ ok: true, value: "" });
    // 已正确的同族对照
    expect(val(`export function f() { return String(null); }`)).toEqual({ ok: true, value: "null" });
    expect(val(`export function f() { return String(true); }`)).toEqual({ ok: true, value: "true" });
    expect(val(`export function f() { return String(5n); }`)).toEqual({ ok: true, value: "5" });
  });

  it("Boolean(undefined) and Boolean() fold to false", () => {
    expect(val(`export function f() { return Boolean(undefined); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Boolean(); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Boolean(0n); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Boolean(1n); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return Boolean(null); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Boolean(0); }`)).toEqual({ ok: true, value: false });
  });
});

describe("Number folds ToNumber of all primitive literals", () => {
  it("Number(undefined) is NaN; Number() is 0", () => {
    const u = val(`export function f() { return Number(undefined); }`);
    expect(u.ok && typeof u.value).toBe("number");
    expect(Number.isNaN((u).ok ? (u).value : undefined)).toBe(true);
    expect(val(`export function f() { return Number(); }`)).toEqual({ ok: true, value: 0 });
  });

  it("Number(null) is 0; Number(5n) is 5", () => {
    expect(val(`export function f() { return Number(null); }`)).toEqual({ ok: true, value: 0 });
    expect(val(`export function f() { return Number(5n); }`)).toEqual({ ok: true, value: 5 });
    // 已正确的同族对照
    expect(val(`export function f() { return Number(true); }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { return Number(''); }`)).toEqual({ ok: true, value: 0 });
    expect(val(`export function f() { return Number('42'); }`)).toEqual({ ok: true, value: 42 });
  });
});

describe("isFinite folds explicit undefined literal", () => {
  it("isFinite(undefined) is false (same as isFinite())", () => {
    expect(val(`export function f() { return isFinite(undefined); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return isFinite(); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return isFinite(1); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return isFinite('x'); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return isFinite(null); }`)).toEqual({ ok: true, value: true });
  });
});
