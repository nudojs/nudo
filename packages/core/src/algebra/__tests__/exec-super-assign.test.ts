/**
 * Bug 55（super 属性赋值）：实例方法/构造器内 `super.x = v`（含复合赋值 /
 * 计算键）此前 AssignmentExpression 成员路径无 Super 拦截——裸发
 * `/* super *\/` 注释哨兵 → `$set(, "x", v)` 宿主硬 SyntaxError（整模块
 * 编译失败）。静态方法体（staticSuperSrc）不受影响。
 *
 * 修复：发射 $setSuper(thisParam, className, key, v)（类面）/ $setSuperObj
 * （对象字面量 home object 面）。语义（SetSuper）：父类原型链 setter 以
 * 接收者调用；getter-only → strict TypeError；无 setter → 原生折接收者
 * 自有数据属性（子类同名访问器不拦截——查找从父类起）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

describe("Bug 55: super 属性赋值（报告五个变体）", () => {
  it("super.x = 5 → b.x === 5", () => {
    const r = call(
      `export function f() { class A { constructor() { this.x = 1; } } class B extends A { inc() { super.x = 5; } } const b = new B(); b.inc(); return b.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("super.x += 5 → 接收者写（native NaN；闭父链缺槽 $getSuper 折 undefined → undefined+5 折 NaN）", () => {
    const r = call(
      `export function f() { class A { constructor() { this.x = 1; } } class B extends A { inc() { super.x += 5; } } const b = new B(); b.inc(); return b.x; }`,
    );
    // R2a：闭父链（全注册求值类、终止无 extends）缺槽读折 lit(undefined)
    //（与 new A().x / ({}).x 同口径）→ 复合赋值折 NaN = native
    expect(litValue(r.result)).toEqual({ ok: true, value: NaN });
  });

  it("super[k] = 5（计算键）→ b.x === 5", () => {
    const r = call(
      `export function f() { class A { constructor() { this.x = 1; } } class B extends A { inc() { const k = "x"; super[k] = 5; } } const b = new B(); b.inc(); return b.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("派生 setter：super.s = x * 2 → 父 setter 以接收者调用 → b.x === 6", () => {
    const r = call(
      `export function f() { class A { constructor() { this.x = 1; } set s(v) { this.x = v; } } class B extends A { set s2(v) { super.s = v * 2; } } const b = new B(); b.s2 = 3; return b.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });

  it("构造器 super() 后 super.x = 5 → b.x === 5", () => {
    const r = call(
      `export function f() { class A { constructor() { this.x = 1; } } class B extends A { constructor() { super(); super.x = 5; } } const b = new B(); return b.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });
});

describe("Bug 55: SetSuper 语义边界", () => {
  it("静态方法 super.x = 5（R5 receiver 化）：写落 this（B.x），父类 A.x 不动", () => {
    // R5：静态方法体 this = 类值后，super.x = v 按原生 SetSuper——父类
    // 无 setter → CreateDataProperty on receiver（this = B）。此前引擎按
    // staticSuperSrc 近似写父类 A.x（Bug 55 时代的临时口径）。
    const r = call(
      `export function f() { class A {} class B extends A { static inc() { super.x = 5; } } B.inc(); return B.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
    const rA = call(
      `export function f() { class A {} class B extends A { static inc() { super.x = 5; } } B.inc(); return A.x; }`,
    );
    expect(litValue(rA.result)).toEqual({ ok: true, value: undefined });
  });

  it("静态方法 super.x = v 覆写父类静态数据字段：父类值不动，B.x = v（native）", () => {
    const r = call(
      `export function f() { class A { static x = 1; } class B extends A { static inc() { super.x = 5; } } B.inc(); return B.x + A.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });

  it("对象字面量方法（home object）super.s = v → 原型 setter 以接收者调用", () => {
    const r = call(
      `export function f() { const base = { set s(v) { this.out = v * 2; } }; const o = { __proto__: base, set2(v) { super.s = v; } }; o.set2(3); return o.out; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });

  it("子类自有同名 setter 不拦截 super 写（查找从父类起）→ 自有槽直写", () => {
    const r = call(
      `export function f() { class A {} class B extends A { set x(v) { this.hijack = v; } m() { super.x = 5; } } const b = new B(); b.m(); return b.x + "|" + (b.hijack === undefined); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "5|true" });
  });

  it("父链 getter-only 访问器 → strict TypeError（catch 可吸收）", () => {
    const r = call(
      `export function f() { class A { get x() { return 1; } } class B extends A { m() { super.x = 5; } } const b = new B(); b.m(); return b.x; }`,
    );
    expect(r.throws.shape.k === "brand" && r.throws.shape.name === "TypeError").toBe(true);
  });
});

describe("R2a: super 读闭链缺槽折 undefined（原 unknown → 复合赋值 NaN 精确化）", () => {
  it("super.x += 5（报告复现）：A.prototype.x 原生 undefined → NaN", () => {
    const r = call(
      `export function f() { class A {} class B extends A { inc() { super.x += 5; } } const b = new B(); b.inc(); return b.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: NaN });
  });

  it("super.x 纯读：闭链缺槽折 undefined（= native）", () => {
    const r = call(
      `export function f() { class A {} class B extends A { g() { return super.x; } } return new B().g(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("多级闭链缺槽：class C extends B extends A 同折 undefined", () => {
    const r = call(
      `export function f() { class A {} class B extends A {} class C extends B { g() { return super.zz; } } return new C().g(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("Object.prototype 尾巴不折 undefined：方法名/constructor 保持既有投影", () => {
    const r = call(
      `export function f() { class A {} class B extends A { g() { return typeof super.hasOwnProperty; } } return new B().g(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
    const r2 = call(
      `export function f() { class A {} class B extends A { g() { return super.constructor === Object; } } return new B().g(); }`,
    );
    expect(litValue(r2.result)).toEqual({ ok: true, value: true });
  });

  it("开链（extends Array）缺槽保持诚实 unknown（宿主原型面不可枚举）", () => {
    const r = call(
      `export function f() { class B extends Array { g() { return super.zz; } } return new B().g(); }`,
    );
    expect(litValue(r.result).ok).toBe(false);
  });

  it("链上方法作为值：诚实 unknown 不下折 undefined", () => {
    const r = call(
      `export function f() { class A { m() {} } class B extends A { g() { return super.m; } } return new B().g(); }`,
    );
    expect(litValue(r.result).ok).toBe(false);
  });

  it("setter-only 访问器挡链：super 读折 undefined（native 同）", () => {
    const r = call(
      `export function f() { class A { set x(v) { this.y = v; } } class B extends A { g() { return super.x; } } return new B().g(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("父访问器 getter 精确面不回归（Bug 14 原口径）", () => {
    const r = call(
      `export function f() { class A { get x() { return 7; } } class B extends A { g() { return super.x; } } return new B().g(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("对象字面量方法（home object）闭链缺槽折 undefined", () => {
    const r = call(
      `export function f() { const p = { y: 1 }; const o = { __proto__: p, g() { return super.q; } }; return o.g(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
    const r2 = call(
      `export function f() { const o = { g() { return super.zz; } }; return o.g(); }`,
    );
    expect(litValue(r2.result)).toEqual({ ok: true, value: undefined });
  });

  it("对象字面量 home 原型数据槽直读不回归（Bug 19 原口径）", () => {
    const r = call(
      `export function f() { const o = { __proto__: { y: 1 }, g() { return super.y; } }; return o.g(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 55: differential native 对照（隐式 return 体）", () => {
  const corpus = [
    `class A { constructor() { this.x = 1; } } class B extends A { inc() { super.x = 5; } } const b = new B(); b.inc(); return b.x;`,
    `class A { constructor() { this.x = 1; } } class B extends A { inc() { const k = "x"; super[k] = 5; } } const b = new B(); b.inc(); return b.x;`,
    `class A { set s(v) { this.x = v; } } class B extends A { set s2(v) { super.s = v * 2; } } const b = new B(); b.s2 = 3; return b.x;`,
    `class A { constructor() { this.x = 1; } } class B extends A { constructor() { super(); super.x = 5; } } const b = new B(); return b.x;`,
    `class A { get x() { return 1; } } class B extends A { m() { super.x = 5; } } const b = new B(); b.m(); return b.x;`,
    `const base = { set s(v) { this.out = v * 2; } }; const o = { __proto__: base, set2(v) { super.s = v; } }; o.set2(3); return o.out;`,
    // R2a：闭链缺槽读/复合赋值折精确（= native undefined / NaN）
    `class A {} class B extends A { inc() { super.x += 5; } } const b = new B(); b.inc(); return b.x;`,
    `class A {} class B extends A { g() { return super.x; } } return new B().g();`,
    `class A {} class B extends A {} class C extends B { g() { return super.zz; } } return new C().g();`,
    `const p = { y: 1 }; const o = { __proto__: p, g() { return super.q; } }; return o.g();`,
    `class A { set x(v) { this.y = v; } } class B extends A { g() { return super.x; } } return new B().g();`,
  ];
  it.each(corpus.map((body, i) => [i, body] as const))(
    "语料 #%i 与 native 一致",
    (_i, body) => {
      expect(diffBody(body)).toBeNull();
    },
  );
});
