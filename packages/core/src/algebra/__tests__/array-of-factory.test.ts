/**
 * Array.of 工厂语义回归。
 *
 * 回归背景：evalArrayStatic 的 of 分支把首参当 arr 元素类型
 * （`Array.of(7)` → `7[]`、`Array.of(1,2,3)` → `1[]`），与原生
 * `Array.of` 完全不符——原生把全部实参打包成 tuple：
 *   Array.of()       → []
 *   Array.of(7)      → [7]        （不是长度为 7 的空洞数组！）
 *   Array.of(1,2,3)  → [1, 2, 3]
 *   Array.of(7).length → 1
 *
 * 同类排查：makeArrayCtorAbs（Array()/new Array）语义正确；
 * Array.from 刻意返回 arr 元素联合。仅 Array.of 一处混淆了
 * 「Array(n) 构造」与「of 打包」。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatShape,
} from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function val(src: string) {
  return litValue(call(src).result);
}

function shape(src: string) {
  return formatShape(call(src).result);
}

describe("Array.of packs args into a tuple", () => {
  it("Array.of() is the empty tuple", () => {
    expect(shape(`export function f() { return Array.of(); }`)).toBe("[]");
    expect(val(`export function f() { return Array.of().length; }`)).toBe(0);
  });

  it("Array.of(n) is a one-element tuple, not arr of n", () => {
    expect(shape(`export function f() { return Array.of(7); }`)).toBe("[7]");
    expect(val(`export function f() { return Array.of(7).length; }`)).toBe(1);
    expect(val(`export function f() { return Array.of(7)[0]; }`)).toBe(7);
  });

  it("Array.of(1,2,3) keeps every argument", () => {
    expect(shape(`export function f() { return Array.of(1, 2, 3); }`)).toBe(
      "[1, 2, 3]",
    );
    expect(val(`export function f() { return Array.of(1, 2, 3).length; }`)).toBe(
      3,
    );
    expect(val(`export function f() { return Array.of(1, 2, 3)[1]; }`)).toBe(2);
    expect(val(`export function f() { return Array.of(1, 2, 3).toString(); }`)).toBe(
      "1,2,3",
    );
  });

  it("Array.of packs heterogeneous and non-number args", () => {
    expect(shape(`export function f() { return Array.of('a', 'b'); }`)).toBe(
      '["a", "b"]',
    );
    expect(val(`export function f() { return Array.of('a', 'b').toString(); }`)).toBe(
      "a,b",
    );
    expect(val(`export function f() { return Array.of(null).length; }`)).toBe(1);
    expect(val(`export function f() { return Array.of(true, 1).length; }`)).toBe(
      2,
    );
  });

  it("Array.of does not share Array(n) hole semantics", () => {
    // Array(3) 是长度 3 的空洞数组；Array.of(3) 是 [3]
    expect(val(`export function f() { return Array(3).length; }`)).toBe(3);
    expect(val(`export function f() { return Array.of(3).length; }`)).toBe(1);
    expect(val(`export function f() { return Array.of(3)[0]; }`)).toBe(3);
    expect(val(`export function f() { return Array.of(3)[1]; }`)).toBeUndefined();
  });
});
