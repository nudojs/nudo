/**
 * P2a：类方法一等值读取的引用身份（驻留侧表）。
 * 原生：静态方法挂**定义类**构造器、实例方法挂定义类 .prototype——
 * `B.m === A.m`（空派生类沿静态链解析到 A 的条目）是同一函数对象 →
 * true；不同键 / 覆盖（不同定义类）→ false。此前每次 $get 读取都捏
 * 全新 fn Abs（未驻留未打标）→ === 只折 boolean 域（丢精度）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";
import { diffBody } from "./differential/harness.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 断言折成具体布尔（非 boolean 域丢精度）并值相等 */
function expectBool(src: string, expected: boolean) {
  const r = v(src);
  if (!r.ok) {
    throw new Error(`expected literal boolean ${expected}, got non-literal result (boolean domain / unknown)`);
  }
  expect(r.value).toEqual(expected);
}

describe("P2a: 静态方法值读身份（定义类驻留）", () => {
  it("class B extends A {}：B.m === A.m → true（同一静态条目）", () => {
    expectBool(
      `export function f() { class A { static m() { return 1; } } class B extends A {} return B.m === A.m; }`,
      true,
    );
  });

  it("重复读取：A.m === A.m → true", () => {
    expectBool(`export function f() { class A { static m() {} } return A.m === A.m; }`, true);
  });

  it("别名接收者：const X = B; X.m === A.m → true", () => {
    expectBool(
      `export function f() { class A { static m() {} } class B extends A {} const X = B; return X.m === A.m; }`,
      true,
    );
  });

  it("不同方法：A.m === A.n → false", () => {
    expectBool(`export function f() { class A { static m() {} static n() {} } return A.m === A.n; }`, false);
  });

  it("覆盖静态方法：class B extends A { static m(){} } B.m === A.m → false", () => {
    expectBool(
      `export function f() { class A { static m() {} } class B extends A { static m() {} } return B.m === A.m; }`,
      false,
    );
  });

  it("typeof A.m 仍折 \"function\"", () => {
    expect(v(`export function f() { class A { static m() {} } return typeof A.m; }`)).toEqual({
      ok: true,
      value: "function",
    });
  });
});

describe("P2a: 实例方法值读身份（定义类 .prototype 驻留）", () => {
  it("同链实例：b.m === a.m → true（都解析到 A.prototype.m）", () => {
    expectBool(
      `export function f() { class A { m() {} } class B extends A {} const a = new A(), b = new B(); return b.m === a.m; }`,
      true,
    );
  });

  it("同类两实例：a1.m === a2.m → true", () => {
    expectBool(
      `export function f() { class A { m() {} } const a1 = new A(), a2 = new A(); return a1.m === a2.m; }`,
      true,
    );
  });

  it("不同实例方法：a1.m === a1.n → false", () => {
    expectBool(
      `export function f() { class A { m() {} n() {} } const a1 = new A(); return a1.m === a1.n; }`,
      false,
    );
  });

  it("覆盖实例方法：new B().m === new A().m → false", () => {
    expectBool(
      `export function f() { class A { m() {} } class B extends A { m() {} } return new B().m === new A().m; }`,
      false,
    );
  });

  it("同名静态与实例方法是不同函数对象：A.m === new A().m → false", () => {
    expectBool(
      `export function f() { class A { m() {} static m() {} } return A.m === new A().m; }`,
      false,
    );
  });
});

describe("P2a: 差分对账（native oracle）", () => {
  it("B.m === A.m 与差分 native 精确一致", () => {
    expect(diffBody(`class A { static m() { return 1; } } class B extends A {} return B.m === A.m;`)).toBeNull();
  });

  it("覆盖静态 + 实例链差分", () => {
    expect(
      diffBody(
        `class A { static m() {} m() {} } class B extends A { static m() {} m() {} }
         const a = new A(), b = new B();
         return [B.m === A.m, b.m === a.m, A.m === A.m, b.m === b.m].join(",");`,
      ),
    ).toBeNull();
  });
});

describe("Bug 89: 用户类方法一等值借用调用（.call/.apply/.bind）经 apply 钩子重入分派", () => {
  // native：classMethodValueAbs 产的方法值此前是 noBody 无 apply 的 fn——
  // $call 编译空 body 折 wrong-exact undefined。修复：apply 钩子经
  // protoMethodDispatch 转发 $invoke(thisVal, key, args)（实例面 findMethod /
  // 静态面 findStaticMethod 同一通道），kind:"protoMethod" 抑制尾部再入。

  it("const m = c.m; m.call(c) → 3（修复前 #exact undefined）", () => {
    const r = v(`export function f() { class C { constructor() { this.v = 3; } m() { return this.v; } } const c = new C(); const m = c.m; return m.call(c); }`);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(3);
  });

  it("c.m.apply(c, []) → 4（修复前 #exact undefined）", () => {
    const r = v(`export function f() { class C { constructor() { this.v = 4; } m() { return this.v; } } const c = new C(); return c.m.apply(c, []); }`);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(4);
  });

  it("c.m.bind(c)() → 4（修复前 #exact undefined）", () => {
    const r = v(`export function f() { class C { constructor() { this.v = 4; } m() { return this.v; } } const c = new C(); return c.m.bind(c)(); }`);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(4);
  });

  it("静态面对称：const m = C.s; m.call(C) → 7", () => {
    const r = v(`export function f() { class C { static s() { return 7; } } const m = C.s; return m.call(C); }`);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(7);
  });

  it("继承链方法值：new B().m.call(c) → 解析到 A 的方法（native 1）", () => {
    const r = v(`export function f() { class A { m() { return 1; } } class B extends A {} const c = new B(); return c.m.call(c); }`);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(1);
  });

  it("方法值自由调用 f(c.m)：严格模式 this=undefined，this.v 读取按 nullish 面记账（非 wrong-exact undefined）", () => {
    const r = v(`export function f() { class C { m() { return 8; } } const c = new C(); return [c.m].map((g) => g.call(c))[0]; }`);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(8);
  });

  // Controls（修复前亦正确）
  it("control：直接 c.m() → 3（registry 派发不经方法值）", () => {
    expect(v(`export function f() { class C { constructor() { this.v = 3; } m() { return this.v; } } const c = new C(); return c.m(); }`).value).toBe(3);
  });

  it("control：对象字面量方法值 o.m.call(o) → 3（bindThis 通道）", () => {
    expect(v(`export function f() { const o = { m() { return 3; } }; const m = o.m; return m.call(o); }`).value).toBe(3);
  });

  it("control：typeof c.m 仍折 \"function\"（值形状不变）", () => {
    expect(v(`export function f() { class C { m() {} } const c = new C(); return typeof c.m; }`).value).toBe("function");
  });

  it("control：方法值身份驻留不回归——c1.m === c2.m → true", () => {
    expectBool(`export function f() { class C { m() {} } const c1 = new C(), c2 = new C(); return c1.m === c2.m; }`, true);
  });

  it("差分对账（native oracle）", () => {
    expect(
      diffBody(
        `class C { constructor() { this.v = 3; } m() { return this.v; } static s() { return 7; } }
         const c = new C(); const m = c.m;
         return [m.call(c), c.m.apply(c, []), c.m.bind(c)(), C.s.call(C), c.m()].join(",");`,
      ),
    ).toBeNull();
  });
});
