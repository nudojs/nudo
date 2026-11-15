/**
 * Bug 192 回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。
 *
 * ES 语义：类体的实例方法就挂在 `X.prototype` 上——`typeof A.prototype.m` 是
 * "function"、`"m" in A.prototype` 是 true、`A.prototype.hasOwnProperty("m")`
 * 是 true（自有属性）。
 *
 * 修复前：`evalClassChain("A.prototype")` 的链**不含 owner**（owner 只 push
 * 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）——
 * 同一方法在 `new A().m` 上却是对的（两条面不一致）。
 *
 * 本文件覆盖**值读**与 **in** 两个面；`hasOwnProperty` / `propertyIsEnumerable`
 * 面由 builtins/object-proto.ts 的 hasOwnDecision 接线 members.ts 的
 * protoBrandOwnMember 补齐（S1 交接，见报告）；gOPD 面由
 * builtins/object/methods.ts 的 class-own-member 描述符臂补齐。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 192 — X.prototype 上的 owner 实例方法：值读 / in", () => {
  it("typeof A.prototype.m → \"function\"（owner 自有方法）", () => {
    expect(v(wrap(`class A { m(){ return 1; } } return typeof A.prototype.m;`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("\"m\" in A.prototype → true", () => {
    expect(v(wrap(`class A { m(){} } return "m" in A.prototype;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("派生类自有方法：B.prototype.own → \"function\" / in → true", () => {
    expect(v(wrap(`class A {} class B extends A { own(){} } return typeof B.prototype.own;`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class A {} class B extends A { own(){} } return "own" in B.prototype;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("祖先类方法（原型链继承）：B.prototype.base → \"function\"", () => {
    expect(v(wrap(`class A { base(){} } class B extends A {} return typeof B.prototype.base;`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("方法恒等：A.prototype.m === new A().m（同一函数对象）", () => {
    expect(v(wrap(`class A { m(){ return 1; } } return A.prototype.m === new A().m;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：缺席方法仍是 undefined / in → false", () => {
    expect(v(wrap(`class A { m(){} } return typeof A.prototype.nope;`))).toEqual({
      ok: true,
      value: "undefined",
    });
    expect(v(wrap(`class A { m(){} } return "nope" in A.prototype;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("负控制：A.prototype instanceof A → false（owner 不在自己的原型链上）", () => {
    expect(v(wrap(`class A {} return A.prototype instanceof A;`))).toEqual({ ok: true, value: false });
  });

  it("负控制：B.prototype instanceof A → true（原型链继承）", () => {
    expect(v(wrap(`class A {} class B extends A {} return B.prototype instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("A.prototype.hasOwnProperty(\"m\") → true（owner 自有方法）", () => {
    expect(v(wrap(`class A { m(){} } return String(A.prototype.hasOwnProperty("m"));`))).toEqual({
      ok: true,
      value: "true",
    });
  });

  it("负控制：祖先类方法不在 B.prototype 自有面 → false", () => {
    expect(
      v(wrap(`class A { m(){} } class B extends A {} return String(B.prototype.hasOwnProperty("m"));`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("负控制：缺席键 → false", () => {
    expect(
      v(wrap(`class A { m(){} } return String(A.prototype.hasOwnProperty("nope"));`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("A.prototype.propertyIsEnumerable(\"m\") → false（类方法非枚举）", () => {
    expect(
      v(wrap(`class A { m(){} } return String(A.prototype.propertyIsEnumerable("m"));`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("Object.getOwnPropertyDescriptor(A.prototype,\"m\") → 精确描述符（此前折并 ⇒ 读 .value 定抛）", () => {
    expect(
      v(wrap(`class A { m(){} } return typeof Object.getOwnPropertyDescriptor(A.prototype,"m").value;`)),
    ).toEqual({ ok: true, value: "function" });
    expect(
      v(
        wrap(
          `class A { m(){} } const d = Object.getOwnPropertyDescriptor(A.prototype,"m"); return String(d.enumerable) + "/" + String(d.writable) + "/" + String(d.configurable);`,
        ),
      ),
    ).toEqual({ ok: true, value: "false/true/true" });
  });
});
