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
    expect(val(`export function f() { return 'abc'.startsWith(); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return 'abc'.endsWith(); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return 'abc'.includes(); }`)).toEqual({ ok: true, value: false });
  });

  it("non-string literal searchString is ToStrings", () => {
    expect(val(`export function f() { return 'abc'.startsWith(undefined); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return 'undefinedabc'.startsWith(undefined); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return 'abcundefined'.endsWith(undefined); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return 'abcundefined'.includes(undefined); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return 'abc'.startsWith(true); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return 'trueabc'.startsWith(true); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return 'abc'.includes(null); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return 'anull'.includes(null); }`)).toEqual({ ok: true, value: true });
  });
});

describe("split ToString separator + missing args", () => {
  it("missing / non-string separator folds via ToString", () => {
    expect(val(`export function f() { return JSON.stringify('hello'.split()); }`)).toEqual({ ok: true, value: JSON.stringify(["hello"]) });
    expect(val(`export function f() { return JSON.stringify('hello'.split(undefined)); }`)).toEqual({ ok: true, value: JSON.stringify(["hello"]) });
    expect(val(`export function f() { return JSON.stringify('a1b'.split(1)); }`)).toEqual({ ok: true, value: JSON.stringify(["a", "b"]) });
    expect(val(`export function f() { return JSON.stringify('anullb'.split(null)); }`)).toEqual({ ok: true, value: JSON.stringify(["a", "b"]) });
    expect(val(`export function f() { return JSON.stringify('atrueb'.split(true)); }`)).toEqual({ ok: true, value: JSON.stringify(["a", "b"]) });
    expect(val(`export function f() { return JSON.stringify('a,b'.split(false)); }`)).toEqual({ ok: true, value: JSON.stringify(["a,b"]) });
  });

  it("undefined separator is NOT ToString'd (ES split special case)", () => {
    // 原生：separator 为 undefined → 整串 1 段，不按 "undefined" 切
    expect(val(`export function f() { return JSON.stringify('aundefinedb'.split()); }`)).toEqual({ ok: true, value: JSON.stringify(["aundefinedb"]), });
    expect(val(`export function f() { return JSON.stringify('aundefinedb'.split(undefined)); }`)).toEqual({ ok: true, value: JSON.stringify(["aundefinedb"]), });
    // 对照：显式字符串 "undefined" 才切
    expect(val(`export function f() { return JSON.stringify('aundefinedb'.split('undefined')); }`)).toEqual({ ok: true, value: JSON.stringify(["a", "b"]), });
  });

  it("undefined separator still honors limit", () => {
    expect(val(`export function f() { return JSON.stringify('hello'.split(undefined, 0)); }`)).toEqual({ ok: true, value: JSON.stringify([]), });
    expect(val(`export function f() { return JSON.stringify('hello'.split(undefined, 1)); }`)).toEqual({ ok: true, value: JSON.stringify(["hello"]), });
    expect(val(`export function f() { return JSON.stringify('hello'.split(undefined, 2)); }`)).toEqual({ ok: true, value: JSON.stringify(["hello"]), });
  });
});

describe("replace / replaceAll ToString pattern & replacement", () => {
  it("missing args fold like undefined ToStrings", () => {
    expect(val(`export function f() { return 'ab'.replace(); }`)).toEqual({ ok: true, value: "ab" });
    expect(val(`export function f() { return 'ab'.replaceAll(); }`)).toEqual({ ok: true, value: "ab" });
    expect(val(`export function f() { return 'ab'.replace('a'); }`)).toEqual({ ok: true, value: "undefinedb" });
    expect(val(`export function f() { return 'ab'.replace('a', undefined); }`)).toEqual({ ok: true, value: "undefinedb" });
  });

  it("non-string literal pattern is ToStrings", () => {
    expect(val(`export function f() { return 'ab'.replace(true); }`)).toEqual({ ok: true, value: "ab" });
    expect(val(`export function f() { return 'atrue'.replace(true); }`)).toEqual({ ok: true, value: "aundefined" });
    expect(val(`export function f() { return 'a1b'.replaceAll(1); }`)).toEqual({ ok: true, value: "aundefinedb" });
  });
});

describe("indexOf / lastIndexOf missing first arg", () => {
  it("missing searchString folds like undefined", () => {
    expect(val(`export function f() { return 'abc'.indexOf(); }`)).toEqual({ ok: true, value: -1 });
    expect(val(`export function f() { return 'abc'.lastIndexOf(); }`)).toEqual({ ok: true, value: -1 });
    expect(val(`export function f() { return 'abcundefined'.indexOf(); }`)).toEqual({ ok: true, value: 3 });
    // 已正确的同族对照
    expect(val(`export function f() { return 'abc'.indexOf(undefined); }`)).toEqual({ ok: true, value: -1 });
    expect(val(`export function f() { return 'abc'.indexOf(null); }`)).toEqual({ ok: true, value: -1 });
  });
});

describe("parseInt / parseFloat missing first arg", () => {
  it("parseInt() / parseFloat() fold to NaN", () => {
    const p = val(`export function f() { return parseInt(); }`);
    expect(p.ok && typeof p.value).toBe("number");
    expect(Number.isNaN((p).ok ? (p).value : undefined)).toBe(true);
    const q = val(`export function f() { return parseFloat(); }`);
    expect(q.ok && typeof q.value).toBe("number");
    expect(Number.isNaN((q).ok ? (q).value : undefined)).toBe(true);
    const r = val(`export function f() { return Number.parseInt(); }`);
    expect(r.ok && typeof r.value).toBe("number");
    expect(Number.isNaN((r).ok ? (r).value : undefined)).toBe(true);
    const s = val(`export function f() { return Number.parseFloat(); }`);
    expect(s.ok && typeof s.value).toBe("number");
    expect(Number.isNaN((s).ok ? (s).value : undefined)).toBe(true);
  });
});
