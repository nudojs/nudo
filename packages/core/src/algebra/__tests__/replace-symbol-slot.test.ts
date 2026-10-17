/**
 * Bug 81 回归：String.prototype.replace/replaceAll 的 @@replace 槽委托。
 *
 * 原生 replace/replaceAll 第一步 GetMethod(pattern, @@replace)——
 * `re[Symbol.replace] = fn` 覆盖宿主正则分派；此前 RegExp brand 直接重建
 * 宿主正则、槽被绕过（折错 definite 字符串）。原生（node 实测）hook 返回
 * 值**原样透传**（不 ToString：() => 5 得 number）；实参布局
 * (string, replValue)；槽值非函数且非 undefined/null → GetMethod 定抛。
 *
 * 注：match/search/matchAll 的 @@match/@@search 半边由 class-regex.ts 承接
 * （本文件只钉 replace/replaceAll 面）。
 */
import { describe, it, expect } from "vitest";
import { val, call, throwsError } from "./eval-helpers.ts";

describe("Bug 81: replace/replaceAll dispatches the @@replace slot", () => {
  it("hook overrides the host regex path", () => {
    expect(
      val(`export function f() { const re = /a/; re[Symbol.replace] = () => "X"; return "aa".replace(re, "b"); }`),
    ).toEqual({ ok: true, value: "X" });
    expect(
      val(`export function f() { const re = /a/g; re[Symbol.replace] = () => "X"; return "aa".replaceAll(re, "b"); }`),
    ).toEqual({ ok: true, value: "X" });
  });

  it("hook result is returned verbatim (no ToString)", () => {
    expect(
      val(`export function f() { const re = /a/; re[Symbol.replace] = () => 5; return "aa".replace(re, "b"); }`),
    ).toEqual({ ok: true, value: 5 });
    expect(
      val(`export function f() { const re = /a/; re[Symbol.replace] = () => 5; return typeof "aa".replace(re, "b"); }`),
    ).toEqual({ ok: true, value: "number" });
  });

  it("hook args are (string, replValue)", () => {
    expect(
      val(`export function f() { const re = /a/; re[Symbol.replace] = (s, r) => r; return "aa".replace(re, "b"); }`),
    ).toEqual({ ok: true, value: "b" });
    expect(
      val(`export function f() { const re = /(\\d)/; re[Symbol.replace] = (s) => String(s.length); return "a1".replace(re, "x"); }`),
    ).toEqual({ ok: true, value: "2" });
  });

  it("non-callable slot (non undefined/null) is a TypeError", () => {
    const r = call(`export function f() { const re = /a/; re[Symbol.replace] = 5; return "aa".replace(re, "b"); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("undefined slot falls back to the default dispatch", () => {
    expect(
      val(`export function f() { const re = /a/; re[Symbol.replace] = undefined; return "aa".replace(re, "b"); }`),
    ).toEqual({ ok: true, value: "ba" });
  });

  it("control: plain regex/string replace without a slot is unchanged", () => {
    expect(val(`export function f() { return "aa".replace(/a/, "b"); }`)).toEqual({ ok: true, value: "ba" });
    expect(val(`export function f() { return "aa".replace("a", "b"); }`)).toEqual({ ok: true, value: "ba" });
    expect(val(`export function f() { return "aa".replaceAll("a", "b"); }`)).toEqual({ ok: true, value: "bb" });
  });
});
