/**
 * 一元负号 / parseInt / parseFloat 的 ToNumber·ToInt32 折叠回归。
 * 回归背景：negAbs 只折 typeof number|bigint——`-'5'` / `-true` / `-null`
 * 落 unknown（原生 -5 / -1 / -0）。同类：unary + 与 ~ 已走 coercibleNumberLit，
 * 一元负号是同族漏网点。
 * parseInt / parseFloat 只认 typeof string|number 首参，radix 只认 number——
 * `parseInt('10','2')` / `parseInt('10',true)` / `parseFloat(true)` 落 numPrim。
 * 原生对 radix 做 ToInt32（'2'→2、true→1 越界 NaN、null/false/''/NaN→0 视为未提供），
 * 对首参做 ToString 再解析。同类：string index / Math 已按 ToNumber 折叠，
 * 这里是同族漏网点。
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

describe("unary minus honors ToNumber on coercible literals", () => {
  it("-'5' / -true / -null fold like native", () => {
    expect(val(`export function f() { return -'5'; }`)).toEqual({ ok: true, value: -5 });
    expect(val(`export function f() { return -true; }`)).toEqual({ ok: true, value: -1 });
    const n = val(`export function f() { return -null; }`);
    expect(n.ok && Object.is(n.value, -0)).toBe(true);
  });

  it("number literals and unary + / ~ already work (regression guard)", () => {
    expect(val(`export function f() { return -5; }`)).toEqual({ ok: true, value: -5 });
    expect(val(`export function f() { return +true; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { return +null; }`)).toEqual({ ok: true, value: 0 });
    expect(val(`export function f() { return ~'5'; }`)).toEqual({ ok: true, value: -6 });
    expect(val(`export function f() { return ~true; }`)).toEqual({ ok: true, value: -2 });
    expect(val(`export function f() { return ~null; }`)).toEqual({ ok: true, value: -1 });
  });
});

describe("parseInt radix goes through ToInt32", () => {
  it("numeric-string / bool / null / false / empty-string radix", () => {
    expect(val(`export function f() { return parseInt('10', '2'); }`)).toEqual({ ok: true, value: 2 });
    // ToInt32(true)=1 → 越界 → NaN
    const t = val(`export function f() { return parseInt('10', true); }`);
    expect(t.ok && typeof t.value).toBe("number");
    expect(Number.isNaN((t).ok ? (t).value : undefined)).toBe(true);
    // ToInt32(null)=0 / false=0 / ''=0 / NaN=0 → 视为未提供
    expect(val(`export function f() { return parseInt('10', null); }`)).toEqual({ ok: true, value: 10 });
    expect(val(`export function f() { return parseInt('10', false); }`)).toEqual({ ok: true, value: 10 });
    expect(val(`export function f() { return parseInt('08', ''); }`)).toEqual({ ok: true, value: 8 });
    expect(val(`export function f() { return parseInt('0x10', 0); }`)).toEqual({ ok: true, value: 16 });
  });

  it("Number.parseInt shares the same radix coercion", () => {
    expect(val(`export function f() { return Number.parseInt('10', '2'); }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { return Number.parseInt('10', null); }`)).toEqual({ ok: true, value: 10 });
    // 已正确的 number radix 对照
    expect(val(`export function f() { return parseInt('10', 2); }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { return parseInt('10', 2.9); }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { return parseInt('0x10'); }`)).toEqual({ ok: true, value: 16 });
  });
});

describe("parseInt / parseFloat first arg ToString then parse", () => {
  it("bool / null / undefined / bigint first args", () => {
    // ToString(true)='true' → parseInt 得 NaN
    const p = val(`export function f() { return parseInt(true); }`);
    expect(p.ok && Number.isNaN(p.value as number)).toBe(true);
    const n = val(`export function f() { return parseInt(null); }`);
    expect(Number.isNaN((n).ok ? (n).value : undefined)).toBe(true);
    const u = val(`export function f() { return parseInt(undefined); }`);
    expect(Number.isNaN((u).ok ? (u).value : undefined)).toBe(true);
    expect(val(`export function f() { return parseInt(5n); }`)).toEqual({ ok: true, value: 5 });

    expect(Number.isNaN((val(`export function f() { return parseFloat(true); }`)).ok ? (val(`export function f() { return parseFloat(true); }`)).value : undefined)).toBe(true);
    expect(Number.isNaN((val(`export function f() { return parseFloat(null); }`)).ok ? (val(`export function f() { return parseFloat(null); }`)).value : undefined)).toBe(true);
    expect(Number.isNaN((val(`export function f() { return parseFloat(undefined); }`)).ok ? (val(`export function f() { return parseFloat(undefined); }`)).value : undefined)).toBe(true);
    expect(val(`export function f() { return parseFloat(5n); }`)).toEqual({ ok: true, value: 5 });
  });

  it("string / number first args stay exact", () => {
    expect(val(`export function f() { return parseInt('10'); }`)).toEqual({ ok: true, value: 10 });
    expect(val(`export function f() { return parseFloat('3.5'); }`)).toEqual({ ok: true, value: 3.5 });
    expect(val(`export function f() { return parseFloat(3.5); }`)).toEqual({ ok: true, value: 3.5 });
    expect(val(`export function f() { return Number.parseFloat(true); }`)).toEqual({ ok: true, value: NaN });
  });
});
