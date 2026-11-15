/**
 * Bug 256 —— `String.prototype.*` 的 30 个方法被**品牌检查**（ES2023 §22.1.3 实为
 * **generic**：RequireObjectCoercible + ToString）⇒ 借用调用定抛 TypeError
 * （L2 门禁假红；`String.prototype.toUpperCase.call(1)` 原生 "1"）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：**修表**——`String.prototype` 上只有
 * `toString` / `valueOf` 要品牌（BRAND_CHECK_METHODS 方法级表），其余方法走
 * generic 路（ToString 接收者后派发）；品牌检查判定改由 brandCheckBrandOf
 * 表驱动，Error 家族不进品牌面（Bug 261）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

describe("Bug 256：String.prototype 的 generic 方法不品牌检查", () => {
  it("toUpperCase.call(1) = '1'（原生 generic；此前定抛 TypeError）", () => {
    const r = call(`export function f() { return String.prototype.toUpperCase.call(1); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(r.throws.shape.k).toBe("never");
  });

  it("trim / charAt / at / concat 借用给数字接收者 = 原生值", () => {
    expect(
      litValue(call(`export function f() { return String.prototype.trim.call(42); }`).result),
    ).toEqual({ ok: true, value: "42" });
    expect(
      litValue(call(`export function f() { return String.prototype.charAt.call(7); }`).result),
    ).toEqual({ ok: true, value: "7" });
    expect(
      litValue(call(`export function f() { return String.prototype.at.call(1); }`).result),
    ).toEqual({ ok: true, value: "1" });
    expect(
      litValue(
        call(`export function f() { return String.prototype.concat.call(1, "x"); }`).result,
      ),
    ).toEqual({ ok: true, value: "1x" });
  });

  it("品牌方法仍要品牌（toString / valueOf.call(1) → TypeError）", () => {
    const r = call(`export function f() { return String.prototype.toString.call(1); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    const r2 = call(`export function f() { return String.prototype.valueOf.call(1); }`);
    expect(isNever(r2.result)).toBe(true);
    expect(throwsError(r2.throws, "TypeError")).toBe(true);
  });

  it("nullish 接收者仍定抛（RequireObjectCoercible）", () => {
    const r = call(`export function f() { return String.prototype.toUpperCase.call(null); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("其它家族的品牌检查不受影响（Number.toFixed.call('s') → TypeError）", () => {
    const r = call(`export function f() { return Number.prototype.toFixed.call("s"); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("直接字符串方法不受影响（'abc'.toUpperCase() = 'ABC'）", () => {
    const r = call(`export function f() { return "abc".toUpperCase(); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "ABC" });
    expect(r.throws.shape.k).toBe("never");
  });
});
