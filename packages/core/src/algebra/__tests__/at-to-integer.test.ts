/**
 * `.at()` ToIntegerOrInfinity / 缺省实参折叠回归。
 *
 * 回归背景：
 * 1. String.prototype.at 完全未接管（`'hello'.at(0)` → unknown），
 *    而 charAt/slice 已按 ToIntegerOrInfinity 折叠——at 是同族漏网点。
 * 2. Array.prototype.at 只认 Number.isInteger 字面量；缺省/undefined/
 *    null/true/'1'/1.9 一概 join 全部元素，与原生
 *    ToIntegerOrInfinity 语义不符：
 *      [1,2,3].at()       → 1
 *      [1,2,3].at(null)   → 1
 *      [1,2,3].at(true)   → 2
 *      [1,2,3].at('1')    → 2
 *      [1,2,3].at(1.9)    → 2
 *      'hello'.at(-1)     → "o"
 *
 * 同类排查：charAt/charCodeAt/slice/substring（string）已修；
 * Array.at 的索引强制是 array 侧同族漏网点。
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

describe("String.prototype.at ToIntegerOrInfinity", () => {
  it("at() defaults to index 0", () => {
    expect(val(`export function f() { return 'hello'.at(); }`)).toBe("h");
    expect(val(`export function f() { return 'hello'.at(undefined); }`)).toBe(
      "h",
    );
    expect(val(`export function f() { return 'hello'.at(null); }`)).toBe("h");
  });

  it("at coerces numeric strings / bools / truncated floats", () => {
    expect(val(`export function f() { return 'hello'.at(0); }`)).toBe("h");
    expect(val(`export function f() { return 'hello'.at('1'); }`)).toBe("e");
    expect(val(`export function f() { return 'hello'.at(true); }`)).toBe("e");
    expect(val(`export function f() { return 'hello'.at(1.9); }`)).toBe("e");
  });

  it("at supports negative indices and out-of-range", () => {
    expect(val(`export function f() { return 'hello'.at(-1); }`)).toBe("o");
    expect(val(`export function f() { return 'hello'.at(-2); }`)).toBe("l");
    expect(val(`export function f() { return 'hello'.at(10); }`)).toBeUndefined();
    expect(val(`export function f() { return 'hello'.at(-10); }`)).toBeUndefined();
    expect(val(`export function f() { return 'hello'.at(Infinity); }`)).toBeUndefined();
    expect(val(`export function f() { return 'hello'.at(NaN); }`)).toBe("h");
  });
});

describe("Array.prototype.at ToIntegerOrInfinity", () => {
  it("at() / at(undefined) / at(null) default to index 0", () => {
    expect(val(`export function f() { return [1,2,3].at(); }`)).toBe(1);
    expect(val(`export function f() { return [1,2,3].at(undefined); }`)).toBe(1);
    expect(val(`export function f() { return [1,2,3].at(null); }`)).toBe(1);
    expect(val(`export function f() { return [1,2,3].at(NaN); }`)).toBe(1);
  });

  it("at coerces numeric strings / bools / truncated floats", () => {
    expect(val(`export function f() { return [1,2,3].at('1'); }`)).toBe(2);
    expect(val(`export function f() { return [1,2,3].at(true); }`)).toBe(2);
    expect(val(`export function f() { return [1,2,3].at(false); }`)).toBe(1);
    expect(val(`export function f() { return [1,2,3].at(1.9); }`)).toBe(2);
    expect(val(`export function f() { return [1,2,3].at(-1.5); }`)).toBe(3);
  });

  it("at keeps negative index and OOB undefined", () => {
    expect(val(`export function f() { return [1,2,3].at(-1); }`)).toBe(3);
    expect(val(`export function f() { return [1,2,3].at(10); }`)).toBeUndefined();
    expect(val(`export function f() { return [1,2,3].at(-10); }`)).toBeUndefined();
    expect(val(`export function f() { return [1,2,3].at(Infinity); }`)).toBeUndefined();
  });

  it("abstract index does not pin a single element", () => {
    // 缺省实参 i ≡ undefined → at(0) 是 1；显式抽象下标不得钉成字面量
    const s = shape(`export function f(i) { return [1,2,3].at(i + 0); }`);
    expect(val(`export function f(i) { return [1,2,3].at(i + 0); }`)).toBeUndefined();
    expect(s === "1" || s === "2" || s === "3").toBe(false);
  });
});
