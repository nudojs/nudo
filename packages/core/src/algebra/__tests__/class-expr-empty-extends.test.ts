/**
 * 空体 class 表达式保留 `extends` 回归（报告 Bug 154）。
 *
 * class **表达式**的 lowering 用「体是否为空」做快路径：体为空就发
 * `$classExpr()`，**绕过了 `classSpecOf`**——而 `extends` 子句正是由
 * `classSpecOf` 从 `ce.superClass` 读出并写成 spec 行的。于是空体 class
 * 表达式既没有 `extends`、也不进类注册表：原型链空 ⇒ `instanceof` 折
 * **false**（exact）；`extends null` 的构造函数 TypeError **不抛**。
 *
 * 修法：空体快路径只在**没有父类**时生效；有父类走与非空体同一条
 * `classSpecOf` 路径（声明形态本就正确）。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("空体 class 表达式保留 extends", () => {
  it("class extends A {}：new B() instanceof A → true（修前折 false）", () => {
    const r = call(
      `export function f() { class A {} const B = class extends A {}; return new B() instanceof A; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("class extends Map {}：instanceof Map → true（修前折 false）", () => {
    const r = call(
      `export function f() { class A {} const B = class extends Map {}; return new B() instanceof Map; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("命名空体 class 表达式：class C extends A {} → instanceof A 为 true", () => {
    const r = call(
      `export function f() { class A {} const B = class C extends A {}; return new B() instanceof A; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("extends null：构造抛 TypeError → \"caught\"（修前静默 \"nothrow\"）", () => {
    const r = call(
      `export function f() { const B = class extends null {}; try { new B(); return "nothrow"; } catch (e) { return "caught"; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
  });

  it("无父类的空体 class 不受影响：instanceof Object → true", () => {
    const r = call(`export function f() { const B = class {}; return new B() instanceof Object; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("非空体 class 表达式不受影响：继承方法可调用 → 1", () => {
    const r = call(
      `export function f() { class A { m(){ return 1; } } const B = class extends A { n(){} }; return new B().m(); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("非空体 extends null 不受影响：→ \"caught\"", () => {
    const r = call(
      `export function f() { const B = class extends null { n(){} }; try { new B(); return "nothrow"; } catch (e) { return "caught"; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
  });

  it("类声明形态不受影响：class B extends A → instanceof A 为 true", () => {
    const r = call(`export function f() { class A {} class B extends A {} return new B() instanceof A; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });
});
