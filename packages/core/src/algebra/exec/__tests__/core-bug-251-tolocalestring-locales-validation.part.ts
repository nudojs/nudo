/**
 * Bug 251 —— `toLocaleString` / `toLocale*` 家族的**值**与**locales 实参校验**。
 *
 * 两处根因（族 03 报告 + 实测）：
 * 1. `exec/class/invoke.ts` number 臂把 `toLocaleString` **重定向成宿主
 *    `toString`** ⇒ 值错（丢千分位 / `-0` / 指数形态）：
 *    `(1234567.5).toLocaleString()` 原生 "1,234,567.5"、引擎 "1234567.5"；
 *    `(-0).toLocaleString()` 原生 "-0"、引擎 "0"；
 *    `(1e21).toLocaleString()` 原生 "1,000,000,000,000,000,000,000"、
 *    引擎 "1e+21"。
 * 2. 三臂（number / bigint / 字符串 `toLocaleUpperCase|toLocaleLowerCase`）
 *    **都不校验 locales 实参** ⇒ `null`（原生 TypeError）、非法 language
 *    tag（原生 RangeError）全不抛 ⇒ throws 域折 never（假 no-throw）。
 *
 * 修法：number/bigint 臂改走**宿主 `toLocaleString`**（ICU）+ 透传 locales
 * 实参（宿主 `CanonicalizeLocaleList` 校验同款）；字符串 `toLocale*` 臂在
 * 入口校验档补 `validateLocalesArg`（null → TypeError、非法 tag →
 * RangeError；number/bool/bigint/symbol 实参原生被忽略）。
 *
 * 值断言一律用**显式 locale**（"en-US"）——默认 locale 随宿主环境变化
 * （本机实测 resolved locale = zh-CN），不可作确定性断言。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../../abs.ts";
import { call, throwsError } from "../../__tests__/eval-helpers.ts";

describe("Bug 251: toLocaleString value (ICU) + locales argument validation", () => {
  it("Number.prototype.toLocaleString 保留千分位（此前折成 toString）", () => {
    const r = call(`export function f() { return (1234567.5).toLocaleString("en-US"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1,234,567.5" });
  });

  it("Number.prototype.toLocaleString 保留 -0 的符号", () => {
    const r = call(`export function f() { return (-0).toLocaleString("en-US"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "-0" });
  });

  it("Number.prototype.toLocaleString 保留指数形态的分组展开", () => {
    const r = call(`export function f() { return (1e21).toLocaleString("en-US"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1,000,000,000,000,000,000,000" });
  });

  it("BigInt.prototype.toLocaleString 保留千分位", () => {
    const r = call(`export function f() { return (1234567n).toLocaleString("en-US"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1,234,567" });
  });

  it("默认 locale 也不再折成 toString 的裸数字串", () => {
    const r = call(`export function f() { return (1234567.5).toLocaleString(); }`);
    const lv = litValue(r.result);
    expect(lv.ok).toBe(true);
    expect(lv.ok ? lv.value : undefined).not.toBe("1234567.5");
  });

  it("locales 为 null → 确定 TypeError（number）", () => {
    const r = call(`export function f() { return (1.5).toLocaleString(null); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("locales 为 null → 确定 TypeError（bigint）", () => {
    const r = call(`export function f() { return (1234567n).toLocaleString(null); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("locales 为 null → 确定 TypeError（字符串 toLocaleUpperCase）", () => {
    const r = call(`export function f() { return "ABC".toLocaleUpperCase(null); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("locales 为非法 language tag → 确定 RangeError", () => {
    const r = call(`export function f() { return "ABC".toLocaleUpperCase("b"); }`);
    expect(throwsError(r.throws, "RangeError")).toBe(true);
  });

  it("无实参 / 非 string 实参 → 仍 total（原生忽略 symbol / 数字 locales）", () => {
    const r = call(`export function f() { return "abc".toLocaleUpperCase(); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "ABC" });
    const r2 = call(`export function f() { return (1).toLocaleString(Symbol()); }`);
    expect(r2.throws === undefined || r2.throws.shape.k === "never").toBe(true);
  });
});
