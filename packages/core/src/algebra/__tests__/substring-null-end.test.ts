/**
 * String.prototype.substring 结尾实参的 null / undefined 语义回归。
 *
 * 回归背景：methods.ts 折叠 substring 时用 `a1 ?? lit.length` 取缺省，
 * 把 null 也当成「实参缺省」。规范里只有 undefined（含缺省）才取 len；
 * null 走 ToIntegerOrInfinity → 0：
 *   'hello'.substring(0, null)      原生 ""，引擎 "hello"
 *   'hello'.substring(0, undefined) 原生 "hello"（缺省 ≡ end=len）
 *   'hello'.slice(0, null)          原生 ""（slice 直传原生，已正确）
 *
 * 同类排查：charAt/charCodeAt 的 `a0 ?? 0` 对 null 巧合正确（start 缺省
 * 也是 0）；slice 把实参交给原生 ToIntegerOrInfinity。仅 substring 的 end
 * 槽把「undefined→len」和「null→0」混成了同一个 ?? 缺省。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function val(src: string) {
  return litValue(call(src).result);
}

describe("String.prototype.substring end arg null vs undefined", () => {
  it("null end is ToIntegerOrInfinity 0, not omitted", () => {
    expect(val(`export function f() { return 'hello'.substring(0, null); }`)).toBe(
      "",
    );
    // start=3, end=0 → 规范交换 → substring(0, 3)
    expect(val(`export function f() { return 'hello'.substring(3, null); }`)).toBe(
      "hel",
    );
  });

  it("undefined / omitted end still means string length", () => {
    expect(
      val(`export function f() { return 'hello'.substring(0, undefined); }`),
    ).toBe("hello");
    expect(val(`export function f() { return 'hello'.substring(0); }`)).toBe(
      "hello",
    );
    expect(val(`export function f() { return 'hello'.substring(1, undefined); }`)).toBe(
      "ello",
    );
  });

  it("null start is 0 (ToIntegerOrInfinity)", () => {
    expect(val(`export function f() { return 'hello'.substring(null, 3); }`)).toBe(
      "hel",
    );
    expect(val(`export function f() { return 'hello'.substring(null, null); }`)).toBe(
      "",
    );
  });

  it("false end is 0 (ToNumber false), true end is 1", () => {
    expect(val(`export function f() { return 'hello'.substring(0, false); }`)).toBe(
      "",
    );
    expect(val(`export function f() { return 'hello'.substring(0, true); }`)).toBe(
      "h",
    );
  });

  it("slice already honors null end via native ToIntegerOrInfinity", () => {
    expect(val(`export function f() { return 'hello'.slice(0, null); }`)).toBe(
      "",
    );
    expect(val(`export function f() { return 'hello'.slice(0, undefined); }`)).toBe(
      "hello",
    );
  });
});
