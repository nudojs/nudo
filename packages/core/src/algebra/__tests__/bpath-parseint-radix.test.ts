/**
 * parseInt radix 的 ToInt32 截断缺失：
 * parseInt("101", 2.5) 原生把 radix 截断为 2 → 5，B 路径折 NaN；
 * radix 0（含 ToInt32 后为 0 的 NaN/小数）原生视为「未提供」→ 十进制解析。
 * 修复：foldParseInt 先对 radix 做 ToInt32（| 0），0 走缺省路径。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path parseInt radix ToInt32", () => {
  it("fractional radix truncates toward zero", () => {
    expect(litValue(call(`export function f() { return parseInt("101", 2.5); }`).result)).toBe(5);
    expect(litValue(call(`export function f() { return parseInt("101", 2.9); }`).result)).toBe(5);
    expect(litValue(call(`export function f() { return parseInt("12345678", 2.999); }`).result)).toBe(1);
  });

  it("radix 0 behaves as absent", () => {
    expect(litValue(call(`export function f() { return parseInt("101", 0); }`).result)).toBe(101);
    expect(litValue(call(`export function f() { return parseInt("0x10", 0); }`).result)).toBe(16);
  });

  it("NaN radix coerces to 0 (absent)", () => {
    expect(litValue(call(`export function f() { return parseInt("42", NaN); }`).result)).toBe(42);
  });

  it("out-of-range radix stays NaN", () => {
    expect(litValue(call(`export function f() { return parseInt("101", 1.5); }`).result)).toBe(NaN);
    expect(litValue(call(`export function f() { return parseInt("101", 37.5); }`).result)).toBe(NaN);
  });

  it("Number.parseInt shares the fold", () => {
    expect(litValue(call(`export function f() { return Number.parseInt("101", 2.5); }`).result)).toBe(5);
  });

  it("integer radix unchanged", () => {
    expect(litValue(call(`export function f() { return parseInt("ff", 16); }`).result)).toBe(255);
  });
});
