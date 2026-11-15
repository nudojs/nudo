/**
 * Bug 267 —— `Array.prototype.sort/reverse/fill/copyWithin.call(<对象>)` ⇒ 引擎
 * 返回**物化出来的空数组**而非**接收者对象**（原生返回 this 本身：
 * `Array.prototype.sort.call({a:1})` → `{a:1}`）⇒ 错值（内容 + 身份全丢）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：物化通道分族——「就地操作并返回
 * this」的方法（sort / reverse / fill / copyWithin）不走物化，直接返回接收者
 * Abs（原始值接收者：原生返回 ToObject(prim) 包装对象，引擎无该形态 ⇒ unknown）。
 */
import { describe, it, expect } from "vitest";
import { call, objSlots } from "./eval-helpers.ts";

describe("Bug 267：sort / reverse / fill / copyWithin 返回接收者", () => {
  it("sort.call({a:1}) = 接收者对象（此前折空数组）", () => {
    const r = call(`export function f() { return Array.prototype.sort.call({ a: 1 }); }`);
    expect(r.result.shape.k).toBe("obj");
    expect(objSlots(r.result)).toEqual({ a: 1 });
  });

  it("reverse.call({a:1}) = 接收者对象", () => {
    const r = call(`export function f() { return Array.prototype.reverse.call({ a: 1 }); }`);
    expect(r.result.shape.k).toBe("obj");
    expect(objSlots(r.result)).toEqual({ a: 1 });
  });

  it("fill.call({a:1}, 0) = 接收者对象", () => {
    const r = call(`export function f() { return Array.prototype.fill.call({ a: 1 }, 0); }`);
    expect(r.result.shape.k).toBe("obj");
    expect(objSlots(r.result)).toEqual({ a: 1 });
  });

  it("copyWithin.call({a:1}, 0) = 接收者对象", () => {
    const r = call(`export function f() { return Array.prototype.copyWithin.call({ a: 1 }, 0); }`);
    expect(r.result.shape.k).toBe("obj");
    expect(objSlots(r.result)).toEqual({ a: 1 });
  });

  it("数组接收者不受影响（sort.call([3,1,2]) 仍折排序元组）", () => {
    const r = call(`export function f() { return Array.prototype.sort.call([3, 1, 2]); }`);
    expect(r.result.shape.k).toBe("tuple");
  });
});
