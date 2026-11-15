/**
 * Bug 320 回归：`Reflect.set(arr, "length", v)` 落 [[Set]] → **ArraySetLength**
 * （原生：length 被改成 v，元素被截断/延长），改前**静默丢弃写入**
 * （引擎 length 不变 ⇒ 错值）。
 *
 * 原生（node v26 实测）：
 * - `Reflect.set(a, "length", 1)` → a.length = 1、a = [1]、返回 true；
 * - `Reflect.set(a, "length", 5)` → a.length = 5（延长出 hole）；
 * - 非法 length（-1 / 1.5）→ RangeError（原生同款）。
 *
 * 修复前：数组面只接下标键（canonicalArrayIndex），"length" 键既不建模
 * 也不写 ⇒ 写被丢弃、返回值恒抽象 boolean。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 入口 throws 面（brand 名）——未抛则 undefined */
function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 320 — Reflect.set(arr, \"length\", v) 落 ArraySetLength", () => {
  it("length 被截断（原生 1 / [1]，改前 3 / [1,2,3]）", () => {
    expect(
      v(wrap(`const a = [1,2,3]; Reflect.set(a, "length", 1); return String(a.length) + ":" + a.join(",");`)),
    ).toEqual({ ok: true, value: "1:1" });
  });

  it("length 被延长（原生 5）", () => {
    expect(
      v(wrap(`const a = [1,2,3]; Reflect.set(a, "length", 5); return String(a.length);`)),
    ).toEqual({ ok: true, value: "5" });
  });

  it("返回值是 true（原生同款）", () => {
    expect(
      v(wrap(`const a = [1,2,3]; return String(Reflect.set(a, "length", 1));`)),
    ).toEqual({ ok: true, value: "true" });
  });

  it("下标写不受影响（负控制）", () => {
    expect(
      v(wrap(`const a = [1,2,3]; Reflect.set(a, "0", 9); return a.join(",");`)),
    ).toEqual({ ok: true, value: "9,2,3" });
  });

  it("直接赋值 length 仍可用（负控制）", () => {
    expect(
      v(wrap(`const a = [1,2,3]; a.length = 1; return String(a.length);`)),
    ).toEqual({ ok: true, value: "1" });
  });
});
