/**
 * Bug 261 —— `Error.prototype.toString` 被判**品牌检查**⇒ 定抛 TypeError
 * （L2 门禁假红）。规范里它是**普通方法**（无品牌校验）：只读 this.name /
 * this.message 两个属性（node 实测 `Error.prototype.toString.call({name:"X",
 * message:"y"})` → "X: y"）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：**修表**——Error 家族**不进**品牌
 * 检查面（brandCheckBrandOf 表驱动），并补 generic 实现（只读 name / message；
 * 原始值接收者按 V8 / node 定抛 TypeError）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

describe("Bug 261：Error.prototype.toString 是普通方法（无品牌检查）", () => {
  it("toString.call({name:'X', message:'y'}) = 'X: y'（原生；此前定抛）", () => {
    const r = call(
      `export function f() { return Error.prototype.toString.call({ name: "X", message: "y" }); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "X: y" });
    expect(r.throws.shape.k).toBe("never");
  });

  it("toString.call({}) = 'Error'（缺省名）", () => {
    const r = call(`export function f() { return Error.prototype.toString.call({}); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "Error" });
  });

  it("toString.call({name:'X'}) = 'X'（空消息只回名）", () => {
    const r = call(`export function f() { return Error.prototype.toString.call({ name: "X" }); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "X" });
  });

  it("空名只回消息（toString.call({name:'',message:'y'}) = 'y'）", () => {
    const r = call(
      `export function f() { return Error.prototype.toString.call({ name: "", message: "y" }); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "y" });
  });

  it("TypeError.prototype.toString 同口径（'X: y'）", () => {
    const r = call(
      `export function f() { return TypeError.prototype.toString.call({ name: "X", message: "y" }); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "X: y" });
  });

  it("Error 实例沿既有 brand 面（'Error: m'，不回归）", () => {
    const r = call(`export function f() { return Error.prototype.toString.call(new Error("m")); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "Error: m" });
    expect(r.throws.shape.k).toBe("never");
  });

  it("原始值接收者原生定抛 TypeError（this 必须是对象）", () => {
    const r = call(`export function f() { return Error.prototype.toString.call(5); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});
