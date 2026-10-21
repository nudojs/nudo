/**
 * Bug 197 回归（**Reflect.set 镜像** + **原型槽落地**）：
 *
 * ① Reflect.set 镜像：core 侧 $set（strict 赋值）按 [[Set]] 原型链写门判定
 *    （exec/runtime/proto-set.ts 的 protoChainSetVerdict）——receiver 无自有
 *    该键时沿 [[Prototype]] 链上溯，首个持有该键的原型的访问器（无 setter）/
 *    不可写数据属性 / frozen 原型 ⇒ **strict 赋值抛 TypeError**。原生
 *    **Reflect.set 在写门失败时返 false（不抛）**——抛错是 strict 赋值的
 *    语义。此前 Reflect.set 直接走 $set ⇒ 写门失败时抛 TypeError（原生不抛
 *    ——B197-04 的 1 条不一致）。
 *    本文件覆盖 **Object.create(proto)** 口径（protoTable 有登记 ⇒ 门可见）。
 *
 * ② 原型槽落地：`Object.defineProperty(X.prototype, k, desc)` 此前走不可变
 *    更新——造出新 brand Abs，而类注册表 / 实例原型链仍持旧 brand ⇒ 装上的
 *    属性**无人可见**（`X.prototype.hasOwnProperty(k)` 折 false、实例读不到）。
 *    descriptor.ts 改为**原地装**进注册表持有的原型对象（原型槽的既有约定）。
 *
 * 遗留（越界，见交付报告）：
 * - 类实例读原型上的**动态访问器**仍走类注册表（spec.accessors）⇒ 读不到
 *   getter 的值（S8 侧）；本文件只钉住**数据属性**与 presence 面。
 *
 * 已接线（S16）：类实例的原型链写门——proto-set.ts 改用 protoOfRecv（类注册表
 * / 品牌名面）解析类实例的 [[Prototype]]（此前只查 protoTable，类实例未登记
 * ⇒ 门恒 allow ⇒ `Reflect.set(new A(), …)` 在原型只读属性上不拒写）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 定抛探针：结果 never + throws 面是指定错误类型 */
function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 197 — Reflect.set 写门失败返 false（不抛）", () => {
  it("原型链 getter-only → Reflect.set 返 false（此前抛 TypeError）", () => {
    expect(
      v(`export function f() {
        const p = { get a() { return 7; } };
        const o = Object.create(p);
        return String(Reflect.set(o, "a", 5));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("原型链 writable:false 数据属性 → Reflect.set 返 false", () => {
    expect(
      v(`export function f() {
        const p = {};
        Object.defineProperty(p, "x", { value: 1, writable: false });
        const o = Object.create(p);
        return String(Reflect.set(o, "x", 2));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("原型链带 setter → Reflect.set 返 true 且 setter 被派发", () => {
    expect(
      v(`export function f() {
        let seen = "";
        const p = { set a(v) { seen = String(v); } };
        const o = Object.create(p);
        return String(Reflect.set(o, "a", 5)) + "/" + seen;
      }`),
    ).toEqual({ ok: true, value: "true/5" });
  });

  it("负控制：自有可写属性 → true 且值生效", () => {
    expect(
      v(`export function f() {
        const o = { a: 1 };
        const r = Reflect.set(o, "a", 5);
        return String(r) + "/" + String(o.a);
      }`),
    ).toEqual({ ok: true, value: "true/5" });
  });

  it("负控制：自有不可写（frozen）→ false", () => {
    expect(
      v(`export function f() {
        const o = Object.freeze({ a: 1 });
        return String(Reflect.set(o, "a", 5));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("负控制：新键 → true（建自有属性）", () => {
    expect(
      v(`export function f() {
        const o = {};
        const r = Reflect.set(o, "b", 5);
        return String(r) + "/" + String(o.b);
      }`),
    ).toEqual({ ok: true, value: "true/5" });
  });

  it("负控制：strict 赋值仍抛 TypeError（core 侧写门不变）", () => {
    expect(
      threw(`export function f() {
        const p = { get a() { return 7; } };
        const o = Object.create(p);
        o.a = 5;
        return "no-throw";
      }`),
    ).toBe(true);
  });
});

describe("Bug 197 — defineProperty 装到 X.prototype 上（原型槽落地）", () => {
  it("X.prototype.hasOwnProperty(k) → true（此前折 false：装到无人持有的新 brand）", () => {
    expect(
      v(`export function f() {
        class A {}
        Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
        return String(A.prototype.hasOwnProperty("x"));
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("X.prototype.k → 1（原型面读得到）", () => {
    expect(
      v(`export function f() {
        class A {}
        Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
        return String(A.prototype.x);
      }`),
    ).toEqual({ ok: true, value: "1" });
  });

  it("实例读继承该原型数据属性 → 1（原型链可见）", () => {
    expect(
      v(`export function f() {
        class A {}
        Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
        const a = new A();
        return String(a.x);
      }`),
    ).toEqual({ ok: true, value: "1" });
  });

  it("实例面 Reflect.set(new A(), 'x', 2) → false（proto-set.ts 经 protoOfRecv 解析类实例原型链）", () => {
    expect(
      v(`export function f() {
        class A {}
        Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
        return String(Reflect.set(new A(), "x", 2));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("实例面 strict 赋值 a.x = 2 → TypeError（同一写门，strict 语义）", () => {
    expect(
      threw(`export function f() {
        class A {}
        Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
        const a = new A();
        a.x = 2;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：原型上 writable:true → Reflect.set 返 true", () => {
    // 类名/键名与上文用例**不重名**——`protoBrandAbs(name)` 按名驻留（进程级
    // 单例），同名类会共用同一原型对象（描述符的 [[Writable]] 残留会串味）。
    expect(
      v(`export function f() {
        class A197w {}
        Object.defineProperty(A197w.prototype, "w", { value: 1, writable: true, configurable: true });
        return String(Reflect.set(new A197w(), "w", 2));
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制：原型上没有该键 → Reflect.set 返 true（建自有属性）", () => {
    expect(
      v(`export function f() {
        class A197n {}
        const a = new A197n();
        const r = Reflect.set(a, "w", 2);
        return String(r) + "/" + String(a.w);
      }`),
    ).toEqual({ ok: true, value: "true/2" });
  });

  it.todo(
    "实例读原型上的动态 getter → getter 的值（需类注册表登记动态访问器——S8 侧越界；实例读走 spec.accessors）",
  );
});
