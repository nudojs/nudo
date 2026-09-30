/**
 * 关系比较 lit(undefined) 折叠回归。
 * 回归背景：cmp() 用 litValue 哨兵判「有字面量」，lit(undefined) 与
 * 「无字面量」同为 undefined——`undefined < 1` 一概落 boolean+约束
 * `where undefined < 1`（假约束）。原生 ToNumber(undefined)=NaN，
 * 一切关系比较恒 false：undefined<1 / 1>undefined / undefined<undefined。
 * 同类：global-convert-undefined-lit 已修 String/Boolean/Number 的
 * litValue 哨兵；比较折叠是同族漏网点。null 走 litValue 得 null（非
 * undefined），对照已正确。
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

describe("relational compare folds lit(undefined) to false", () => {
  it("undefined on either side of < > <= >=", () => {
    expect(val(`export function f() { return undefined < 1; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return undefined > 1; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return undefined <= 1; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return undefined >= 1; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return 1 < undefined; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return 1 > undefined; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return 1 <= undefined; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return 1 >= undefined; }`)).toEqual({ ok: true, value: false });
  });

  it("undefined vs undefined / null vs undefined", () => {
    expect(val(`export function f() { return undefined < undefined; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return undefined > undefined; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return undefined <= undefined; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return undefined >= undefined; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return null < undefined; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return null > undefined; }`)).toEqual({ ok: true, value: false });
  });

  it("null relational compare already correct (control)", () => {
    expect(val(`export function f() { return null < 1; }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return null > 1; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return null <= 0; }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return null >= 0; }`)).toEqual({ ok: true, value: true });
  });

  it("string/bool/NaN relational compare already correct (control)", () => {
    expect(val(`export function f() { return 'a' < 1; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return '' < 1; }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return true < 2; }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return NaN < 1; }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return NaN > 1; }`)).toEqual({ ok: true, value: false });
  });
});
