/**
 * Bug 234 回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成
 * **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是
 * "Function"），不是「以类名命名的内建构造器」。
 *
 * ES 语义：类构造器的 [[Prototype]] 是 Function.prototype ⇒ `constructor`
 * 继承自那里 = 内建 Function（与函数声明、箭头函数同款）。
 *
 * 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个
 * 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折
 * **确定 false**（自信错值）、`.constructor.name` 折类名 "Widget"（原生
 * "Function"）。
 *
 * 不变量（负控制钉住）：
 * - 实例面 / 原型面的 constructor 仍解析到类值本身（`new W().constructor === W`）；
 * - `Widget.constructor === Widget` 仍折 false；
 * - 内建 brand（Date / Error 等）的 constructor 解析不受影响。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 234 — 类值的 constructor 是内建 Function", () => {
  it("Widget.constructor === Function → true", () => {
    expect(v(wrap(`class Widget {} return Widget.constructor === Function;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Widget.constructor.name → \"Function\"", () => {
    expect(v(wrap(`class Widget {} return Widget.constructor.name;`))).toEqual({
      ok: true,
      value: "Function",
    });
  });

  it("子类的 constructor 同样是 Function", () => {
    expect(v(wrap(`class Base {} class Sub extends Base {} return Sub.constructor === Function;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("有体类表达式的 constructor 同样是 Function", () => {
    expect(v(wrap(`const C = class Inner { m(){} }; return C.constructor === Function;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("typeof Widget.constructor → \"function\"", () => {
    expect(v(wrap(`class Widget {} return typeof Widget.constructor;`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});

describe("Bug 234 — 负控制：实例面 / 原型面 / 内建 brand 的 constructor 不回归", () => {
  it("new Widget().constructor === Widget → true（实例面解析到类值）", () => {
    expect(v(wrap(`class Widget {} return new Widget().constructor === Widget;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Widget.prototype.constructor === Widget → true", () => {
    expect(v(wrap(`class Widget {} return Widget.prototype.constructor === Widget;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Widget.constructor === Widget → false（不是同一个东西）", () => {
    expect(v(wrap(`class Widget {} return Widget.constructor === Widget;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("内建 brand（Date）的 constructor 仍解析到 Date", () => {
    expect(v(wrap(`return new Date(0).constructor === Date;`))).toEqual({ ok: true, value: true });
  });
});
