/**
 * Bug 324 回归：Object.defineProperties(o, **原始值**) 的第二实参判定。
 *
 * 原生（node v26 实测）：第二实参走 **ToObject** ——
 * - `null` / `undefined` ⇒ TypeError；
 * - number / boolean / bigint / symbol ⇒ 装箱成**零自有可枚举属性**的
 *   包装器 ⇒ **不定义任何属性、不抛**；
 * - 非空字符串 ⇒ 装箱后有下标键（"0"/"1"…）⇒ 每个「描述符」是字符（非
 *   对象）⇒ ToPropertyDescriptor 定抛 TypeError；空串零键 ⇒ 不抛。
 *
 * 修复前：第二实参是 prim ⇒ 判**确定抛 TypeError** ⇒ L1 门禁假红 +
 * 返回值错折 never。
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

describe("Bug 324 — Object.defineProperties(o, <原始值>) 走 ToObject", () => {
  it("数字第二实参 ⇒ 不抛、不改属性（改前定抛 TypeError）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.defineProperties(o, 5);`))).toBeUndefined();
    expect(v(wrap(`const o = { a: 1 }; Object.defineProperties(o, 5); return JSON.stringify(o);`))).toEqual({
      ok: true,
      value: '{"a":1}',
    });
  });

  it("布尔第二实参 ⇒ 不抛、不改属性（改前定抛 TypeError）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.defineProperties(o, true);`))).toBeUndefined();
  });

  it("空串第二实参 ⇒ 零键 ⇒ 不抛（改前定抛 TypeError）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.defineProperties(o, "");`))).toBeUndefined();
  });

  it("负控制：null / undefined 第二实参 ⇒ TypeError（原生同款）", () => {
    expect(thrown(wrap(`Object.defineProperties({}, null);`))).toBe("TypeError");
    expect(thrown(wrap(`Object.defineProperties({}, undefined);`))).toBe("TypeError");
  });

  it("负控制：非空字符串第二实参 ⇒ TypeError（描述符是字符，非对象）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.defineProperties(o, "ab");`))).toBe("TypeError");
  });

  it("负控制：对象第二实参仍照常安装描述符", () => {
    expect(
      v(
        wrap(
          `const o = {}; Object.defineProperties(o, { a: { value: 1, enumerable: true } }); return JSON.stringify(Object.keys(o));`,
        ),
      ),
    ).toEqual({ ok: true, value: '["a"]' });
  });
});
