/**
 * BUG-183：`btoa()` / `atob()` **少传必填实参**被折叠成「显式 undefined」
 * ⇒ `btoa()` 假绿 + 返回值错（`"dW5kZWZpbmVk"`，宿主抛 TypeError）、
 * `atob()` 抛错种类错（引擎 InvalidCharacterError / 宿主 TypeError ⇒ L2
 * 建议 `@nudo:throws InvalidCharacterError` 不可执行）。
 *
 * 宿主 node v26.10.0 实测：
 * - `btoa()` / `atob()` → `TypeError: The "input" argument must be specified`；
 * - `btoa(undefined)` → `"dW5kZWZpbmVk"`（ToString(undefined) 合法）；
 * - `atob(undefined)` → DOMException InvalidCharacterError；
 * - 同族 `encodeURI()` / `escape()` 缺参 ≡ ToString(undefined)（不受此门影响）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError, val } from "./eval-helpers.ts";

describe("BUG-183：btoa/atob 缺参 ⇒ 确定 TypeError", () => {
  it("btoa() 折 never + TypeError（此前假绿返回 \"dW5kZWZpbmVk\"）", () => {
    const r = call(`export function f() { return btoa(); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("atob() 折 never + TypeError（此前抛错种类错 InvalidCharacterError）", () => {
    const r = call(`export function f() { return atob(); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(throwsError(r.throws, "InvalidCharacterError")).toBe(false);
  });

  it("对照：btoa(undefined) 仍是 ToString(undefined)", () => {
    expect(val(`export function f() { return btoa(undefined); }`)).toEqual({
      ok: true,
      value: "dW5kZWZpbmVk",
    });
  });

  it("对照：atob(undefined) 仍是 InvalidCharacterError（DOMException）", () => {
    const r = call(`export function f() { return atob(undefined); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "InvalidCharacterError")).toBe(true);
  });

  it("对照：同族 6 个函数缺参 ≡ ToString(undefined)（不得误伤）", () => {
    for (const name of [
      "encodeURI",
      "encodeURIComponent",
      "decodeURI",
      "decodeURIComponent",
      "escape",
      "unescape",
    ]) {
      const r = call(`export function f() { return ${name}(); }`);
      expect(isNever(r.result), name).toBe(false);
      // 缺参 ≡ ToString(undefined) = "undefined"（6 个函数同款）
      expect(val(`export function f() { return ${name}(); }`), name).toEqual({
        ok: true,
        value: "undefined",
      });
    }
  });
});
