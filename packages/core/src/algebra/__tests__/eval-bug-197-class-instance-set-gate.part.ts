// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): eval-bug-197-class-instance-set-gate.test.ts + eval-bug-197-reflect-set-mirror.test.ts + eval-bug-197-set-write-gate.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, isNever, throwsError } from "./eval-helpers.ts";

describe("[merged] eval-bug-197-class-instance-set-gate.test.ts", () => {
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
});

describe("[merged] eval-bug-197-reflect-set-mirror.test.ts", () => {
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
});

describe("[merged] eval-bug-197-set-write-gate.test.ts", () => {
/**
 * Bug 197：[[Set]] 写门只看**自有**槽与类注册表——原型链上的访问器 / 不可写
 * 槽被跳过，显式 `writable:false` 在 fn / 索引臂根本不被查。
 *
 * 修法（containers/member.ts 的 $set 写面 + containers/arr-index.ts 的
 * $idxSet 写面 + exec/runtime/proto-set.ts 新叶子）：
 * - receiver **无自有该键**时沿 [[Prototype]] 链上溯（OrdinarySet）：
 *   访问器（无 setter）→ strict TypeError；带 setter → 派发 setter；
 *   数据属性 writable:false / frozen 原型 → strict TypeError；
 * - fn 臂 / 静态类值臂 / 数组下标臂补查 defineProperty 的 writable:false。
 *
 * 负控制：自有可写属性、类字面量访问器、Object.assign 到继承 non-writable
 * （既有已正确）——不得被本次修复波及。
 */




function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 定抛探针：结果 never + throws 面是指定错误类型 */
function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 197: [[Set]] 原型链写门 / writable:false 全面覆盖", () => {
  it("原型链 getter-only（Object.create）→ strict TypeError", () => {
    expect(
      threw(`export function f() {
        const p = { get a() { return 7; } };
        const o = Object.create(p);
        o.a = 5;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("原型链 writable:false 数据属性 → strict TypeError", () => {
    expect(
      threw(`export function f() {
        const p = {};
        Object.defineProperty(p, "x", { value: 1, writable: false });
        const o = Object.create(p);
        o.x = 2;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("原型链 frozen → strict TypeError", () => {
    expect(
      threw(`export function f() {
        const p = { a: 1 };
        Object.freeze(p);
        const o = Object.create(p);
        o.a = 2;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("两级原型链 getter → strict TypeError", () => {
    expect(
      threw(`export function f() {
        const p = { get x() { return 1; } };
        const o = Object.create(p);
        const q = Object.create(o);
        q.x = 5;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("原型链带 setter 的访问器 → 派发 setter（不是静默建自有属性）", () => {
    expect(
      v(`export function f() {
        let seen = 0;
        const p = { set a(v) { seen = v; } };
        const o = Object.create(p);
        o.a = 9;
        return seen;
      }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("fn 上 defineProperty writable:false → strict TypeError", () => {
    expect(
      threw(`export function f() {
        function g() {}
        Object.defineProperty(g, "x", { value: 3, writable: false });
        g.x = 4;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("数组下标 defineProperty writable:false → strict TypeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2];
        Object.defineProperty(a, "0", { value: 5, writable: false });
        a[0] = 6;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：自有可写属性写 → 成功（值生效）", () => {
    expect(
      v(`export function f() {
        const o = { a: 1 };
        o.a = 5;
        return o.a;
      }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("负控制：原型链普通可写属性 → receiver 建自有属性（值生效）", () => {
    expect(
      v(`export function f() {
        const p = { a: 1 };
        const o = Object.create(p);
        o.a = 5;
        return o.a;
      }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("负控制：类字面量访问器（继承面）→ TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        class A { get y() { return 7; } }
        class B extends A {}
        const b = new B();
        b.y = 1;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：Object.assign 到继承 non-writable → TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const p = {};
        Object.defineProperty(p, "x", { value: 1, writable: false });
        const t = Object.create(p);
        Object.assign(t, { x: 2 });
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：函数 expando 写（未 defineProperty）→ 仍成功", () => {
    expect(
      threw(`export function f() {
        function g() {}
        g.x = 4;
        return "no-throw";
      }`),
    ).toBe(false);
  });
});
});
