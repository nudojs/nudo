/**
 * Bug 197 回归（**类实例面**的 [[Set]] 原型链写门）。
 *
 * 背景：core 侧 $set（strict 赋值）与 Reflect.set 共用
 * exec/runtime/proto-set.ts 的 protoChainSetVerdict——receiver **无自有该键**
 * 时沿 [[Prototype]] 链上溯，首个持有该键的原型的访问器（无 setter）/ 不可写
 * 数据属性 / frozen 原型 ⇒ 写门失败。
 *
 * 修复前：proto-set.ts 只查 protoTable（objects.ts 的 getProtoAbs）——**类实例
 * 未登记 protoTable** ⇒ 原型链恒空 ⇒ 写门恒 allow ⇒
 * `Reflect.set(new A(), "x", 2)` 在原型上的只读属性上**不拒写**（原生返
 * false / strict 赋值抛 TypeError）——门禁假绿。
 *
 * 修法（S16）：
 * - proto-set.ts 改用 protoOfRecv（builtins/ctor.ts）解析**类注册表 / 品牌
 *   名面**——类实例的 [[Prototype]] 是 `A.prototype`（protoBrandAbs 按名驻留
 *   的 brand Abs，与 `A.prototype` 成员读同一引用）；
 * - exec/runtime/containers/member.ts 的**类实例臂**（strict 赋值通道）也过
 *   同一道门——此前类实例面完全不过写门。
 *
 * 口径：Reflect.set 写门失败**返 false（不抛）**；strict 赋值**抛 TypeError**。
 *
 * ⚠ 用例隔离：`protoBrandAbs(name)` 按类名驻留（**进程级单例**）——同名类
 * 共用同一原型对象，上一用例装到原型上的描述符（含 [[Writable]]）会串味。
 * 故本文件每个用例用**互不重名**的类名与键名。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 定抛探针：结果 never + throws 面是指定错误类型 */
function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 197 — 类实例面 Reflect.set 的原型链写门", () => {
  it("原型上 writable:false → Reflect.set 返 false（此前返 true）", () => {
    expect(
      v(`export function f() {
        class Ag197a {}
        Object.defineProperty(Ag197a.prototype, "x", { value: 1, writable: false, configurable: true });
        return String(Reflect.set(new Ag197a(), "x", 2));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("原型上 getter-only → Reflect.set 返 false（此前返 true）", () => {
    expect(
      v(`export function f() {
        class Ag197b {}
        Object.defineProperty(Ag197b.prototype, "y", { get() { return 7; }, configurable: true });
        return String(Reflect.set(new Ag197b(), "y", 2));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("派生类实例同样过门（原型链经类注册表上溯）", () => {
    expect(
      v(`export function f() {
        class Ag197c {}
        class Ag197d extends Ag197c {}
        Object.defineProperty(Ag197c.prototype, "x", { value: 1, writable: false, configurable: true });
        return String(Reflect.set(new Ag197d(), "x", 2));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("负控制：原型上 writable:true → Reflect.set 返 true", () => {
    expect(
      v(`export function f() {
        class Ag197e {}
        Object.defineProperty(Ag197e.prototype, "z", { value: 1, writable: true, configurable: true });
        return String(Reflect.set(new Ag197e(), "z", 2));
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制：原型上没有该键 → Reflect.set 返 true（建自有属性）", () => {
    expect(
      v(`export function f() {
        class Ag197f {}
        const a = new Ag197f();
        const r = Reflect.set(a, "w", 2);
        return String(r) + "/" + String(a.w);
      }`),
    ).toEqual({ ok: true, value: "true/2" });
  });

  it("负控制：实例自有可写字段 → Reflect.set 返 true 且值生效", () => {
    expect(
      v(`export function f() {
        class Ag197g { constructor() { this.n = 1; } }
        const a = new Ag197g();
        const r = Reflect.set(a, "n", 5);
        return String(r) + "/" + String(a.n);
      }`),
    ).toEqual({ ok: true, value: "true/5" });
  });
});

describe("Bug 197 — 类实例面 strict 赋值的原型链写门", () => {
  it("原型上 writable:false → a.x = 2 抛 TypeError（此前静默写穿）", () => {
    expect(
      threw(`export function f() {
        class Ag197h {}
        Object.defineProperty(Ag197h.prototype, "x", { value: 1, writable: false, configurable: true });
        const a = new Ag197h();
        a.x = 2;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("原型上 getter-only → a.y = 2 抛 TypeError（此前静默写穿）", () => {
    expect(
      threw(`export function f() {
        class Ag197i {}
        Object.defineProperty(Ag197i.prototype, "y", { get() { return 7; }, configurable: true });
        const a = new Ag197i();
        a.y = 2;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：原型上 writable:true → a.x = 2 不抛", () => {
    expect(
      threw(`export function f() {
        class Ag197j {}
        Object.defineProperty(Ag197j.prototype, "x", { value: 1, writable: true, configurable: true });
        const a = new Ag197j();
        a.x = 2;
        return "no-throw";
      }`),
    ).toBe(false);
  });

  it("负控制：实例字段赋值不抛", () => {
    expect(
      threw(`export function f() {
        class Ag197k { constructor() { this.n = 1; } }
        const a = new Ag197k();
        a.n = 5;
        return "no-throw";
      }`),
    ).toBe(false);
  });
});
