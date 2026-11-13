/**
 * `setSlot` 快路径语义（2026-11-13）。
 *
 * `setSlot` 从「一律 `Object.defineProperty`」改成「`__proto__` 走
 * defineProperty、其余键普通赋值」——整图拷贝（`copyWithMemo`）实测
 * `setSlot` 占 self-time 33%，普通赋值省掉 defineProperty 的慢路径。
 *
 * 等价性前提：槽表是引擎自有的普通 Record（不冻结、不挂 accessor，
 * 访问器在 `accessorTable` 侧表），因此普通赋值与「enumerable / writable /
 * configurable 全 true 的自有数据属性」完全一致；唯一例外是 `__proto__`
 * （普通赋值会改写原型，不会建自有槽）。本文件把这两条钉住。
 */
import { describe, it, expect } from "vitest";
import { setSlot } from "../objects.ts";
import { abs, type Abs } from "../abs.ts";

const num = (): Abs => abs({ k: "prim", type: "number" }, undefined, undefined, "exact");

describe("setSlot 槽位写入语义", () => {
  it("普通键建自有、可枚举、可写、可配置的数据属性", () => {
    const slots: Record<string, { value: Abs }> = {};
    const v = num();
    setSlot(slots, "x", { value: v });
    const d = Object.getOwnPropertyDescriptor(slots, "x")!;
    expect(d.enumerable).toBe(true);
    expect(d.writable).toBe(true);
    expect(d.configurable).toBe(true);
    expect(slots.x!.value).toBe(v);
    expect(Object.keys(slots)).toEqual(["x"]);
    expect(Object.prototype.hasOwnProperty.call(slots, "x")).toBe(true);
  });

  it("重复写入覆盖值，不改变属性序", () => {
    const slots: Record<string, { value: Abs }> = {};
    const a = num();
    const b = num();
    const c = num();
    setSlot(slots, "a", { value: a });
    setSlot(slots, "b", { value: b });
    setSlot(slots, "a", { value: c });
    expect(slots.a!.value).toBe(c);
    expect(Object.keys(slots)).toEqual(["a", "b"]);
  });

  it("`__proto__` 建自有槽而不是改写原型", () => {
    const slots: Record<string, { value: Abs }> = {};
    const before = Object.getPrototypeOf(slots);
    const v = num();
    setSlot(slots, "__proto__", { value: v });
    expect(Object.getPrototypeOf(slots)).toBe(before);
    expect(Object.prototype.hasOwnProperty.call(slots, "__proto__")).toBe(true);
    const d = Object.getOwnPropertyDescriptor(slots, "__proto__")!;
    expect(d.enumerable).toBe(true);
    expect(d.writable).toBe(true);
    expect(d.configurable).toBe(true);
    expect(slots["__proto__"]!.value).toBe(v);
  });

  it("遮蔽 Object.prototype 上的同名成员时建自有槽", () => {
    const slots: Record<string, { value: Abs }> = {};
    for (const key of ["constructor", "toString", "__defineGetter__", "hasOwnProperty"]) {
      const v = num();
      setSlot(slots, key, { value: v });
      const d = Object.getOwnPropertyDescriptor(slots, key)!;
      expect(d.enumerable).toBe(true);
      expect(slots[key]!.value).toBe(v);
    }
    expect(Object.keys(slots).sort()).toEqual(
      ["__defineGetter__", "constructor", "hasOwnProperty", "toString"].sort(),
    );
  });

  it("null 原型槽表同样可用", () => {
    const slots: Record<string, { value: Abs }> = Object.create(null);
    const v = num();
    setSlot(slots, "k", { value: v });
    expect(Object.getPrototypeOf(slots)).toBeNull();
    expect(slots.k!.value).toBe(v);
  });
});
