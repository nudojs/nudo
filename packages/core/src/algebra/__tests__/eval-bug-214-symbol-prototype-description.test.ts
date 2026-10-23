/**
 * Bug 214 回归：`Symbol.prototype.description` 必须**定抛 TypeError**
 * （getter 的 thisSymbolValue brand check——`Symbol.prototype` 不是 symbol）。
 *
 * ES 语义：`Symbol.prototype.description` 是 Symbol.prototype 上的**自有
 * getter**（无 setter）；读它 → this 不是 symbol → TypeError。
 *
 * 修复前：漏槽 → 折 exact undefined（wrong-exact），且**不记 throws**
 * ——L2 门禁（entry may-throw）假绿：原生必抛的读被当成「读到 undefined」。
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
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

describe("Bug 214 — Symbol.prototype.description 定抛 TypeError", () => {
  it("Symbol.prototype.description → TypeError（brand check）", () => {
    const src = wrap(`try { return String(Symbol.prototype.description); } catch(e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("throws 域记 TypeError（L2 门禁不再假绿）", () => {
    const rec = call(wrap(`return Symbol.prototype.description;`), "f");
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：Symbol(\"x\").description → \"x\"", () => {
    expect(v(wrap(`return String(Symbol("x").description);`))).toEqual({ ok: true, value: "x" });
  });

  it("负控制：typeof Symbol.prototype.valueOf → \"function\"（缺席面不误伤）", () => {
    expect(v(wrap(`return String(typeof Symbol.prototype.valueOf);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("负控制：Symbol.prototype 上其它键不抛（description 之外）", () => {
    expect(throwName(wrap(`return typeof Symbol.prototype.toString;`))).toBe("");
  });
});
