/**
 * Bug 90 回归：类方法分派 / 值读不得索引宿主 spec 记录。
 *
 * transpile 产出的 spec.methods / staticMethods / accessors / … 是宿主普通
 * 对象，原型链取值会把 Object.prototype 继承名（toString / toLocaleString /
 * valueOf / hasOwnProperty / isPrototypeOf / propertyIsEnumerable /
 * constructor / __proto__…）当类成员：至少声明一个实例方法的类上
 * c.toString() 折 wrong-exact "[object Undefined]"、c.hasOwnProperty(k) /
 * c.valueOf() / c.isPrototypeOf(v) 假 TypeError（L2 假阳
 * nudo:entry-may-throw）、c.constructor === C / c.__proto__ === C.prototype
 * 折假 false、静态面 D.hasOwnProperty("m") / D.toString() 同源错。
 *
 * 修复（双保险）：declare.$class 把 7 张记录换 null 原型副本（唯一带记录
 * 注册入口，外围读点随之安全）+ findMethod / findStaticMethod /
 * chainHasStaticMember / member.ts 值读点 own-property 判定；类值自有
 * 静态面（静态方法/访问器是构造器自有属性）补进 hasOwnDecision。
 *
 * 原生 ground truth（node 实测）：全部继承方法可用且不抛；
 * `class D { static m(){} } D.hasOwnProperty("m")` → true（own-only——
 * 挂祖先时 false）；用户同名方法覆写照常分派。
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "../format.ts";
import { checkSource } from "../check.ts";
import { call, val, isNever } from "./eval-helpers.ts";
import { l2Count, sigOf } from "./nudo-constraints.ts";

function shape(src: string): string {
  return formatShape(call(src).result);
}

function check(src: string) {
  return checkSource("/t/eval-class-objproto-dispatch.js", src);
}

describe("Bug 90：实例继承方法分派（Object.prototype 名不被当类方法）", () => {
  it("c.toString() / c.toLocaleString() → 抽象 string（不再 wrong-exact \"[object Undefined]\"）", () => {
    for (const src of [
      `export function f() { class C { m(){} } const c = new C(); return c.toString(); }`,
      `export function f() { class C { m(){} } const c = new C(); return c.toLocaleString(); }`,
    ]) {
      expect(shape(src), src).toBe("string");
      expect(val(src), src).not.toEqual({ ok: true, value: "[object Undefined]" });
      expect(isNever(call(src).result), src).toBe(false);
    }
    // super.toString()：原型链尾巴不可判 → 诚实 unknown（此前 wrong-exact
    // "[object Undefined]"），不假抛
    const sup = `export function f() { class C { m(){} } class B extends C { n(){ return super.toString(); } } return new B().n(); }`;
    expect(val(sup)).not.toEqual({ ok: true, value: "[object Undefined]" });
    expect(isNever(call(sup).result)).toBe(false);
  });

  it("c.hasOwnProperty / propertyIsEnumerable / valueOf 不假抛、值域正确；isPrototypeOf 抽象 boolean", () => {
    expect(val(`export function f() { class C { m(){} } const c = new C(); return c.hasOwnProperty("m"); }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { class C { m(){} } const c = new C(); return c.hasOwnProperty("v"); }`))
      .toEqual({ ok: true, value: false });
    // 原型链不可判（接收者非 Object.prototype brand）→ 保守 boolean（原生 false）
    expect(shape(`export function f() { class C { m(){} } const c = new C(); return c.isPrototypeOf(c); }`))
      .toBe("boolean");
    expect(val(`export function f() { class C { m(){} } const c = new C(); return c.propertyIsEnumerable("m"); }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { class C { m(){} } const c = new C(); return typeof c.valueOf(); }`))
      .toEqual({ ok: true, value: "object" });
  });

  it("c.constructor === C / c.__proto__ === C.prototype 折 exact true（值读点 own-property）", () => {
    expect(val(`export function f() { class C { m(){} } const c = new C(); return c.constructor === C; }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { class C { m(){} } const c = new C(); return c.__proto__ === C.prototype; }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { class C { m(){} } return Object.getPrototypeOf(new C()) === C.prototype; }`))
      .toEqual({ ok: true, value: true });
  });

  it("用户覆写 Object.prototype 同名方法照常分派（own-property 命中自有层）", () => {
    expect(val(`export function f() { class C { toString() { return "C!"; } } return new C().toString(); }`))
      .toEqual({ ok: true, value: "C!" });
    expect(val(`export function f() { class C { hasOwnProperty(k) { return k === "z"; } } return new C().hasOwnProperty("z"); }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { class C { valueOf() { return 42; } } return new C().valueOf(); }`))
      .toEqual({ ok: true, value: 42 });
    expect(val(`export function f() { class C { ["toString"]() { return "S"; } } return new C().toString(); }`))
      .toEqual({ ok: true, value: "S" });
  });

  it("控制组：无实例成员的类 / 对象字面量 / 借用通道保持原口径", () => {
    expect(val(`export function f() { class C {} const c = new C(); return c.hasOwnProperty("v"); }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { class C {} const c = new C(); return c.__proto__ === C.prototype; }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { return ({ m(){} }).toString(); }`))
      .toEqual({ ok: true, value: "[object Object]" });
    expect(val(`export function f() { class C { m(){} } const c = new C(); return Object.prototype.hasOwnProperty.call(c, "m"); }`))
      .toEqual({ ok: true, value: false });
  });
});

describe("Bug 90：静态面（类值接收者）", () => {
  it("D.hasOwnProperty(\"m\") → true（静态方法是类值自有属性）；祖先静态 own-only false", () => {
    expect(val(`export function f() { class D { static m(){} } return D.hasOwnProperty("m"); }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { class A { static m(){} } class B extends A {} return B.hasOwnProperty("m"); }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { class D { static get m() { return 1; } } return D.hasOwnProperty("m"); }`))
      .toEqual({ ok: true, value: true });
    // 静态方法/访问器非枚举（PIE false）；静态字段可枚举（PIE true）
    expect(val(`export function f() { class D { static m(){} } return D.propertyIsEnumerable("m"); }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { class D { static get m(){} } return D.propertyIsEnumerable("m"); }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { class D { static s = 1; } return D.propertyIsEnumerable("s"); }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { class D { static m(){} } return "m" in D; }`))
      .toEqual({ ok: true, value: true });
  });

  it("D.toString() → 抽象 string（不假抛、不 wrong-exact）；静态覆写分派", () => {
    const src = `export function f() { class D { static m(){} } return D.toString(); }`;
    expect(shape(src)).toBe("string");
    expect(val(src)).not.toEqual({ ok: true, value: "[object Undefined]" });
    expect(isNever(call(src).result)).toBe(false);
    expect(val(`export function f() { class D { static toString() { return "D!"; } } return D.toString(); }`))
      .toEqual({ ok: true, value: "D!" });
  });
});

describe("Bug 90：L2 假阳（nudo:entry-may-throw）消除", () => {
  it("类实例/类值的 Object.prototype 方法面不再被标记 entry-may-throw", () => {
    for (const src of [
      `export function clsHasOwn() { class C { m(){} } const c = new C(); return c.hasOwnProperty("m"); }`,
      `export function clsValueOf() { class C { m(){} } const c = new C(); return typeof c.valueOf(); }`,
      `export function clsToString() { class C { m(){} } const c = new C(); return c.toString(); }`,
      `export function statHasOwn() { class D { static m(){} } return D.hasOwnProperty("m"); }`,
      `export function statToString() { class D { static m(){} } return D.toString(); }`,
    ]) {
      expect(l2Count(check(src)), src).toBe(0);
    }
  });

  it("签名不再显示假 throws（clsHasOwn 显示 boolean）", () => {
    const sig = sigOf(
      check(`export function clsHasOwn() { class C { m(){} } const c = new C(); return c.hasOwnProperty("m"); }`),
      "clsHasOwn",
    );
    expect(sig).not.toBe("(missing)");
    expect(sig).not.toContain("throws");
  });
});
