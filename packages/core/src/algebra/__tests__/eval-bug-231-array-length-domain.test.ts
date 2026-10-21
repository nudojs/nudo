/**
 * Bug 231：`a.length = undefined` / `a.length = {}` 不抛 RangeError（原生
 * `Invalid array length`）→ 数值域校验只覆盖**数字**字面量，具体非数值被
 * 误当抽象值放行 → 门禁假绿。
 *
 * 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts
 * 的 `lengthToNumber`）：原生 ArraySetLength 先 `ToNumber(value)` 再判整数与
 * [0, 2^32-1] 界——引擎此前只判「**数字**字面量」，具体非数值（undefined /
 * {} / "abc"）落进抽象回退（不抛）。
 *
 * 负控制：数字 / 数字字符串 / null / 布尔 / 数组字面量（ToNumber 合法）→
 * 原生不抛；小数 / 负数（既有 RangeError）保持。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

function threw(src: string, name = "RangeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 231: length 域校验走 ToNumber（具体非数值定抛 RangeError）", () => {
  it("a.length = undefined → RangeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = undefined;
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("a.length = {} → RangeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = {};
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("a.length = \"abc\" → RangeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = "abc";
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("负控制：a.length = 1 → length = 1", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = 1;
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：a.length = \"2\" → length = 2（ToNumber 合法）", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = "2";
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：a.length = null → length = 0", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = null;
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 0 });
  });

  it("负控制：a.length = true → length = 1", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = true;
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：a.length = [] → length = 0（ToNumber([]) 合法）", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = [];
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 0 });
  });

  it("负控制：a.length = 1.7 → RangeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = 1.7;
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("负控制：a.length = -1 → RangeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = -1;
        return "nothrow";
      }`),
    ).toBe(true);
  });
});
