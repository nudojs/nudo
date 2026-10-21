/**
 * Bug 219 回归：Symbol 实例上的 `toString` / `toLocaleString` 解析到
 * **Symbol.prototype 自己的面**（带 brand check），不是 Object.prototype 泛型版。
 *
 * ES 语义：
 * - `Symbol.prototype.toString` 是 Symbol.prototype **自有**方法（thisSymbolValue
 *   brand check）——借用调用非 symbol 接收者定抛 TypeError
 *   （`Symbol().toString.call(1)` 抛）；返回 "Symbol(desc)"；
 * - `Symbol.prototype.valueOf` 自有（brand check）——返回符号自身；
 * - `Symbol.prototype.toLocaleString` **不存在**（继承 Object.prototype 的
 *   toLocaleString → ToObject(this).toString()）——symbol 接收者得 "Symbol(desc)"。
 *
 * 修复前：这些成员值读落 Object.prototype 泛型版（**无 brand check**）→
 * 错值 "[object Number]" / "[object Symbol]"，且借用调用漏抛 TypeError。
 *
 * 不变量（负控制钉住）：
 * - Symbol.prototype 上的直呼（callAbsMethod 臂）语义不变；
 * - number / string / boolean 的 toString 调用面不变；
 * - Symbol.prototype.toString.call(1) 仍抛（原生同款，负控制钉住 brand check）；
 * - Object.prototype.toString 的泛型面不受影响。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

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

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 219 — Symbol 实例的 toString / toLocaleString 走 Symbol.prototype", () => {
  it("Symbol('x').toString() → \"Symbol(x)\"", () => {
    expect(v(wrap(`return Symbol("x").toString();`))).toEqual({ ok: true, value: "Symbol(x)" });
  });

  it("Symbol('x').toLocaleString() → \"Symbol(x)\"（不是 \"[object Symbol]\"）", () => {
    expect(v(wrap(`return Symbol("x").toLocaleString();`))).toEqual({ ok: true, value: "Symbol(x)" });
  });

  it("Symbol().toString.call(1) → TypeError（brand check 不再丢）", () => {
    const src = wrap(`try { return Symbol().toString.call(1); } catch (e) { return "caught:" + e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "caught:TypeError" });
  });

  it("Symbol.prototype.toString.call(1) → TypeError（负控制：原生同款）", () => {
    const src = wrap(`try { return Symbol.prototype.toString.call(1); } catch (e) { return "caught:" + e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "caught:TypeError" });
  });

  it("typeof Symbol().toString → \"function\"", () => {
    expect(v(wrap(`return typeof Symbol().toString;`))).toEqual({ ok: true, value: "function" });
  });

  it("Symbol('x').valueOf() 仍是符号自身（既有语义）", () => {
    const src = wrap(`const s = Symbol("x"); return s.valueOf() === s;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: true });
  });
});

describe("Bug 219 — 负控制：其它 prim 的 toString / 泛型 Object.prototype 面不回归", () => {
  it("(5).toString() → \"5\"", () => {
    expect(v(wrap(`return (5).toString();`))).toEqual({ ok: true, value: "5" });
  });

  it("\"ab\".toString() → \"ab\"", () => {
    expect(v(wrap(`return "ab".toString();`))).toEqual({ ok: true, value: "ab" });
  });

  it("true.toString() → \"true\"", () => {
    expect(v(wrap(`return true.toString();`))).toEqual({ ok: true, value: "true" });
  });

  it("Object.prototype.toString.call({}) → \"[object Object]\"（泛型面不受影响）", () => {
    expect(v(wrap(`return Object.prototype.toString.call({});`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  });

  it("Object.prototype.toString.call([]) → \"[object Array]\"（泛型面不受影响）", () => {
    expect(v(wrap(`return Object.prototype.toString.call([]);`))).toEqual({
      ok: true,
      value: "[object Array]",
    });
  });

  it("Symbol('x').description → \"x\"（既有语义）", () => {
    expect(v(wrap(`return Symbol("x").description;`))).toEqual({ ok: true, value: "x" });
  });
});
