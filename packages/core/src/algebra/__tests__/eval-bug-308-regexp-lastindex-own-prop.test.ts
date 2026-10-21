/**
 * Bug 308 回归：RegExp 实例的**自有 `lastIndex`**（ECMA-262 §22.2.6）。
 *
 * 原生（node v26 实测）：
 * - `Object.getOwnPropertyNames(/x/)` === ["lastIndex"]（gOPN 是「**全部**
 *   自有键」语义——lastIndex 自有但**非可枚举**）；
 * - `Object.getOwnPropertyDescriptor(/x/, "lastIndex").writable` === true
 *   （数据属性：可写、非可枚举、不可配置）；
 * - `Object.keys(/x/)` === []（**可枚举**自有键视图——lastIndex 非可枚举）。
 *
 * 修复前：gOPN 复用了「零**可枚举**自有键」表 ⇒ 折 exact 空元组（自信的
 * 确切错值）；gOPD 落「descriptor | undefined」⇒ 读 .writable 即定抛
 * TypeError。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 308 — RegExp 自有 lastIndex 进 gOPN / gOPD", () => {
  it("gOPN：列出自有 lastIndex（改前折空元组）", () => {
    expect(v(wrap(`return JSON.stringify(Object.getOwnPropertyNames(/x/));`))).toEqual({
      ok: true,
      value: '["lastIndex"]',
    });
  });

  it("gOPN：全局正则同样列 lastIndex（改前折空元组）", () => {
    expect(v(wrap(`return JSON.stringify(Object.getOwnPropertyNames(/x/g));`))).toEqual({
      ok: true,
      value: '["lastIndex"]',
    });
  });

  it("gOPD：lastIndex 折可写的数据描述符（改前读 .writable 定抛 TypeError）", () => {
    expect(
      v(
        wrap(
          `const d = Object.getOwnPropertyDescriptor(/x/, "lastIndex"); return String(d.writable) + "," + String(d.enumerable) + "," + String(d.configurable);`,
        ),
      ),
    ).toEqual({ ok: true, value: "true,false,false" });
  });

  it("负控制：Object.keys 仍为空（lastIndex 非可枚举）", () => {
    expect(v(wrap(`return JSON.stringify(Object.keys(/x/));`))).toEqual({
      ok: true,
      value: "[]",
    });
  });

  it("负控制：Map / Set 的 gOPN 仍为空（无自有键）", () => {
    expect(v(wrap(`return JSON.stringify(Object.getOwnPropertyNames(new Map()));`))).toEqual({
      ok: true,
      value: "[]",
    });
  });
});
