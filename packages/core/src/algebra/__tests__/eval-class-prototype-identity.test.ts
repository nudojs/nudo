/**
 * Bug 64（fabrication 半）：$get(ctor, "prototype") 不再捏匿名闭 obj——
 * 类值分支与宿主 fn 分支都返回 protoBrandAbs(ownerName)（constructor 槽 +
 * 按名驻留）。经验探针：`X.prototype.hasOwnProperty("constructor")` 从
 * 非具体 boolean 变具体 true。原型链 instanceof 解析是另一半（brand 臂
 * 链走），本文件只钉 prototype 身份面。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 64: X.prototype 是 protoBrandAbs（constructor 自有槽）", () => {
  it("MyErr.prototype.hasOwnProperty(\"constructor\") → 具体.true", () => {
    expect(v(`export function f() { class MyErr extends Error {} return MyErr.prototype.hasOwnProperty("constructor"); }`)).toEqual({ ok: true, value: true });
  });

  it("MyArr.prototype.hasOwnProperty(\"constructor\") → 具体 true", () => {
    expect(v(`export function f() { class MyArr extends Array {} return MyArr.prototype.hasOwnProperty("constructor"); }`)).toEqual({ ok: true, value: true });
  });

  it("基类：class A {} 的 A.prototype 同款（无 extends 也带身份）", () => {
    expect(v(`export function f() { class A {} return A.prototype.hasOwnProperty("constructor"); }`)).toEqual({ ok: true, value: true });
  });

  it("内建子类：RangeError.prototype.hasOwnProperty(\"constructor\") → true", () => {
    expect(v(`export function f() { return RangeError.prototype.hasOwnProperty("constructor"); }`)).toEqual({ ok: true, value: true });
  });

  it("控制：Error.prototype（路由表成员）既有精确面不回归", () => {
    expect(v(`export function f() { return Error.prototype.hasOwnProperty("constructor"); }`)).toEqual({ ok: true, value: true });
  });

  it("宿主声明函数：function g(){} 的 g.prototype.constructor 自有 → true", () => {
    expect(v(`export function f() { function g() {} return g.prototype.hasOwnProperty("constructor"); }`)).toEqual({ ok: true, value: true });
  });

  it("prototype 按名驻留：两次读 === 恒等", () => {
    expect(v(`export function f() { class A {} return A.prototype === A.prototype; }`)).toEqual({ ok: true, value: true });
  });
});
