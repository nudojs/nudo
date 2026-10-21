/**
 * Bug 331 回归：`String(<brand>)` 的抽象臂不再一律记 may-throw TypeError。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 *   String(new Date(0))  → "Thu Jan 01 1970 08:00:00 GMT+0800 (中国标准时间)"
 *                           （**不抛**）
 *   String(new Map())    → "[object Map]"（**不抛**）
 *   String({})           → "[object Object]"（**不抛**）
 *   `${new Date(0)}`     → 与 String(new Date(0)) 同值（**不抛**）
 *   String(new Date(0)) === `${new Date(0)}` → true（**两侧都不抛**）
 *
 * 修前：`String(x)` 的抽象臂对**带品牌**的 x 一律记 may-throw TypeError
 * ⇒ 对 `String(new Date(0))` 这种**确定不抛**的代码报 may-throw（假红，
 * L2/L5 的 `nudo:entry-may-throw` 误报）；且同一载荷内部**自相矛盾**——
 * `String()` 记 may-throw、模板串判 OK（同一语义两种写法结论相反）。
 *
 * 引擎当前（保守域口径）：`String(new Date(0))` 落**保守 string 域**
 * （formatShape = "string"，litValue 不 ok）——值域是 string（原生同域），
 * 但不是具体日期串（精度债，非错值）。本文件按「**不抛** + 值域是 string」
 * 钉；**不得**断言精确日期串（会假红），也**不得**断言记 may-throw
 * （那是修前的假红）。
 *
 * 取证（原生 oracle）：
 *   node -e 'console.log(String(new Date(0)), String(new Map()), String({}),
 *     `${new Date(0)}` === String(new Date(0)))'
 */
import { describe, it, expect } from "vitest";
import { formatShape, litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 331 — String(<brand>) 不再一律记 may-throw TypeError", () => {
  it("String(new Date(0))：不抛 + 值域是 string（原生给日期串，不抛）", () => {
    const r = call(wrap(`return String(new Date(0));`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape(r.result)).toBe("string");
  });

  it("String(new Map())：不抛 + 值域是 string（原生 \"[object Map]\"，不抛）", () => {
    const r = call(wrap(`return String(new Map());`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape(r.result)).toBe("string");
  });

  it("String({})：不抛 + 值域是 string（原生 \"[object Object]\"，不抛）", () => {
    const r = call(wrap(`return String({});`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape(r.result)).toBe("string");
  });

  it("模板串 `${new Date(0)}`：与 String() 同口径——不抛 + 值域是 string", () => {
    const r = call(wrap("return `${new Date(0)}`;"), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape(r.result)).toBe("string");
  });
});

describe("Bug 331 — 负控制（同一载荷内部不再自相矛盾 + 相邻面不回归）", () => {
  it("String(new Date(0)) 与模板串**同样不抛**（修前：String 记 may-throw、模板串判 OK）", () => {
    const viaString = call(wrap(`return String(new Date(0));`), "f");
    const viaTemplate = call(wrap("return `${new Date(0)}`;"), "f");
    expect(throwsError(viaString.throws, "TypeError")).toBe(false);
    expect(throwsError(viaTemplate.throws, "TypeError")).toBe(false);
    // 两侧的值域一致（都是 string 域）
    expect(formatShape(viaString.result)).toBe(formatShape(viaTemplate.result));
  });

  it("String(123) → 精确 \"123\"（原始值路径的精确面不回归）", () => {
    const r = call(wrap(`return String(123);`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "123" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("String(new Error(\"x\"))：不抛 + 值域是 string（Error 品牌同样不抛）", () => {
    const r = call(wrap(`return String(new Error("x"));`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape(r.result)).toBe("string");
  });

  it("String(null) → 精确 \"null\"、String(undefined) → 精确 \"undefined\"（原始值面）", () => {
    expect(litValue(call(wrap(`return String(null);`), "f").result)).toEqual({
      ok: true,
      value: "null",
    });
    expect(litValue(call(wrap(`return String(undefined);`), "f").result)).toEqual({
      ok: true,
      value: "undefined",
    });
  });
});
