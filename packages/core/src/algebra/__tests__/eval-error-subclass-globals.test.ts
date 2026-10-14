/**
 * Bug 68：Error 家族七子类进 NAMESPACE_GLOBALS（+ env-skip 同步）。修复前
 * `RangeError` 全局落宿主 fn 通用通道 → `.prototype` 捏匿名闭 obj：
 * `.constructor === X` 假 false（折 Object）、`X.prototype.toString.call(...)`
 * 假派 Object.prototype.toString（"[object Error]"）。入表后 .prototype 走
 * protoBrandAbs(X)（constructor 槽 + toString 家族派发 `${name}: ${message}`）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

const SUBCLASSES = [
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "EvalError",
  "URIError",
  "AggregateError",
] as const;

describe("Bug 68: X.prototype.constructor === X（七子类）", () => {
  for (const name of SUBCLASSES) {
    it(`${name}.prototype.constructor === ${name} → true`, () => {
      expect(v(`export function f() { return ${name}.prototype.constructor === ${name}; }`)).toEqual({ ok: true, value: true });
    });
  }

  it("控制：既有路由表成员不受影响（Error/Array/Object）", () => {
    expect(v(`export function f() { return Error.prototype.constructor === Error; }`)).toEqual({ ok: true, value: true });
    expect(v(`export function f() { return Array.prototype.constructor === Array; }`)).toEqual({ ok: true, value: true });
    expect(v(`export function f() { return Object.prototype.constructor === Object; }`)).toEqual({ ok: true, value: true });
  });
});

describe("Bug 68: X.prototype.toString 派发 Error 家族格式", () => {
  it("RangeError.prototype.toString.call(new RangeError(\"m\")) → \"RangeError: m\"", () => {
    expect(v(`export function f() { return RangeError.prototype.toString.call(new RangeError("m")); }`)).toEqual({ ok: true, value: "RangeError: m" });
  });

  it("AggregateError.prototype.toString.call(new AggregateError([\"a\"], \"m\")) → \"AggregateError: m\"", () => {
    expect(v(`export function f() { return AggregateError.prototype.toString.call(new AggregateError(["a"], "m")); }`)).toEqual({ ok: true, value: "AggregateError: m" });
  });

  it("实例直呼 toString 同派发", () => {
    expect(v(`export function f() { return new TypeError("boom").toString(); }`)).toEqual({ ok: true, value: "TypeError: boom" });
  });
});
