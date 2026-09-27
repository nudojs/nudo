/**
 * Math.* 字面量折叠回归。
 * 回归背景：evalMathMethod 只认 typeof number 实参——Math.abs('3')/
 * Math.floor('3.7')/Math.sign(true)/Math.pow('2','3') 等一概 numPrim
 * （原生 ToNumber 后可精确折叠）。Math.min()/Math.max() 空实参原生为
 * ±Infinity，此前落 numPrim。trunc/hypot/imul/cbrt/log2 等未建模方法
 * 一律 unknown，字面量实参本可精确折叠。
 * 同类：string index methods 已按 ToNumber 折叠位置实参；Math 是同族漏网点。
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

describe("Math unary/binary methods honor ToNumber on literal args", () => {
  it("Math.abs / floor / ceil / round / sqrt / sign coerce", () => {
    expect(val(`export function f() { return Math.abs('3'); }`)).toBe(3);
    expect(val(`export function f() { return Math.abs('-3'); }`)).toBe(3);
    expect(val(`export function f() { return Math.floor('3.7'); }`)).toBe(3);
    expect(val(`export function f() { return Math.ceil(true); }`)).toBe(1);
    expect(val(`export function f() { return Math.round('2.5'); }`)).toBe(3);
    expect(val(`export function f() { return Math.sqrt('4'); }`)).toBe(2);
    expect(val(`export function f() { return Math.sign('-3'); }`)).toBe(-1);
    expect(val(`export function f() { return Math.sign(true); }`)).toBe(1);
    expect(val(`export function f() { return Math.sign(null); }`)).toBe(0);
  });

  it("Math.pow / atan2 coerce both args", () => {
    expect(val(`export function f() { return Math.pow('2','3'); }`)).toBe(8);
    expect(val(`export function f() { return Math.pow(true, 2); }`)).toBe(1);
    expect(val(`export function f() { return Math.atan2(1, 1); }`)).toBeCloseTo(Math.PI / 4);
    expect(val(`export function f() { return Math.atan2('1', '1'); }`)).toBeCloseTo(Math.PI / 4);
  });

  it("already-working number-literal folds stay exact", () => {
    expect(val(`export function f() { return Math.abs(-5); }`)).toBe(5);
    expect(val(`export function f() { return Math.floor(3.7); }`)).toBe(3);
    expect(val(`export function f() { return Math.pow(2, 10); }`)).toBe(1024);
    expect(val(`export function f() { return Math.min(3, -1, 2); }`)).toBe(-1);
  });
});

describe("Math.min / Math.max empty args and ToNumber elements", () => {
  it("Math.min() is Infinity; Math.max() is -Infinity", () => {
    expect(val(`export function f() { return Math.min(); }`)).toBe(Infinity);
    expect(val(`export function f() { return Math.max(); }`)).toBe(-Infinity);
  });

  it("min/max coerce mixed literal args", () => {
    expect(val(`export function f() { return Math.max(1,'2',3); }`)).toBe(3);
    expect(val(`export function f() { return Math.min(1,'2',3); }`)).toBe(1);
    expect(val(`export function f() { return Math.max(true, null, 2); }`)).toBe(2);
  });
});

describe("Math unmodeled methods fold number literals", () => {
  it("trunc / cbrt / hypot / imul / log2 / log10 / exp / clz32 / fround", () => {
    expect(val(`export function f() { return Math.trunc(4.9); }`)).toBe(4);
    expect(val(`export function f() { return Math.trunc(-4.9); }`)).toBe(-4);
    expect(val(`export function f() { return Math.cbrt(27); }`)).toBe(3);
    expect(val(`export function f() { return Math.hypot(3, 4); }`)).toBe(5);
    expect(val(`export function f() { return Math.imul(3, 4); }`)).toBe(12);
    expect(val(`export function f() { return Math.log2(8); }`)).toBe(3);
    expect(val(`export function f() { return Math.log10(1000); }`)).toBe(3);
    expect(val(`export function f() { return Math.exp(0); }`)).toBe(1);
    expect(val(`export function f() { return Math.clz32(1); }`)).toBe(31);
    expect(val(`export function f() { return Math.fround(1.337); }`)).toBe(Math.fround(1.337));
  });

  it("unmodeled methods also coerce literal args", () => {
    expect(val(`export function f() { return Math.trunc('3.9'); }`)).toBe(3);
    expect(val(`export function f() { return Math.hypot('3', '4'); }`)).toBe(5);
    expect(val(`export function f() { return Math.imul(true, 4); }`)).toBe(4);
  });

  it("inherited non-Math methods are not folded (constructor/toString)", () => {
    // Object.hasOwn 白名单：Math.constructor / Math.toString 不是数值算子
    const exports = runTranspiled(
      `export function f(n) { return Math[n](1); }`,
      { mode: "analyze" },
    );
    // 抽象方法名 → 不折
    const absN = { shape: { k: "any" as const }, conf: "partial" as const };
    const r = callTranspiledExportFull(exports, "f", [absN as never]);
    expect(litValue(r.result)).toBeUndefined();
  });

  it("Math.constructor / Math.toString are not treated as numeric folds", async () => {
    const { evalMathMethod } = await import("../builtins/math.ts");
    expect(evalMathMethod("constructor", [])).toBeUndefined();
    expect(evalMathMethod("toString", [])).toBeUndefined();
    expect(evalMathMethod("valueOf", [])).toBeUndefined();
    expect(evalMathMethod("abs", [])).toBeDefined();
    expect(evalMathMethod("random", [])).toBeDefined();
  });
});
