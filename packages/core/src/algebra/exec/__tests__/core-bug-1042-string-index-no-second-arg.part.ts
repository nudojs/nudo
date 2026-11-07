/**
 * Bug 1042 —— `String.prototype.charAt` / `charCodeAt` / `codePointAt` /
 * `at` **没有第二实参**（元数均为 1）。
 *
 * 根因：`algebra/methods.ts` 的字符串方法表把 7 个**元数不同**的方法塞进
 * 同一 case 分支，且该分支**无条件**校验 `args[1]`：
 * `validateIndexArg(args[1], "end")` ⇒ `"abc".charAt(0, 1n)` 凭空判「必抛
 * TypeError」（原生正常返回 "a"）⇒ throws 域折 never ⇒ **L2 门禁假红**。
 *
 * 修法：按各方法**真实元数**分流校验——`slice` / `substring` / `substr`
 * 校验第二实参；`charAt` / `charCodeAt` / `codePointAt` / `at` **只校验
 * `args[0]`**（多余实参按原生丢弃）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../../abs.ts";
import { call, throwsError } from "../../__tests__/eval-helpers.ts";

describe("Bug 1042: charAt/charCodeAt/codePointAt/at take no second argument", () => {
  it("charAt(0, 1n) → \"a\"（此前判「必抛 TypeError」）", () => {
    const r = call(`export function f() { return "abc".charAt(0, 1n); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "a" });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  });

  it("charCodeAt(0, 1n) → 97", () => {
    const r = call(`export function f() { return "abc".charCodeAt(0, 1n); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 97 });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  });

  it("codePointAt(0, 1n) → 97", () => {
    const r = call(`export function f() { return "abc".codePointAt(0, 1n); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 97 });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  });

  it("at(0, 1n) → \"a\"", () => {
    const r = call(`export function f() { return "abc".at(0, 1n); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "a" });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  });

  it("对照组：真有两实参的方法仍校验第二实参（slice / substring / substr）", () => {
    for (const m of ["slice", "substring", "substr"]) {
      const r = call(`export function f() { return "abc".${m}(0, 1n); }`);
      expect(throwsError(r.throws, "TypeError")).toBe(true);
    }
  });

  it("对照组：单参调用仍正常折叠", () => {
    const r = call(`export function f() { return "abc".charAt(0); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "a" });
  });
});
