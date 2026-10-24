/**
 * Bug 259 —— `Array.prototype` 的 **mutator** 在**非字符串**原始值接收者上**假抛**
 * TypeError（node 实测：`Array.prototype.push.call(5, 1)` → 1；`pop.call(5)` →
 * undefined）。ToObject(prim) 得到的是**普通可扩展对象**（length 0），mutator
 * 正常成功；只有**字符串**接收者的 length 不可写 ⇒ 才定抛
 * （`push.call("ab", 1)` → TypeError: Cannot assign to read only property 'length'）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：mutator 守卫**收窄到字符串接收者**
 * （原生语义分类，非引擎拍脑袋）；其它原始值接收者按 ToObject(prim) 的
 * length-0 普通对象语义派发。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

describe("Bug 259：Array.prototype mutator 只在字符串接收者上定抛", () => {
  it("push.call(5, 1) = 1（原生；此前定抛 TypeError）", () => {
    const r = call(`export function f() { return Array.prototype.push.call(5, 1); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(r.throws.shape.k).toBe("never");
  });

  it("unshift.call(5, 1) = 1（原生）", () => {
    const r = call(`export function f() { return Array.prototype.unshift.call(5, 1); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(r.throws.shape.k).toBe("never");
  });

  it("pop.call(5) / shift.call(5) 不抛（原生 pop → undefined、shift → undefined）", () => {
    const pop = call(`export function f() { return Array.prototype.pop.call(5); }`);
    expect(litValue(pop.result)).toEqual({ ok: true, value: undefined });
    expect(pop.throws.shape.k).toBe("never");
    // shift 的**取值**由空元组 shift 面决定（invoke-arr.ts——他片所有）；
    // 本钉锁本 bug 的核心面：原始值接收者上 mutator **不抛**。
    const shift = call(`export function f() { return Array.prototype.shift.call(5); }`);
    expect(shift.throws.shape.k).toBe("never");
  });

  it("字符串接收者仍定抛（push.call('ab',1) / pop.call('ab') → TypeError）", () => {
    const push = call(`export function f() { return Array.prototype.push.call("ab", 1); }`);
    expect(isNever(push.result)).toBe(true);
    expect(throwsError(push.throws, "TypeError")).toBe(true);
    const pop = call(`export function f() { return Array.prototype.pop.call("ab"); }`);
    expect(isNever(pop.result)).toBe(true);
    expect(throwsError(pop.throws, "TypeError")).toBe(true);
  });

  it("数组 / 对象接收者不受影响（push.call([1],2)=2 / push.call({},2)=1）", () => {
    expect(
      litValue(call(`export function f() { return Array.prototype.push.call([1], 2); }`).result),
    ).toEqual({ ok: true, value: 2 });
    expect(
      litValue(call(`export function f() { return Array.prototype.push.call({}, 2); }`).result),
    ).toEqual({ ok: true, value: 1 });
  });

  it("原始值接收者的读方法也落地（slice.call(5).length = 0）", () => {
    const r = call(`export function f() { return Array.prototype.slice.call(5).length; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
    expect(r.throws.shape.k).toBe("never");
  });
});
