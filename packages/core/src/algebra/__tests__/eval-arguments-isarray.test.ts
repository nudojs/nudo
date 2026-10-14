/**
 * Bug 56：`Array.isArray(arguments)` 原生 false——arguments 对象不是数组
 * exotic。修复：$arguments 产 brand "Arguments" 包 tuple 内层（isArray 在
 * 剥层前判定 false）；下标/长度/spread/for-of/Array.from 经委托与剥层
 * 保持精确。四条 Scope 变体（plain fn / method / apply 转发 / 空实参）+
 * arguments 使用面回归钉住。
 */
import { describe, it, expect } from "vitest";
import { litValue, $lit } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string, fnName = "f", args: unknown[] = []) {
  return litValue(call(src, fnName, args as never).result);
}

describe("Bug 56: Array.isArray(arguments) → false（非数组 exotic）", () => {
  it("plain function：f(1, 2) → false", () => {
    expect(
      v(`export function f() { function g() { return Array.isArray(arguments); } return g(1, 2); }`),
    ).toEqual({ ok: true, value: false });
  });

  it("entry function 自身 arguments → false", () => {
    expect(
      v(`export function f() { return Array.isArray(arguments); }`, "f", [$lit(1), $lit(2)]),
    ).toEqual({ ok: true, value: false });
  });

  it("object method：o.m(1, 2) → false", () => {
    expect(
      v(`export function f() { const o = { m() { return Array.isArray(arguments); } }; return o.m(1, 2); }`),
    ).toEqual({ ok: true, value: false });
  });

  it("apply 转发：g.apply(null, [1, 2]) → false", () => {
    expect(
      v(`export function f() { function g() { return Array.isArray(arguments); } return g.apply(null, [1, 2]); }`),
    ).toEqual({ ok: true, value: false });
  });

  it("空实参：g() → false", () => {
    expect(
      v(`export function f() { function g() { return Array.isArray(arguments); } return g(); }`),
    ).toEqual({ ok: true, value: false });
  });

  it("控制：真数组仍 true、元组/brand 不误伤", () => {
    expect(v(`export function f() { return Array.isArray([1, 2]); }`)).toEqual({ ok: true, value: true });
    expect(v(`export function f() { return Array.isArray(new Array(3)); }`)).toEqual({ ok: true, value: true });
    expect(v(`export function f() { return Array.isArray({}); }`)).toEqual({ ok: true, value: false });
  });
});

describe("Bug 56 回归：arguments 使用面不因 brand 退化", () => {
  it("arguments.length / arguments[i] 精确", () => {
    expect(v(`export function f() { function g(a, b) { return arguments.length; } return g(7, 8, 9); }`)).toEqual({ ok: true, value: 3 });
    expect(v(`export function f() { function g(a, b) { return arguments[1]; } return g(7, 8); }`)).toEqual({ ok: true, value: 8 });
  });

  it("spread / for-of / spread-call 展开", () => {
    expect(v(`export function f() { function g(a, b) { return [...arguments].join(""); } return g(7, 8); }`)).toEqual({ ok: true, value: "78" });
    expect(v(`export function f() { function g() { let s = 0; for (const x of arguments) s += x; return s; } return g(3, 9); }`)).toEqual({ ok: true, value: 12 });
    expect(v(`export function f() { function g() { return Math.max(...arguments); } return g(3, 9, 4); }`)).toEqual({ ok: true, value: 9 });
  });

  it("Array.from / in / typeof / constructor", () => {
    const from = call(`export function f() { function g(a, b) { return Array.from(arguments); } return g(7, 8); }`).result;
    // 元素域 [7|8]（tuple 域投影，与修复前口径一致——不因 brand 折 unknown）
    expect(from.shape.k).toBe("arr");
    const inRes = v(`export function f() { function g() { return (0 in arguments) + " " + ("length" in arguments) + " " + ("zz" in arguments); } return g(1); }`);
    expect(inRes).toEqual({ ok: true, value: "true true false" });
    expect(v(`export function f() { function g() { return typeof arguments; } return g(); }`)).toEqual({ ok: true, value: "object" });
    expect(v(`export function f() { function g() { return arguments.constructor === Object; } return g(); }`)).toEqual({ ok: true, value: true });
  });

  it("strict 独立映射：写 arguments[0] 不改形参，读回写值", () => {
    expect(v(`export function f() { function g(a) { arguments[0] = 99; return arguments[0] + a; } return g(1); }`)).toEqual({ ok: true, value: 100 });
  });
});
