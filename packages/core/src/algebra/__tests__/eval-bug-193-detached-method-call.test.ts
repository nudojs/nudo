/**
 * Bug 193 回归：**摘下方法引用后调用**被误判为必抛（FALSE-THROW）。
 *
 * 修复前：`const m = new A().m; m()` 折 never + throws=TypeError——原生恒不抛
 * （方法体不碰 `this` 时，`this` 只是 undefined）。根因在方法值读通道的 apply
 * 钩子：它把调用**按接收者的成员表反查**（`$invoke(recv, name, args)`），
 * 接收者不是本类实例（摘下调用时压根没有接收者）⇒「取不到方法」⇒ 假抛。
 *
 * 修法（packages/core/src/algebra/exec/class/invoke.ts 的 protoMethodDispatch
 * 注册回调）：用户类方法值按**方法体 + this = 接收者**执行——摘下调用时
 * `this` 恒 undefined（strict 语义），方法体真去读 `this.x` 时才定抛
 * TypeError（原生同口径）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : t.shape.k;
}

describe("Bug 193 — 摘下方法引用后调用不得假抛（FALSE-THROW）", () => {
  it("实例方法摘下后调用 → 正常返回（原生 this=undefined，方法体不碰 this）", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } const m = new A().m; return m();`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("静态方法摘下后调用 → 正常返回", () => {
    expect(
      v(wrap(`class A { static sm(){ return 1; } } const { sm } = A; return sm();`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("从原型对象上摘下后调用 → 正常返回", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } const { m } = A.prototype; return m();`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("摘下后仍是函数值（typeof → function）", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } const m = new A().m; return typeof m;`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("摘下后调用不记 may-throw（throws 域干净——L2 门禁不再假报）", () => {
    const rec = call(
      wrap(`class A { m(){ return 1; } } const m = new A().m; return m();`),
      "f",
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
  });

  it("方法体真读 this 时仍定抛 TypeError（原生 this=undefined ⇒ this.x 抛）", () => {
    expect(
      throwName(wrap(`class A { m(){ return this.x; } } const m = new A().m; return m();`)),
    ).toBe("TypeError");
  });

  it("负控制：直接调用（a.m()）不受影响", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } return new A().m();`)),
    ).toEqual({ ok: true, value: 1 });
  });
});
