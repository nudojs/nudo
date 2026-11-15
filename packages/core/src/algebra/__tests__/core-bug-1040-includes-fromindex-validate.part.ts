/**
 * Bug 1040 — `Array.prototype.includes(searchElement, fromIndex)` **不校验
 * fromIndex**：原生 `ToIntegerOrInfinity(fromIndex)` 对 bigint / symbol
 * **确定 TypeError**（node: `[1,2,3].includes(0, 1n)` → TypeError: Cannot
 * convert a BigInt value to a number）——引擎此前完全不校验 ⇒ 判「不抛」⇒
 * L2 `nudo:entry-may-throw` 门禁假绿。
 *
 * 根修：includes 臂补 `validateIndexArg(args[1], …)`（与 indexOf 同款口径）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError } from "./eval-helpers.ts";

describe("Bug 1040 · includes 的 fromIndex 校验", () => {
  it("includes(x, 1n)：原生确定 TypeError（bigint 不能转 number）", () => {
    const r = call(`export function f() { return [1,2,3].includes(0, 1n); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(isNever(r.result)).toBe(true);
  });

  it("includes(x, Symbol())：原生确定 TypeError（symbol 不能转 number）", () => {
    const r = call(`export function f() { return [1,2,3].includes(0, Symbol("x")); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(isNever(r.result)).toBe(true);
  });

  it("对照：includes(x, 1) 不抛（number 合法）", () => {
    const r = call(`export function f() { return [1,2,3].includes(0, 1); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  });

  it("对照：indexOf(x, 1n) 早已确定 TypeError（口径一致）", () => {
    const r = call(`export function f() { return [1,2,3].indexOf(0, 1n); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});
