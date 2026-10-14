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
