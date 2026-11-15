// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): eval-bug-200-brand-proto-write.test.ts + eval-bug-200-for-in-proto-keys.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, val } from "./eval-helpers.ts";

describe("[merged] eval-bug-200-brand-proto-write.test.ts", () => {
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
});

describe("[merged] eval-bug-200-for-in-proto-keys.test.ts", () => {
/**
 * Bug 200 回归：`for..in` 遍历 **brand 实例**必须沿原型链枚举可枚举键。
 *
 * ES 语义（EnumerateObjectProperties）：`for..in` 枚举对象**自身**的可枚举
 * 属性，再沿**原型链**向上继续（同名键不重复）。class / function 的实例的
 * 原型链上有 `prototype.b = 2` 这类可枚举属性 ⇒ 原生 `for..in` 能看到它们。
 *
 * 修复前：引擎的 `for..in`（brand 接收者）只枚举**实例自身**槽 ⇒ 原型上的
 * 可枚举键**丢失**（wrong-exact）：`for (const x in new A())` 原生 `"ab"`，
 * 引擎 `"a"`。
 *
 * 负控制：原型上的**方法**（class 方法是非可枚举的）不出现在 `for..in`；
 * 普通对象的 `for..in` 不变；`Object.keys` 仍只给自有可枚举键。
 */



describe("Bug 200：for..in 遍历 brand 实例沿原型链枚举可枚举键", () => {
  it("class 实例：原型上的可枚举属性被枚举", () => {
    expect(
      val(`export function f() {
        class A200t1 { constructor() { this.a = 1; } }
        A200t1.prototype.b = 2;
        let k = "";
        for (const x in new A200t1()) k += x;
        return k;
      }`),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("class 实例：for..in 的枚举个数包含原型键", () => {
    expect(
      val(`export function f() {
        class A200t2 { constructor() { this.a = 1; } }
        A200t2.prototype.b = 2;
        let n = 0;
        for (const x in new A200t2()) n++;
        return n;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("function 原型：原型上的可枚举属性被枚举", () => {
    expect(
      val(`export function f() {
        function F() { this.a = 1; }
        F.prototype.b = 2;
        let n = 0;
        for (const x in new F()) n++;
        return n;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("派生类：整条原型链的可枚举键都被枚举", () => {
    expect(
      val(`export function f() {
        class A200t4 { constructor() { this.a = 1; } }
        class B200t4 extends A200t4 { constructor() { super(); this.b = 2; } }
        A200t4.prototype.p = 9;
        let k = "";
        for (const x in new B200t4()) k += x;
        return k;
      }`),
    ).toEqual({ ok: true, value: "abp" });
  });

  it("派生类：原型上的方法（class 方法非可枚举）不出现", () => {
    expect(
      val(`export function f() {
        class A200t5 { constructor() { this.a = 1; } }
        class B200t5 extends A200t5 { m() {} constructor() { super(); this.b = 2; } }
        let k = "";
        for (const x in new B200t5()) k += x;
        return k;
      }`),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("原型键被覆写后仍只枚举一次", () => {
    expect(
      val(`export function f() {
        class A200t6 { constructor() { this.a = 1; } }
        A200t6.prototype.b = 2;
        A200t6.prototype.b = 3;
        let k = "";
        for (const x in new A200t6()) k += x;
        return k;
      }`),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("负控制：class 方法非可枚举 ⇒ 不出现在 for..in", () => {
    expect(
      val(`export function f() {
        class A200t7 { m() {} constructor() { this.a = 1; } }
        let n = 0;
        for (const x in new A200t7()) n++;
        return n;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：普通对象的 for..in 不变", () => {
    expect(val(`export function f() { const o = { a: 1, b: 2 }; let k = ""; for (const x in o) k += x; return k; }`)).toEqual({
      ok: true,
      value: "ab",
    });
  });

  it("负控制：Object.keys 仍只给自有可枚举键（原型键不混入）", () => {
    expect(
      val(`export function f() {
        class A200t9 { constructor() { this.a = 1; } }
        A200t9.prototype.b = 2;
        return Object.keys(new A200t9()).join(",");
      }`),
    ).toEqual({ ok: true, value: "a" });
  });

  it("负控制：原型上的属性读取仍正常", () => {
    expect(
      val(`export function f() {
        class A200t10 { constructor() { this.a = 1; } }
        A200t10.prototype.b = 2;
        return String(new A200t10().b);
      }`),
    ).toEqual({ ok: true, value: "2" });
  });
});
});
