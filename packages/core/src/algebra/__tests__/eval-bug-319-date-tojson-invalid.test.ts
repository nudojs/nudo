/**
 * Bug 319 回归：`Date.prototype.toJSON` 对**非法日期**（time value = NaN）
 * 返回 **null**（不是字符串）。
 *
 * ES 语义（node 实测）：
 * - `Date.prototype.toJSON(key)`：取 [[DateValue]]；**NaN → null**；否则
 *   返回 ISO 串（≡ toISOString）。
 * - `new Date(NaN).toJSON()` → null；`new Date(0).toJSON()` → ISO 串；
 *   `JSON.stringify(new Date(NaN))` → "null"（JSON 侧既有口径）。
 *
 * 修复前：toJSON 混进「恒返回 string」的方法集合 ⇒ 非法日期也折成**抽象
 * string**（既不是 null 也不是确定值）；`d.toJSON() === null` 折**确定的
 * false**（自信的错值）。
 *
 * 不变量（负控制钉住）：
 * - 有效日期的 toJSON 仍是 ISO 串；
 * - `JSON.stringify` 投影面不变（Date → ISO 串 / Invalid → "null"）；
 * - toISOString 对非法日期仍**确定抛 RangeError**（toJSON 不抛——返回 null）；
 * - 抽象 Date（time value 不可知）→ `string | null` 域（不折确定 false）。
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
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 319 — Date.prototype.toJSON 对非法日期返回 null", () => {
  it("new Date(NaN).toJSON() → null（原生口径）", () => {
    expect(v(wrap(`const d = new Date(NaN); return d.toJSON();`))).toEqual({ ok: true, value: null });
  });

  it("toJSON() === null → true（修复前折确定的 false）", () => {
    expect(v(wrap(`const d = new Date(NaN); return String(d.toJSON() === null);`)))
      .toEqual({ ok: true, value: "true" });
    expect(v(wrap(`const d = new Date(0); return String(d.toJSON() === null);`)))
      .toEqual({ ok: true, value: "false" });
  });

  it("String(new Date(NaN).toJSON()) → \"null\"", () => {
    expect(v(wrap(`const j = new Date(NaN).toJSON(); return String(j);`)))
      .toEqual({ ok: true, value: "null" });
  });

  it("有效日期的 toJSON → ISO 串（原生口径）", () => {
    expect(v(wrap(`const d = new Date(0); return d.toJSON();`)))
      .toEqual({ ok: true, value: "1970-01-01T00:00:00.000Z" });
    expect(v(wrap(`const d = new Date("2020-01-02T03:04:05Z"); return d.toJSON();`)))
      .toEqual({ ok: true, value: "2020-01-02T03:04:05.000Z" });
  });

  it("负控制：JSON.stringify 投影面不变（Invalid → \"null\"，有效 → ISO 串）", () => {
    expect(v(wrap(`const d = new Date(NaN); return JSON.stringify(d);`)))
      .toEqual({ ok: true, value: "null" });
    expect(v(wrap(`const d = new Date(0); return JSON.stringify(d);`)))
      .toEqual({ ok: true, value: "\"1970-01-01T00:00:00.000Z\"" });
  });

  it("负控制：toISOString 对非法日期仍确定抛 RangeError（toJSON 不抛）", () => {
    expect(throwName(wrap(`const d = new Date(NaN); return d.toISOString();`))).toBe("RangeError");
    expect(throwName(wrap(`const d = new Date(NaN); return d.toJSON();`))).toBe("");
  });

  it("负控制：抽象 Date（time value 不可知）→ string | null 域（不折确定 false）", () => {
    // new Date() 的当前时间不可知 ⇒ toJSON 可能是 null（Invalid）或 ISO 串
    expect(v(wrap(`const d = new Date(); return d.toJSON() === null;`))).toEqual({ ok: false });
  });
});
