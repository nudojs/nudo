/**
 * R5：静态成员 this 模型——this = 类值（接收者）。
 *
 * 此前静态方法/静态字段 impl 无 __this 载体：`this` 折 lit(undefined)
 *（`this === B` 假 false、`typeof this` 假 "undefined"、`this.x` 硬抛
 * TypeError → 模块装载失败）；super.x = v 按 staticSuperSrc 近似错写父类
 * 槽（原生 SetSuper 数据字段/缺槽 → CreateDataProperty on receiver）。
 *
 * 修复（与实例方法 __this 载体同构）：
 * - 静态方法 impl 首参 __this；$staticInvoke / $invoke（沿链 findStaticMethod）
 *   注入类值（沿链调用时 = 调用类，非定义类）；
 * - 静态方法体 transpile 边界 = methodOptsBase（thisParam/className/
 *   循环-try 归零）——箭头经词法 thisParam 捕获类值；
 * - 静态字段值改 thunk，$class 建类值后以类值为 this 逐槽求值（源序）；
 * - super.k = v / super.m() 静态面：$setSuperStatic / $staticSuperInvoke
 *  （父类静态 setter 派发；数据字段/缺槽 → 接收者类值自有写）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

describe("R5: static-method this = class value (receiver)", () => {
  it("repro1: return this → B（this === B 折 true）", () => {
    const r = call(
      `export function f() { class B { static m() { return this; } } return B.m() === B; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(diffBody(`class B { static m() { return this; } } return B.m() === B;`)).toBeNull();
  });

  it("repro2: this.y = 5 → 类值自有槽（B.y = 5，共享 slots 引用语义）", () => {
    const r = call(
      `export function f() { class A { static x = 1; } class B extends A { static m() { this.y = 5; } } B.m(); return B.y; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
    expect(diffBody(
      `class A { static x = 1; } class B extends A { static m() { this.y = 5; } } B.m(); return B.y;`,
    )).toBeNull();
  });

  it("repro3: 静态体内箭头词法捕获 this（f() === B）", () => {
    const r = call(
      `export function f() { class B { static m() { const f = () => this; return f() === B; } } return B.m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(diffBody(
      `class B { static m() { const f = () => this; return f() === B; } } return B.m();`,
    )).toBeNull();
  });

  it("repro4: typeof this → \"function\"（类值是构造器函数）", () => {
    const r = call(
      `export function f() { class B { static m() { return typeof this; } } return B.m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
    expect(diffBody(`class B { static m() { return typeof this; } } return B.m();`)).toBeNull();
  });

  it("this.v 读静态字段槽", () => {
    const r = call(
      `export function f() { class B { static v = 3; static m() { return this.v; } } return B.m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("沿链调用派发到定义类，this = 调用类（B.m() 继承 A.m：this === B）", () => {
    const r = call(
      `export function f() { class A { static m() { return this; } } class B extends A {} return B.m() === B; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("this.m2() 静态方法互调", () => {
    const r = call(
      `export function f() { class B { static a() { return this.b(); } static b() { return 42; } } return B.a(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });
  });

  it("this.#c 私有静态字段（privateNameGuard 类值面）", () => {
    const r = call(
      `export function f() { class P { static #c = 4; static m() { return this.#c; } } return P.m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 4 });
  });

  it("this.x = v 派发静态 setter（this = 类值）", () => {
    const r = call(
      `export function f() { class B { static out; static set x(v) { this.out = v * 2; } static m() { this.x = 9; } } B.m(); return B.out; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 18 });
  });

  it("箭头词法 this 与嵌套普通函数动态 this 分流（strict undefined）", () => {
    const r = call(
      `export function f() { class B { static m() { const f = () => this; const g = function () { return this === undefined; }; return f() === B && g(); } } return B.m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });
});

describe("R5: super 静态面（SetSuper / CallSuper 接收者 = this 类值）", () => {
  it("super.x = v（父类静态数据字段）→ CreateDataProperty on B：B.x = v、A.x 不动", () => {
    const r = call(
      `export function f() { class A { static x = 1; } class B extends A { static inc() { super.x = 5; } } B.inc(); return B.x + A.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
    expect(diffBody(
      `class A { static x = 1; } class B extends A { static inc() { super.x = 5; } } B.inc(); return B.x + A.x;`,
    )).toBeNull();
  });

  it("super.x = v（父类缺槽）→ B.x 自有写", () => {
    const r = call(
      `export function f() { class A {} class B extends A { static inc() { super.x = 5; } } B.inc(); return B.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("super.x = v 派发父类静态 setter（this = 接收者类值 B）", () => {
    const r = call(
      `export function f() { class A { static set x(v) { this.out = v; } } class B extends A { static out; static inc() { super.x = 7; } } B.inc(); return B.out; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("super.x += v 复合赋值：读父类槽、写接收者自有槽", () => {
    const r = call(
      `export function f() { class A { static x = 1; } class B extends A { static inc() { super.x += 5; } } B.inc(); return B.x + A.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("super.x 读不回归（父类静态槽直读）", () => {
    const r = call(
      `export function f() { class A { static x = 1; } class B extends A { static get() { return super.x; } } return B.get(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("super.m() 调用接收者 = this（调用类，非父类）", () => {
    const r = call(
      `export function f() { class A { static m() { return this; } } class B extends A { static n() { return super.m() === B; } } return B.n(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("super.n() 多级链组合不回归（Bug 18 语料）", () => {
    const r = call(
      `export function f() { class A { static n() { return 10; } } class B extends A { static n() { return super.n() + 5; } } class C extends B {} return C.n(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 15 });
  });
});

describe("R5: 静态字段初始化器 this（thunk 以类值求值）", () => {
  it("static x = this.n → 读先定义的静态字段槽", () => {
    const r = call(
      `export function f() { class C { static n = 3; static x = this.n; } return C.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    expect(diffBody(`class C { static n = 3; static x = this.n; } return C.x;`)).toBeNull();
  });

  it("static s = this → 类值身份（C.s === C）", () => {
    const r = call(
      `export function f() { class C { static s = this; } return C.s === C; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("静态字段初始化器内箭头捕获 this", () => {
    const r = call(
      `export function f() { class C { static tag = "T"; static f = () => this.tag; } return C.f(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "T" });
  });
});

describe("R5: 不回归面", () => {
  it("无 this 静态成员不受影响（值/签名不变）", () => {
    const r = call(
      `export function f() { class A { static base = 1; static m(a) { return a + 2; } } return A.m(A.base); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("实例方法 this 载体不回归", () => {
    const r = call(
      `export function f() { class B { constructor() { this.v = 8; } m() { return this.v; } } return new B().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 8 });
  });

  it("静态块 this 不回归（this.t = v → 类值槽）", () => {
    const r = call(
      `export function f() { class S { static t; static { this.t = 7; } } return S.t; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("静态访问器 this 不回归", () => {
    const r = call(
      `export function f() { class F { static get g() { return this.tag; } static tag = "T"; } return F.g; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "T" });
  });
});
