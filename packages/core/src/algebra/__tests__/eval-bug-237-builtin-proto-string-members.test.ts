/**
 * Bug 237 回归：内建**原型对象**上的字符串键成员值读必须取到原生值
 * （`RegExp.prototype.flags` / `Error.prototype.name` / …）。
 *
 * ES 语义：原型对象上的自有数据属性（RegExp.prototype.source === "(?:)"、
 * flags === ""、Error.prototype.name === "Error"、message === ""）与**实例面**
 * 取值不同（`/x/gim.flags === "gim"`），须分别建模。
 *
 * 修复前：内建方法/访问器表按**实例** brand 名建键 ⇒ 原型 brand 名（带
 * ".prototype" 后缀）必然查不到 → 落「内层闭 obj 槽 miss」→ 折 exact
 * undefined（wrong-exact）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 237 — 内建原型对象上的字符串键成员值读", () => {
  it("RegExp 原型：source === \"(?:)\"、flags === \"\"", () => {
    expect(v(wrap(`return String(RegExp.prototype.source);`))).toEqual({
      ok: true,
      value: "(?:)",
    });
    expect(v(wrap(`return String(RegExp.prototype.flags);`))).toEqual({
      ok: true,
      value: "",
    });
  });

  it("RegExp 原型：global 等布尔 getter 在原型上读 undefined（原生同）", () => {
    expect(v(wrap(`return String(RegExp.prototype.global === undefined);`))).toEqual({
      ok: true,
      value: "true",
    });
  });

  it("Error 家族原型：name / message 是原生值", () => {
    expect(v(wrap(`return String(Error.prototype.name);`))).toEqual({
      ok: true,
      value: "Error",
    });
    expect(v(wrap(`return String(Error.prototype.message);`))).toEqual({
      ok: true,
      value: "",
    });
    expect(v(wrap(`return String(TypeError.prototype.name);`))).toEqual({
      ok: true,
      value: "TypeError",
    });
  });

  it("Intl 原型上的自有方法是函数（resolvedOptions / formatToParts）", () => {
    for (const expr of [
      "Intl.NumberFormat.prototype.resolvedOptions",
      "Intl.NumberFormat.prototype.formatToParts",
      "Intl.DateTimeFormat.prototype.resolvedOptions",
      "Intl.Collator.prototype.resolvedOptions",
      "Intl.ListFormat.prototype.format",
    ]) {
      expect(v(wrap(`return String(typeof ${expr});`))).toEqual({
        ok: true,
        value: "function",
      });
    }
  });

  it("负控制：实例面不受影响（/x/gim.flags === \"gim\"）", () => {
    expect(v(wrap(`return String(/x/gim.flags);`))).toEqual({
      ok: true,
      value: "gim",
    });
    expect(v(wrap(`return String(new Error("m").name);`))).toEqual({
      ok: true,
      value: "Error",
    });
  });

  it("负控制：其它原型方法读仍是函数（缺席面不误伤）", () => {
    expect(v(wrap(`return String(typeof Array.prototype.map);`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});
