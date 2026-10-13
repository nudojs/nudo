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

  it("super.x += 5 → 接收者写（native NaN；引擎读面 super.x 为 unknown → 写 number|string，sound 含 NaN）", () => {
    const r = call(
      `export function f() { class A { constructor() { this.x = 1; } } class B extends A { inc() { super.x += 5; } } const b = new B(); b.inc(); return b.x; }`,
    );
    // $getSuper 对未建模的原型数据属性返回 unknown（诚实），复合赋值
    // 结果域 number|string ⊇ native NaN——非 wrong-exact
    const lv = litValue(r.result);
    expect(lv.ok).toBe(false);
    expect(r.result.shape.k).toBe("sum");
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
  it("静态方法 super.x = 5（staticSuperSrc 既有路径）不回归：引擎近似写父类值（无 SyntaxError）", () => {
    // 注：引擎静态方法体 this 未建模（`this` 折 undefined，`this.x = 3` 假抛）
    // ——原生 receiver 是 this（B.x = 5）；引擎按 staticSuperSrc 近似写父类
    // A.x = 5。Bug 55 范围只修实例面；静态 receiver 化依赖静态 this 建模。
    const r = call(
      `export function f() { class A {} class B extends A { static inc() { super.x = 5; } } B.inc(); return A.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
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

describe("Bug 55: differential native 对照（隐式 return 体）", () => {
  const corpus = [
    `class A { constructor() { this.x = 1; } } class B extends A { inc() { super.x = 5; } } const b = new B(); b.inc(); return b.x;`,
    `class A { constructor() { this.x = 1; } } class B extends A { inc() { const k = "x"; super[k] = 5; } } const b = new B(); b.inc(); return b.x;`,
    `class A { set s(v) { this.x = v; } } class B extends A { set s2(v) { super.s = v * 2; } } const b = new B(); b.s2 = 3; return b.x;`,
    `class A { constructor() { this.x = 1; } } class B extends A { constructor() { super(); super.x = 5; } } const b = new B(); return b.x;`,
    `class A { get x() { return 1; } } class B extends A { m() { super.x = 5; } } const b = new B(); b.m(); return b.x;`,
    `const base = { set s(v) { this.out = v * 2; } }; const o = { __proto__: base, set2(v) { super.s = v; } }; o.set2(3); return o.out;`,
  ];
  it.each(corpus.map((body, i) => [i, body] as const))(
    "语料 #%i 与 native 一致",
    (_i, body) => {
      expect(diffBody(body)).toBeNull();
    },
  );
});
