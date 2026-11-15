/**
 * Bug 266：`super.constructor` 必须是**父类构造器本身**（原生父类原型上的
 * "constructor" 自有属性 ⇒ 父类值）。
 *
 * 原生（node 实测）：
 * - `class Base {} class Sub extends Base { who(){ return super.constructor.name; } }`
 *   → "Base"（引擎此前折 "Object"——确定错值）。
 * - `super.constructor === Base` → true（引擎此前假 false）。
 *
 * 根因：`$getSuper` 只在 `spec.methods` 里找 "constructor" ⇒ 父类构造器
 * 记在 `spec.ctor` / 类值注册表 ⇒ 查找失败回落内置 `Object`。
 */
import { describe, it, expect } from "vitest";
import { val } from "../../__tests__/eval-helpers.ts";

describe("Bug 266：super.constructor 取父类构造器", () => {
  it("super.constructor.name = 父类名", () => {
    expect(val(
      `class Base { constructor(){ this.tag = "Base"; } }
       class Sub extends Base { who(){ return super.constructor.name; } }
       export function f(){ return new Sub().who(); }`,
    )).toEqual({ ok: true, value: "Base" });
  });

  it("super.constructor === 父类（引用恒等）", () => {
    expect(val(
      `class Base { constructor(){ this.tag = "Base"; } }
       class Sub extends Base { isBase(){ return super.constructor === Base; } }
       export function f(){ return new Sub().isBase(); }`,
    )).toEqual({ ok: true, value: true });
  });

  it("无显式构造器的父类同样取到父类名", () => {
    expect(val(
      `class Base { }
       class Sub extends Base { who(){ return super.constructor.name; } }
       export function f(){ return new Sub().who(); }`,
    )).toEqual({ ok: true, value: "Base" });
  });
});
