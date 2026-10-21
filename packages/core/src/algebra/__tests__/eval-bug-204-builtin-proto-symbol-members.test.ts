/**
 * Bug 204 回归：内建**原型对象**上的 well-known Symbol 成员必须可读
 * （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]`
 * / `Date.prototype[Symbol.toPrimitive]` …）。
 *
 * ES 语义：这些成员是原型对象上的 **symbol 键**自有成员。引擎内部把 symbol
 * 键投影成 "@@X" 槽键 ⇒ 成员表按 "@@X" 建键。
 *
 * 修复前：原型对象的符号成员读**整体缺席** → 折 exact `"undefined"`
 * （wrong-exact：原生是字符串 / 函数 / 对象）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 204 — 内建原型对象上的 well-known Symbol 成员", () => {
  it("Symbol.toStringTag：Map / Set / Promise 原型上是字符串标签", () => {
    expect(v(wrap(`return String(Map.prototype[Symbol.toStringTag]);`))).toEqual({
      ok: true,
      value: "Map",
    });
    expect(v(wrap(`return String(Set.prototype[Symbol.toStringTag]);`))).toEqual({
      ok: true,
      value: "Set",
    });
    expect(v(wrap(`return String(Promise.prototype[Symbol.toStringTag]);`))).toEqual({
      ok: true,
      value: "Promise",
    });
  });

  it("Symbol.iterator：Map / Set / Array / String 原型上是函数", () => {
    for (const expr of [
      "Map.prototype[Symbol.iterator]",
      "Set.prototype[Symbol.iterator]",
      "Array.prototype[Symbol.iterator]",
      "String.prototype[Symbol.iterator]",
    ]) {
      expect(v(wrap(`return String(typeof ${expr});`))).toEqual({
        ok: true,
        value: "function",
      });
    }
  });

  it("Symbol.toPrimitive：Date 原型上是函数", () => {
    expect(v(wrap(`return String(typeof Date.prototype[Symbol.toPrimitive]);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("RegExp 原型上的 match / replace / search / split 是函数", () => {
    for (const sym of ["match", "replace", "search", "split"]) {
      expect(v(wrap(`return String(typeof RegExp.prototype[Symbol.${sym}]);`))).toEqual({
        ok: true,
        value: "function",
      });
    }
  });

  it("Symbol.unscopables：Array 原型上是 16 键对象", () => {
    expect(v(wrap(`return String(typeof Array.prototype[Symbol.unscopables]);`))).toEqual({
      ok: true,
      value: "object",
    });
    expect(v(wrap(`return Object.keys(Array.prototype[Symbol.unscopables]).length;`))).toEqual({
      ok: true,
      value: 16,
    });
    expect(v(wrap(`return String(Array.prototype[Symbol.unscopables].at);`))).toEqual({
      ok: true,
      value: "true",
    });
  });

  it("实例面经原型链继承同一成员（new Map()[Symbol.toStringTag]）", () => {
    expect(v(wrap(`return String(new Map()[Symbol.toStringTag]);`))).toEqual({
      ok: true,
      value: "Map",
    });
    expect(v(wrap(`return String(typeof new Date()[Symbol.toPrimitive]);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("Map 原型的 @@iterator 借调落到集合迭代派发（不再假抛）", () => {
    expect(
      v(wrap(`const m = new Map([["a", 1]]); const it = Map.prototype[Symbol.iterator].call(m); return String(it.next().value[0]);`)),
    ).toEqual({ ok: true, value: "a" });
  });

  it("负控制：字符串键成员不受影响（Map.prototype.get 仍是函数）", () => {
    expect(v(wrap(`return String(typeof Map.prototype.get);`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});
