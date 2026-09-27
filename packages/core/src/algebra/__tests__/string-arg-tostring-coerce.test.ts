/**
 * 字符串方法 / parseInt·parseFloat 的 ToString 强制与缺省实参回归。
 * 回归背景：startsWith/endsWith/includes/split/replace/indexOf 只认
 * typeof string/number 实参，缺省与非字符串字面量（undefined/true/null/1）
 * 一概折 boolPrim/numPrim/strPrim——原生对首参做 ToString：
 *   'abc'.startsWith()===false、'abcundefined'.startsWith(undefined)===true、
 *   'hello'.split()===['hello']、'a1b'.split(1)===['a','b']、
 *   'ab'.replace('a')==='undefinedb'、'abc'.indexOf()===-1。
 * parseInt()/parseFloat() 缺省首参 ≡ undefined → ToString → NaN。
 * 同类：string-index-methods 已修 charAt/slice/substring 的位置实参
 * ToString；搜索/分隔/替换与 parseInt 家族是同族漏网点。
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

describe("startsWith / endsWith / includes ToString + missing args", () => {
  it("missing searchString folds like undefined", () => {
    expect(val(`export function f() { return 'abc'.startsWith(); }`)).toBe(false);
    expect(val(`export function f() { return 'abc'.endsWith(); }`)).toBe(false);
    expect(val(`export function f() { return 'abc'.includes(); }`)).toBe(false);
  });

  it("non-string literal searchString is ToStrings", () => {
    expect(val(`export function f() { return 'abc'.startsWith(undefined); }`)).toBe(false);
    expect(val(`export function f() { return 'undefinedabc'.startsWith(undefined); }`)).toBe(true);
    expect(val(`export function f() { return 'abcundefined'.endsWith(undefined); }`)).toBe(true);
    expect(val(`export function f() { return 'abcundefined'.includes(undefined); }`)).toBe(true);
    expect(val(`export function f() { return 'abc'.startsWith(true); }`)).toBe(false);
    expect(val(`export function f() { return 'trueabc'.startsWith(true); }`)).toBe(true);
    expect(val(`export function f() { return 'abc'.includes(null); }`)).toBe(false);
    expect(val(`export function f() { return 'anull'.includes(null); }`)).toBe(true);
  });
});

describe("split ToString separator + missing args", () => {
  it("missing / non-string separator folds via ToString", () => {
    expect(val(`export function f() { return JSON.stringify('hello'.split()); }`)).toBe(JSON.stringify(["hello"]));
    expect(val(`export function f() { return JSON.stringify('hello'.split(undefined)); }`)).toBe(JSON.stringify(["hello"]));
    expect(val(`export function f() { return JSON.stringify('a1b'.split(1)); }`)).toBe(JSON.stringify(["a", "b"]));
    expect(val(`export function f() { return JSON.stringify('anullb'.split(null)); }`)).toBe(JSON.stringify(["a", "b"]));
    expect(val(`export function f() { return JSON.stringify('atrueb'.split(true)); }`)).toBe(JSON.stringify(["a", "b"]));
    expect(val(`export function f() { return JSON.stringify('a,b'.split(false)); }`)).toBe(JSON.stringify(["a,b"]));
  });
});

describe("replace / replaceAll ToString pattern & replacement", () => {
  it("missing args fold like undefined ToStrings", () => {
    expect(val(`export function f() { return 'ab'.replace(); }`)).toBe("ab");
    expect(val(`export function f() { return 'ab'.replaceAll(); }`)).toBe("ab");
    expect(val(`export function f() { return 'ab'.replace('a'); }`)).toBe("undefinedb");
    expect(val(`export function f() { return 'ab'.replace('a', undefined); }`)).toBe("undefinedb");
  });

  it("non-string literal pattern is ToStrings", () => {
    expect(val(`export function f() { return 'ab'.replace(true); }`)).toBe("ab");
    expect(val(`export function f() { return 'atrue'.replace(true); }`)).toBe("aundefined");
    expect(val(`export function f() { return 'a1b'.replaceAll(1); }`)).toBe("aundefinedb");
  });
});

describe("indexOf / lastIndexOf missing first arg", () => {
  it("missing searchString folds like undefined", () => {
    expect(val(`export function f() { return 'abc'.indexOf(); }`)).toBe(-1);
    expect(val(`export function f() { return 'abc'.lastIndexOf(); }`)).toBe(-1);
    expect(val(`export function f() { return 'abcundefined'.indexOf(); }`)).toBe(3);
    // 已正确的同族对照
    expect(val(`export function f() { return 'abc'.indexOf(undefined); }`)).toBe(-1);
    expect(val(`export function f() { return 'abc'.indexOf(null); }`)).toBe(-1);
  });
});

describe("parseInt / parseFloat missing first arg", () => {
  it("parseInt() / parseFloat() fold to NaN", () => {
    const p = val(`export function f() { return parseInt(); }`);
    expect(typeof p).toBe("number");
    expect(Number.isNaN(p)).toBe(true);
    const q = val(`export function f() { return parseFloat(); }`);
    expect(typeof q).toBe("number");
    expect(Number.isNaN(q)).toBe(true);
    const r = val(`export function f() { return Number.parseInt(); }`);
    expect(typeof r).toBe("number");
    expect(Number.isNaN(r)).toBe(true);
    const s = val(`export function f() { return Number.parseFloat(); }`);
    expect(typeof s).toBe("number");
    expect(Number.isNaN(s)).toBe(true);
  });
});
