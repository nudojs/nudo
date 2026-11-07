/**
 * Bug 1041：「摘下的一等方法值」（`const f = A.m`）在**同名 static + 实例
 * 方法并存**时定抛 TypeError ⇒ 原生**正常返回**的调用被判「必抛」。
 *
 * 原生：`A.m` 取到的是**构造器上的静态方法**，`a.m` 取到的是**原型上的
 * 实例方法**——两个不同函数对象 ⇒ 摘下调用各跑各自的方法体（接收者恒
 * undefined，但方法体是确定的）。
 *
 * 引擎此前：方法值的派发按 (home, name) 反查注册表 ⇒ 同名并存时**不可判**
 * ⇒ 一律「取不到方法」⇒ 假抛 TypeError（FALSE-THROW）。
 *
 * 修法：方法值的**来源侧**（static / inst）随值传到派发面
 * （member.ts 的 classMethodValueAbs → protoMethodDispatch 的 origin 参数）
 * ⇒ 摘下调用不再「不可判」。
 *
 * 钉：改前 engine=never（throws=TypeError）/ native="S"（FALSE-THROW）。
 */
import { describe, it, expect } from "vitest";
import { call } from "../../__tests__/eval-helpers.ts";
import { litValue } from "../../abs.ts";
import { diffBody } from "../../__tests__/differential/harness.ts";

function expectLit(src: string, expected: unknown) {
  const r = litValue(call(src, "f").result);
  if (!r.ok) {
    throw new Error(
      `expected literal ${String(expected)}, got non-literal result (domain / unknown)`,
    );
  }
  expect(r.value).toEqual(expected);
}

describe("Bug 1041: 摘下的一等方法值按来源侧定方法体", () => {
  it("const g = A.m（静态侧）⇒ g() 跑静态体（native \"S\"）", () => {
    expectLit(
      `export function f() { class A1041a { m(){ return "I"; } static m(){ return "S"; } } const g = A1041a.m; return g(); }`,
      "S",
    );
  });

  it("const g = new A().m（实例侧）⇒ g() 跑实例体（native \"I\"）", () => {
    expectLit(
      `export function f() { class A1041b { m(){ return "I"; } static m(){ return "S"; } } const g = new A1041b().m; return g(); }`,
      "I",
    );
  });

  it("借用调用：g.call(A) ⇒ 跑静态体（native \"S\"）", () => {
    expectLit(
      `export function f() { class A1041e { m(){ return "I"; } static m(){ return "S"; } } const g = A1041e.m; return g.call(A1041e); }`,
      "S",
    );
  });

  it("control：只有静态方法 ⇒ 摘下调用跑静态体（native \"S\"）", () => {
    expectLit(
      `export function f() { class A1041c { static m(){ return "S"; } } const g = A1041c.m; return g(); }`,
      "S",
    );
  });

  it("control：只有实例方法 ⇒ 摘下调用跑实例体（native \"I\"）", () => {
    expectLit(
      `export function f() { class A1041d { m(){ return "I"; } } const g = new A1041d().m; return g(); }`,
      "I",
    );
  });

  it("差分对账（native oracle）：改前 FALSE-THROW / 改后一致", () => {
    expect(
      diffBody(
        `class A1041a { m(){ return "I"; } static m(){ return "S"; } } const g = A1041a.m; return g();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A1041b { m(){ return "I"; } static m(){ return "S"; } } const g = new A1041b().m; return g();`,
      ),
    ).toBeNull();
  });
});
