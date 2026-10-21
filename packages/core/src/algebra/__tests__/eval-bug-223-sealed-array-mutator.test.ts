/**
 * Bug 223：`Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()`
 * 不抛 TypeError（原生硬抛）。
 *
 * 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）：
 * sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可
 * 配置自有属性）→ 原生 TypeError；增长合法（只新增 hole）。
 * preventExtensions（nonext）**不**冻结元素 → 截断不抛（node 实测）。
 *
 * pop()/shift() 的 sealed 门在 `containers/arr-methods.ts`
 * （$arrMutContainer，r22-s14 分片补上）：sealed 数组的元素是不可配置自有
 * 属性 → 删除即 TypeError；**空数组原生不抛**（不删任何属性）；空洞（hole）
 * 不是自有属性 → 删它不抛（`Object.seal([1,,]).pop()` 原生不抛），但 shift
 * 把后续元素前移到空洞位 → 在不可扩展数组上新增自有属性 → 抛
 * （`Object.seal([,,3]).shift()` 原生抛）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 223: sealed 数组 length 截断写 / mutator", () => {
  it("sealed 数组 length 截断写 → TypeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        Object.seal(a);
        a.length = 1;
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("负控制：sealed 数组 length 增长 → 合法（length = 5）", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        Object.seal(a);
        a.length = 5;
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("负控制：sealed 数组 length 同长写 → 合法（不删任何属性）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        Object.seal(a);
        a.length = 3;
        return "nothrow";
      }`),
    ).toBe(false);
  });

  it("负控制：未 seal 数组 length 截断 → 合法（length = 1）", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = 1;
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：preventExtensions 数组 length 截断 → 合法（元素仍可配置）", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        Object.preventExtensions(a);
        a.length = 1;
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：frozen 数组 length 截断 → TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        Object.freeze(a);
        a.length = 1;
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("负控制：未 seal 数组 pop() → 正常（length = 2）", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.pop();
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：sealed 数组 push() → TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        Object.seal(a);
        a.push(4);
        return "nothrow";
      }`),
    ).toBe(true);
  });

  // ⚠️ pop()/shift() 的 sealed 门在 `containers/arr-methods.ts`
  // （$arrMutContainer）——已由 r22-s14 分片补上（见下方用例）。
  it("sealed 数组 pop() → TypeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        Object.seal(a);
        a.pop();
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("sealed 数组 shift() → TypeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        Object.seal(a);
        a.shift();
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("负控制：sealed 空数组 pop() → 不抛（原生不删任何属性）", () => {
    expect(
      v(`export function f() {
        const a = [];
        Object.seal(a);
        a.pop();
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 0 });
  });

  it("负控制：sealed 空数组 shift() → 不抛（原生不删任何属性）", () => {
    expect(
      v(`export function f() {
        const a = [];
        Object.seal(a);
        a.shift();
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 0 });
  });

  it("负控制：preventExtensions 数组 pop()/shift() → 不抛（元素仍可配置）", () => {
    expect(
      v(`export function f() {
        const a = [1, 2];
        Object.preventExtensions(a);
        a.pop();
        a.shift();
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 0 });
  });

  it("稀疏：sealed [1,,] 的 pop() → 不抛（末位是洞，非自有属性）", () => {
    expect(
      v(`export function f() {
        const a = [1, ,];
        Object.seal(a);
        a.pop();
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("稀疏：sealed [,,3] 的 shift() → TypeError（前移要在不可扩展数组上新增自有属性）", () => {
    expect(
      threw(`export function f() {
        const a = [, , 3];
        Object.seal(a);
        a.shift();
        return "nothrow";
      }`),
    ).toBe(true);
  });
});
