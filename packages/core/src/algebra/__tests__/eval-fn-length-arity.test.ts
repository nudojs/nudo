/**
 * Bug 69：fn.length 原生边界 = 首个默认值/rest 形参前的形参数。修复前
 * transpile 把默认参解糖成宿主真参（`function f(a, _p1)` → 宿主 length 2）
 * ——声明经 Bug 9 宿主函数泄漏面折 wrong-exact；$fnVal 产物无长度记录落
 * 抽象 number。修复：声明宿主签名占位补 `= void 0`（宿主 length 对齐）；
 * $fnVal 记录 nativeParamArity（$len 的 impl.length 通道）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

/** [src, native length] */
const DECL_CASES: Array<[string, number]> = [
  ["function g(a, b = 1) {}", 1],
  ["function g(a = 1) {}", 0],
  ["function g(a, b = 1, c) {}", 1],
  ["function g(a, b, c = 1) {}", 2],
  ["function g(a = 1, b) {}", 0],
  ["function g(a, b = 1, c, d = 2) {}", 1],
  // 控制组：无默认值 / rest / 解构（不截断）
  ["function g(a, b, c) {}", 3],
  ["function g(a, ...r) {}", 1],
  ["function g(a, { b } = {}) {}", 1],
  ["function g({ a }, b = 1) {}", 1],
];

describe("Bug 69: 函数声明 f.length（六 Scope 变体 + 控制）", () => {
  for (const [decl, want] of DECL_CASES) {
    it(`${decl} → length ${want}`, () => {
      expect(v(`export function f() { ${decl} return g.length; }`)).toEqual({ ok: true, value: want });
    });
  }

  it("成员读与 $len 同源：g.length 参与算术", () => {
    expect(v(`export function f() { function g(a, b = 1) {} return g.length + 1; }`)).toEqual({ ok: true, value: 2 });
  });
});

describe("Bug 69: 函数表达式 / 箭头 / 方法（$fnVal length 通道）", () => {
  it("函数表达式：(function(a, b = 1) {}).length → 1", () => {
    expect(v(`export function f() { return (function (a, b = 1) {}).length; }`)).toEqual({ ok: true, value: 1 });
  });

  it("箭头：((a, b = 1) => 0).length → 1；((a = 1, b) => 0).length → 0", () => {
    expect(v(`export function f() { return ((a, b = 1) => 0).length; }`)).toEqual({ ok: true, value: 1 });
    expect(v(`export function f() { return ((a = 1, b) => 0).length; }`)).toEqual({ ok: true, value: 0 });
  });

  it("对象方法：({ m(a, b = 1) {} }).m.length → 1", () => {
    expect(v(`export function f() { return ({ m(a, b = 1) {} }).m.length; }`)).toEqual({ ok: true, value: 1 });
  });

  it("无默认值控制：function g(a, b) → 2（原语义保持）", () => {
    expect(v(`export function f() { function g(a, b) {} return g.length; }`)).toEqual({ ok: true, value: 2 });
  });
});
