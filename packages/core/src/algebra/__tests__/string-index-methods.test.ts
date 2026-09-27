/**
 * 字符串下标类方法 ToNumber / 缺省实参折叠回归。
 * 回归背景：charAt/charCodeAt/slice/substring 只认 typeof number 实参，
 * 缺省 pos 与字符串数字（'1'）一概折 strPrim/numPrim——原生
 * `'abc'.charAt()`==='a'、`'abc'.charAt('1')`==='b'、`'abc'.slice('1')`==='bc'。
 * 同类：exec-string-positional 已修 includes/startsWith/endsWith/split 的
 * 位置实参；charAt/charCodeAt/slice/substring/indexOf 是同族漏网点。
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

describe("charAt / charCodeAt default and ToNumber index", () => {
  it("charAt() defaults to 0", () => {
    expect(val(`export function f() { return 'abc'.charAt(); }`)).toBe("a");
    expect(val(`export function f() { return 'abc'.charAt(undefined); }`)).toBe("a");
  });

  it("charAt coerces numeric strings / bools / null", () => {
    expect(val(`export function f() { return 'abc'.charAt('1'); }`)).toBe("b");
    expect(val(`export function f() { return 'abc'.charAt(true); }`)).toBe("b");
    expect(val(`export function f() { return 'abc'.charAt(null); }`)).toBe("a");
    expect(val(`export function f() { return 'abc'.charAt(1.9); }`)).toBe("b");
    expect(val(`export function f() { return 'abc'.charAt(-0); }`)).toBe("a");
    expect(val(`export function f() { return 'abc'.charAt(99); }`)).toBe("");
  });

  it("charCodeAt folds with default and coerced index", () => {
    expect(val(`export function f() { return 'a'.charCodeAt(); }`)).toBe(97);
    expect(val(`export function f() { return 'a'.charCodeAt(0); }`)).toBe(97);
    expect(val(`export function f() { return 'a'.charCodeAt('0'); }`)).toBe(97);
    expect(val(`export function f() { return 'abc'.charCodeAt(1); }`)).toBe(98);
    expect(val(`export function f() { return 'abc'.charCodeAt(99); }`)).toBe(NaN);
    expect(val(`export function f() { return 'abc'.charCodeAt(); }`)).toBe(97);
  });
});

describe("slice / substring ToNumber indices", () => {
  it("slice coerces string/bool/null indices", () => {
    expect(val(`export function f() { return 'abc'.slice('1'); }`)).toBe("bc");
    expect(val(`export function f() { return 'abc'.slice(true); }`)).toBe("bc");
    expect(val(`export function f() { return 'abc'.slice(null); }`)).toBe("abc");
    expect(val(`export function f() { return 'abc'.slice(1, '2'); }`)).toBe("b");
    expect(val(`export function f() { return 'abc'.slice(); }`)).toBe("abc");
    expect(val(`export function f() { return 'abc'.slice(undefined, 2); }`)).toBe("ab");
  });

  it("substring coerces string/bool/null indices", () => {
    expect(val(`export function f() { return 'abc'.substring('1'); }`)).toBe("bc");
    expect(val(`export function f() { return 'abc'.substring(true); }`)).toBe("bc");
    expect(val(`export function f() { return 'abc'.substring(null); }`)).toBe("abc");
    expect(val(`export function f() { return 'abc'.substring(1, '2'); }`)).toBe("b");
    expect(val(`export function f() { return 'abc'.substring(); }`)).toBe("abc");
  });
});

describe("indexOf / lastIndexOf literal fold", () => {
  it("indexOf folds on string literals", () => {
    expect(val(`export function f() { return 'abc'.indexOf('b'); }`)).toBe(1);
    expect(val(`export function f() { return 'abc'.indexOf('z'); }`)).toBe(-1);
    expect(val(`export function f() { return 'abc'.indexOf('b', 2); }`)).toBe(-1);
    expect(val(`export function f() { return 'abc'.indexOf('b', '1'); }`)).toBe(1);
    expect(val(`export function f() { return 'abcabc'.indexOf('bc'); }`)).toBe(1);
    expect(val(`export function f() { return 'abcabc'.lastIndexOf('bc'); }`)).toBe(4);
    expect(val(`export function f() { return 'abc'.lastIndexOf('a', 0); }`)).toBe(0);
  });

  it("abstract receiver / needle stay abstract", () => {
    // 抽象 string receiver：indexOf 返回 number 抽象（不得标 string / unknown）
    const exports1 = runTranspiled(
      `export function f(s) { return s.indexOf('b'); }`,
      { mode: "analyze" },
    );
    const absStr = { shape: { k: "prim", type: "string" as const }, conf: "path" as const };
    const r = callTranspiledExportFull(exports1, "f", [absStr as never]);
    expect(litValue(r.result)).toBeUndefined();
    expect(r.result.shape).toEqual({ k: "prim", type: "number" });
    // 真正的抽象 needle（非「未绑定参数」——f() 时 n 是 undefined，应折 -1）
    const exports = runTranspiled(
      `export function f(n) { return 'abc'.indexOf(n); }`,
      { mode: "analyze" },
    );
    const absN = { shape: { k: "any" as const }, conf: "partial" as const };
    const r2 = callTranspiledExportFull(exports, "f", [absN as never]);
    expect(litValue(r2.result)).toBeUndefined();
    expect(r2.result.shape).toEqual({ k: "prim", type: "number" });
  });

  it("missing param n folds like undefined (JS f() ≡ indexOf(undefined))", () => {
    expect(val(`export function f(n) { return 'abc'.indexOf(n); }`)).toBe(-1);
    expect(val(`export function f(n) { return 'abcundefined'.indexOf(n); }`)).toBe(3);
  });
});
