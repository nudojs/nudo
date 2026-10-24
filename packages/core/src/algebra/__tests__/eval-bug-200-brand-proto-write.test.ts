/**
 * Bug 200 回归（**写侧接线**）：`Object.assign(A.prototype, {…})` /
 * `Object.defineProperty(A.prototype, k, {…})` 写的是**原型对象**——原生
 * for-in 沿原型链能看到这些键。
 *
 * 根因：引擎的原型对象 = protoBrandAbs(name) 的内层 obj（读侧
 * containers/iterate.ts 的 brandProtoEnumerableKeys 枚举的正是它），而
 * 写侧此前：
 * - Object.assign 走 runtimeAssignObject（exec/class/assign.ts）——brand
 *   目标**无分支** ⇒ 静默丢弃；
 * - Object.defineProperty 走不可变更新（builtins/object/descriptor.ts 的
 *   applyPropertyDescriptor）——造出新 brand Abs，而类注册表 / 实例原型链
 *   仍持旧 brand ⇒ 装上了也**无人可见**。
 *
 * 修法：两处都**原地写**进注册表持有的原型对象（原型槽的既有约定——
 * `A.prototype.x = 1` 落同一 memo 对象）。
 *
 * 注：每个用例用**独立类名**——引擎的 protoBrandAbs 按名驻留，同名类串味。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 200 — 写侧接线：assign / defineProperty 写进原型对象", () => {
  it("Object.assign(A.prototype, {b:1}) → for-in 看得到 b（此前静默丢弃）", () => {
    expect(
      v(`export function f() {
        class P1 {}
        Object.assign(P1.prototype, { b: 1 });
        const keys = [];
        for (const k in new P1()) keys.push(k);
        return keys.join(",");
      }`),
    ).toEqual({ ok: true, value: "b" });
  });

  it("Object.defineProperty(A.prototype,'c',{value:2,enumerable:true}) → for-in 看得到 c", () => {
    expect(
      v(`export function f() {
        class P2 {}
        Object.defineProperty(P2.prototype, "c", { value: 2, enumerable: true, configurable: true });
        const keys = [];
        for (const k in new P2()) keys.push(k);
        return keys.join(",");
      }`),
    ).toEqual({ ok: true, value: "c" });
  });

  it("assign 写的键：实例读得到（原型链继承）", () => {
    expect(
      v(`export function f() {
        class P3 {}
        Object.assign(P3.prototype, { b: 1 });
        return String(new P3().b);
      }`),
    ).toEqual({ ok: true, value: "1" });
  });

  it("assign 写的键：原型面 hasOwnProperty → true", () => {
    expect(
      v(`export function f() {
        class P4 {}
        Object.assign(P4.prototype, { b: 1 });
        return String(Object.prototype.hasOwnProperty.call(P4.prototype, "b"));
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("assign 写的键：原型面直接读得到", () => {
    expect(
      v(`export function f() {
        class P5 {}
        Object.assign(P5.prototype, { b: 1 });
        return String(P5.prototype.b);
      }`),
    ).toEqual({ ok: true, value: "1" });
  });

  it("非 obj 源（数组字面量）→ 下标键写进原型", () => {
    expect(
      v(`export function f() {
        class P6 {}
        Object.assign(P6.prototype, [7, 8]);
        return String(P6.prototype[0]) + "/" + String(P6.prototype[1]);
      }`),
    ).toEqual({ ok: true, value: "7/8" });
  });

  it("负控制：类方法非可枚举 → for-in 仍只看到 assign 的键", () => {
    expect(
      v(`export function f() {
        class P7 { m() {} }
        Object.assign(P7.prototype, { b: 1 });
        const keys = [];
        for (const k in new P7()) keys.push(k);
        return keys.join(",");
      }`),
    ).toEqual({ ok: true, value: "b" });
  });

  it("负控制：普通对象的 assign / for-in 不变", () => {
    expect(
      v(`export function f() {
        const o = { x: 1 };
        const t = { y: 2 };
        Object.assign(o, t);
        const keys = [];
        for (const k in o) keys.push(k);
        return keys.join(",") + "/" + String(o.y);
      }`),
    ).toEqual({ ok: true, value: "x,y/2" });
  });
});
