/**
 * Bug 243 回归：`Intl.<Sub>.prototype` 上的 **brand-check getter** 读必须
 * **定抛 TypeError**（原生 getter 内 RequireInternalSlot(this, …)——this 是
 * 原型对象、不是实例）。
 *
 * 修复前：Intl 子构造器的 `.prototype` 此前连 brand 都不是（`fnProtoOf` 只装
 * constructor 一个槽的闭 obj）⇒ 成员读落槽 miss → 折 exact undefined 且
 * **不记 throws** ⇒ L2 门禁（entry may-throw）假绿：原生必抛的读被当成
 * 「读到 undefined」。
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

describe("Bug 243 — Intl.<Sub>.prototype 的 brand-check getter 定抛 TypeError", () => {
  it("Intl.NumberFormat.prototype.format → TypeError", () => {
    expect(throwName(wrap(`return Intl.NumberFormat.prototype.format;`))).toBe("TypeError");
    expect(
      v(wrap(`try { return String(typeof Intl.NumberFormat.prototype.format); } catch (e) { return e.constructor.name; }`)),
    ).toEqual({ ok: true, value: "TypeError" });
  });

  it("Intl.DateTimeFormat.prototype.format → TypeError", () => {
    expect(throwName(wrap(`return Intl.DateTimeFormat.prototype.format;`))).toBe("TypeError");
  });

  it("Intl.Collator.prototype.compare → TypeError", () => {
    expect(throwName(wrap(`return Intl.Collator.prototype.compare;`))).toBe("TypeError");
  });

  it("Intl.Locale.prototype.baseName → TypeError", () => {
    expect(throwName(wrap(`return Intl.Locale.prototype.baseName;`))).toBe("TypeError");
  });

  it("throws 域记 TypeError（L2 门禁不再假绿）", () => {
    const rec = call(wrap(`return Intl.NumberFormat.prototype.format;`), "f");
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：同原型上的普通方法读到函数（不抛）", () => {
    expect(throwName(wrap(`return typeof Intl.NumberFormat.prototype.resolvedOptions;`))).toBe("");
    expect(v(wrap(`return String(typeof Intl.NumberFormat.prototype.resolvedOptions);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("负控制：Intl.ListFormat.prototype.format 是普通方法（不抛）", () => {
    expect(throwName(wrap(`return typeof Intl.ListFormat.prototype.format;`))).toBe("");
    expect(v(wrap(`return String(typeof Intl.ListFormat.prototype.format);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("负控制：实例上的 format 是函数（brand check 只在原型对象上定抛）", () => {
    expect(v(wrap(`const nf = new Intl.NumberFormat(); return String(typeof nf.format);`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});
