/**
 * Bug 268 —— `Array.prototype.with.call(<原始值>)` ⇒ native 必抛 `RangeError`
 * （`with.call(1, 0, 2)` → RangeError: Invalid index : 0——ToObject(prim).length
 * = 0 ⇒ 下标必越界），引擎**恒不抛** ⇒ L2 门禁**假绿**（throws 面折 never）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：原始值接收者分支按原生语义补域
 * 错误——`with` 在非字符串原始值接收者上定抛 RangeError（负下标原生写 "-1"
 * 属性不抛；字符串接收者走字符元组路径，长度有效下标不抛）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

describe("Bug 268：Array.prototype.with 在原始值接收者上定抛 RangeError", () => {
  it("with.call(1, 0, 2) 定抛 RangeError（原生；此前恒不抛 ⇒ 假绿）", () => {
    const r = call(`export function f() { return Array.prototype.with.call(1, 0, 2); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "RangeError")).toBe(true);
  });

  it("with.call(true, 0, 'x') 同样定抛 RangeError", () => {
    const r = call(`export function f() { return Array.prototype.with.call(true, 0, "x"); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "RangeError")).toBe(true);
  });

  it("负下标也越界（with.call(1, -1, 2) → RangeError；RelativeIndex 钳到 0）", () => {
    const r = call(`export function f() { return Array.prototype.with.call(1, -1, 2); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "RangeError")).toBe(true);
  });

  it("字符串接收者不抛（with.call('ab', 0, 'x') 走字符元组）", () => {
    const r = call(`export function f() { return Array.prototype.with.call("ab", 0, "x"); }`);
    expect(r.throws.shape.k).toBe("never");
    expect(r.result.shape.k).toBe("tuple");
  });

  it("数组接收者不受影响（with.call([1,2], 0, 9) = [9,2]）", () => {
    const r = call(`export function f() { return Array.prototype.with.call([1, 2], 0, 9); }`);
    expect(r.throws.shape.k).toBe("never");
    expect(litValue(r.result)).toEqual({ ok: false });
  });
});
