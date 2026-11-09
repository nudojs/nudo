/**
 * Bug 4 回归：字符串数组解构按 **code point** 迭代（原生
 * GetIterator + String.prototype[Symbol.iterator]），不是按 UTF-16 码元
 * 下标。此前 `$iterCheck` 对字符串返回 null ⇒ readAt 回落 `$idx(str,i)`
 * ⇒ 增补平面字符解出孤立代理项。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

describe("Bug 4 — 字符串数组解构按码点", () => {
  it("const [a] = '𠮷' ⇒ a.length === 2（改前 1）", () => {
    expect(val(`export function f() { const [a] = "\\u{20BB7}"; return a.length; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("const [a,b] = '𠮷x' ⇒ 完整码点 + 后继字符", () => {
    expect(val(`export function f() { const [a, b] = "\\u{20BB7}x"; return a + "|" + b; }`)).toEqual({
      ok: true,
      value: "𠮷|x",
    });
  });

  it("rest 段同样按码点", () => {
    expect(val(`export function f() { const [a, ...rest] = "\\u{20BB7}xy"; return a + rest.join(""); }`)).toEqual({
      ok: true,
      value: "𠮷xy",
    });
  });

  it("ASCII 与 spread / for-of 既有精度不变", () => {
    expect(val(`export function f() { const [a, b] = "xy"; return a + b; }`)).toEqual({ ok: true, value: "xy" });
    expect(val(`export function f() { return [..."𠮷"].length; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { return "𠮷".length; }`)).toEqual({ ok: true, value: 2 });
  });
});
