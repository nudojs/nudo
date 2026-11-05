/**
 * Bug 247：实例字段落地必须是 **CreateDataPropertyOrThrow**（原生
 * DefineField）——在接收者上**创建自有数据属性**，**不沿原型链派发
 * setter**。
 *
 * 原生（node 实测）：
 * - `class A { get x(){ return 1; } } class B extends A { x = 2; }`
 *   → `new B().x === 2`（字段是 B 实例的自有数据属性，父类 getter 不参与）。
 * - 父类 setter-only：字段落地**不**调父类 setter（`b._v` 仍是 undefined）。
 * - `Object.keys(new B())` → ["x"]（字段是自有可枚举属性）。
 *
 * 引擎此前走 `$set` = `[[Set]]` ⇒ 父类同名访问器拦截字段落地：getter-only
 * 时**假抛 TypeError**，setter-only 时把字段写穿到父类 setter（错值）。
 */
import { describe, it, expect } from "vitest";
import { call, val, isNever, throwsError } from "../../__tests__/eval-helpers.ts";

describe("Bug 247：实例字段落地 = 自有数据属性（不派发原型 setter）", () => {
  it("父类 getter-only 同名访问器不拦截子类字段落地", () => {
    const r = call(
      `class A { get x(){ return 1; } }
       class B extends A { x = 2; }
       export function f(){ return new B().x; }`,
    );
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(val(
      `class A { get x(){ return 1; } }
       class B extends A { x = 2; }
       export function f(){ return new B().x; }`,
    )).toEqual({ ok: true, value: 2 });
  });

  it("父类 setter-only：字段落地不调父类 setter（父类侧槽保持缺席）", () => {
    expect(
      val(
        `class A { set x(v){ this._v = v * 10; } }
         class B extends A { x = 4; }
         export function f(){ const b = new B(); return b.x + "|" + b._v; }`,
      ),
    ).toEqual({ ok: true, value: "4|undefined" });
  });

  it("父类 getter+setter 同款：字段落地仍不派发父类访问器", () => {
    expect(
      val(
        `class A { get x(){ return 1; } set x(v){ this._v = v*10; } }
         class B extends A { x = 2; }
         export function f(){ const b = new B(); return b.x + "|" + b._v; }`,
      ),
    ).toEqual({ ok: true, value: "2|undefined" });
  });

  it("字段是自有可枚举属性（Object.keys 可见）", () => {
    expect(
      val(
        `class A { get x(){ return 1; } }
         class B extends A { x = 2; }
         export function f(){ return Object.keys(new B()).join(","); }`,
      ),
    ).toEqual({ ok: true, value: "x" });
  });

  it("无访问器干扰的普通字段路径不受影响", () => {
    expect(
      val(
        `class A { x = 1; }
         class B extends A { x = 2; }
         export function f(){ return new B().x; }`,
      ),
    ).toEqual({ ok: true, value: 2 });
  });
});
