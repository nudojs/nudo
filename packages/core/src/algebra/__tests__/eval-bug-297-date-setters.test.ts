/**
 * Bug 297 回归：`Date.prototype.set*` 族不再是空操作——time value 回写，
 * 精确渲染面（toISOString）不再给**过期**日期。
 *
 * ES 语义（node 实测）：
 * - `setUTCFullYear` / `setUTCMonth` / `setUTCDate` / `setUTCHours` /
 *   `setUTCMinutes` / `setUTCSeconds` / `setUTCMilliseconds` / `setTime`
 *   按规范 MakeDay/MakeTime 归一化后回写 [[DateValue]]（1 月 31 日
 *   setUTCMonth(1) → 3 月 2 日）；本地族（setFullYear / setMonth / …）同款
 *   （本地时区口径，与宿主 Date 同）。
 * - setter **返回**新 time value（number）。
 * - 实参不可判定（抽象 number）→ 新 time value 不可知 ⇒ 精确面必须降级
 *   （不得给过期日期）。
 * - 实参是 Symbol / BigInt → 确定 TypeError（Bug 62 既有口径，不回归）。
 *
 * 修复前：setter 臂只做实参校验就返回抽象 number，从不回写 time value
 * ⇒ `toISOString()` 恒给**构造期**的日期（wrong-exact）。
 *
 * 不变量（负控制钉住）：
 * - 无 setter 的构造期精确 ISO 不变；
 * - 两个实例互不影响（各自持有自己的 time value）；
 * - `new Date()`（tv 不可知）上的 setter 仍返回抽象 number，且不记抛；
 * - `Date.now()` / `Date.prototype.setTime` 成员面不变；
 * - JSON.stringify（投影面）与读面同源（同一 time value）。
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

describe("Bug 297 — Date.prototype.set* 回写 time value（精确面不再过期）", () => {
  it("setUTCFullYear / setUTCMonth / setUTCDate → ISO 更新", () => {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCFullYear(2021); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2021-01-01T00:00:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCMonth(5); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-06-01T00:00:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCDate(15); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-15T00:00:00.000Z" });
  });

  it("setUTCHours / setUTCMinutes / setUTCSeconds / setUTCMilliseconds → ISO 更新", () => {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCHours(5); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T05:00:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCMinutes(30); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T00:30:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCSeconds(30); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T00:00:30.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCMilliseconds(500); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T00:00:00.500Z" });
  });

  it("setTime → time value 回写（ISO 同步）", () => {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setTime(0); return d.toISOString();`)))
      .toEqual({ ok: true, value: "1970-01-01T00:00:00.000Z" });
  });

  it("MakeDay 归一化：1 月 31 日 setUTCMonth(1) → 3 月 2 日（原生口径）", () => {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,31)); d.setUTCMonth(1); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-03-02T00:00:00.000Z" });
  });

  it("多实参形态：setUTCFullYear(y, m, d) / setUTCHours(h, m, s, ms)", () => {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCFullYear(2021,5,15); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2021-06-15T00:00:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCHours(3,4,5,6); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T03:04:05.006Z" });
  });

  it("setter 返回新 time value（number 字面量）", () => {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); return d.setUTCFullYear(2021);`)))
      .toEqual({ ok: true, value: Date.UTC(2021, 0, 1) });
  });

  it("getTime / valueOf 读同一 time value 槽（与 setter 同步）", () => {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCFullYear(2021); return d.getTime();`)))
      .toEqual({ ok: true, value: Date.UTC(2021, 0, 1) });
    expect(v(wrap(`const d = new Date(0); d.setTime(5000); return d.valueOf();`)))
      .toEqual({ ok: true, value: 5000 });
  });

  it("TimeClip 越界 → Invalid Date → toISOString 确定 RangeError（原生口径）", () => {
    expect(throwName(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setTime(1e20); return d.toISOString();`)))
      .toBe("RangeError");
  });

  it("负控制：无 setter 的构造期 ISO 不变", () => {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T00:00:00.000Z" });
  });

  it("负控制：两个实例互不影响（各自 time value）", () => {
    expect(v(wrap(`const a = new Date(Date.UTC(2020,0,1)); const b = new Date(Date.UTC(1999,0,1)); a.setUTCFullYear(2021); return a.toISOString() + "|" + b.toISOString();`)))
      .toEqual({ ok: true, value: "2021-01-01T00:00:00.000Z|1999-01-01T00:00:00.000Z" });
  });

  it("负控制：Symbol / BigInt 实参仍确定 TypeError（Bug 62 口径不回归）", () => {
    expect(throwName(wrap(`const d = new Date(0); d.setUTCFullYear(Symbol()); return "no";`))).toBe("TypeError");
    expect(throwName(wrap(`const d = new Date(0); d.setTime(1n); return "no";`))).toBe("TypeError");
  });

  it("负控制：new Date()（time value 不可知）上的 setter 返回抽象 number 且不记抛", () => {
    expect(v(wrap(`const d = new Date(); return d.setTime(5);`))).toEqual({ ok: false });
    expect(throwName(wrap(`const d = new Date(); return d.setTime(5);`))).toBe("");
  });

  it("负控制：Date.now() / Date.prototype.setTime 成员面不变", () => {
    expect(v(wrap(`return typeof Date.now();`))).toEqual({ ok: true, value: "number" });
    expect(v(wrap(`return typeof Date.prototype.setTime;`))).toEqual({ ok: true, value: "function" });
  });
});
