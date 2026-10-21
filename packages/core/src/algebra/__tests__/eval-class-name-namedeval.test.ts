/**
 * Bug 133：类表达式的 ES **NamedEvaluation**——匿名类表达式绑定到名字时，
 * 以该名字为类名（`const K = class {}` → `K.name === "K"`）。
 *
 * 根因：转译期发射类定义时就把名字定死（`$class(<合成名>, {…})`，类表达式
 * 的 name 取 "AnonymousClass"），`$class` 随即把它写进类值的 name 槽；
 * transpile 层没有把 VariableDeclarator.id / 赋值左值 / 属性键的名字回灌给
 * 类表达式（ES 的 NamedEvaluation 缺席）。
 *
 * 修法：发射位（变量声明 / 标识符赋值 / 对象属性静态键 / 对象字面量计算键
 * 字面量）把绑定名作为 NamedEvaluation 名回灌；类自身的名字（`class Named
 * {}`）优先；hint 只作用于**本类表达式**（类体内的嵌套类表达式不继承）。
 * 空类体快路径（$classExpr）同样取名；对外可见的 name 与内部类名分离
 * （无名类对外名是空串，内部合成名只供发射/类注册用）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 133: 类表达式的 NamedEvaluation（绑定名为类名）", () => {
  it("变量声明：`const K = class {…}` → K.name === \"K\"", () => {
    expect(
      v(`export function f() { const K = class { m() { return 1; } }; return K.name; }`),
    ).toEqual({ ok: true, value: "K" });
    expect(
      v(`export function f() { let K; K = class { m() { return 1; } }; return K.name; }`),
    ).toEqual({ ok: true, value: "K" });
  });

  it("对象属性：`{ K: class {…} }` → o.K.name === \"K\"", () => {
    expect(
      v(`export function f() { const o = { K: class { m() { return 1; } } }; return o.K.name; }`),
    ).toEqual({ ok: true, value: "K" });
    expect(
      v(`export function f() { const o = { ["K"]: class { m() { return 1; } } }; return o.K.name; }`),
    ).toEqual({ ok: true, value: "K" });
  });

  it("两个匿名类各取各的名（类注册表不再同名相撞）", () => {
    expect(
      v(`export function f() { const A = class { m() { return 1; } }; const B = class { m() { return 2; } }; return A.name + "/" + B.name; }`),
    ).toEqual({ ok: true, value: "A/B" });
  });

  it("类自身的名字优先于绑定名（原生内层名优先）", () => {
    expect(
      v(`export function f() { const K = class Named { m() { return 1; } }; return K.name; }`),
    ).toEqual({ ok: true, value: "Named" });
  });

  it("对照：类声明名不变", () => {
    expect(
      v(`export function f() { class K { m() { return 1; } } return K.name; }`),
    ).toEqual({ ok: true, value: "K" });
  });

  it("类名参与值域：`K.name.length` → 1", () => {
    expect(
      v(`export function f() { const K = class { m() { return 1; } }; return K.name.length; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("用户 static name 字段仍覆盖类名", () => {
    expect(
      v(`export function f() { const K = class { static name = "custom"; }; return K.name; }`),
    ).toEqual({ ok: true, value: "custom" });
  });

  it("extends 子句：被继承的匿名类表达式不取外层绑定名", () => {
    expect(
      v(`export function f() { const K = class extends (class { }) { m() { return 1; } }; return K.name; }`),
    ).toEqual({ ok: true, value: "K" });
  });

  it("空类体快路径同样取名：`const K = class {}` → \"K\"", () => {
    expect(v(`export function f() { const K = class {}; return K.name; }`)).toEqual({
      ok: true,
      value: "K",
    });
    // 空类体仍走 $classExpr fn 形状（Bug 80 pinned 形态）
    expect(v(`export function f() { const K = class {}; return typeof K; }`)).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("未绑定的类表达式：原生名是空串", () => {
    expect(v(`export function f() { return (class { m() {} }).name; }`)).toEqual({
      ok: true,
      value: "",
    });
  });

  it("hint 不渗进类体内的嵌套类表达式", () => {
    // 内层类表达式未绑定 ⇒ 原生名为空串
    expect(
      v(`export function f() { const K = class { m() { return class { n() {} }.name; } }; return new K().m(); }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("非类表达式位置不受影响（数组元素 / 实参）", () => {
    // 数组元素 / 实参里的类表达式未绑定 ⇒ 原生名为空串
    expect(v(`export function f() { const a = [class { m() {} }]; return a[0].name; }`)).toEqual({
      ok: true,
      value: "",
    });
    expect(
      v(`export function f() { const g = (c) => c.name; return g(class { m() {} }); }`),
    ).toEqual({ ok: true, value: "" });
  });
});
