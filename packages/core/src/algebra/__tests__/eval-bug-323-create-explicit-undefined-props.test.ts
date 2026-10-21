/**
 * Bug 323 回归：Object.create(o, **显式 undefined**) 的第二实参判定。
 *
 * 原生（node v26 实测）：规范 ES2024 20.1.2.2「If properties is not
 * undefined」⇒ 显式传 `undefined` 与**不传**同义（整步跳过：只建对象、
 * 不定义任何属性、**不抛**）⇒ `Object.create(o)` 与 `Object.create(o,
 * undefined)` 都返回对象；`Object.create(o, null)` 才抛 TypeError
 * （ToObject(null)）。
 *
 * 修复前：第二实参的**槽**在就当「有 properties」⇒ 显式 `undefined` 被判
 * **确定抛 TypeError** ⇒ L2 门禁假红 + 返回值错折 never，且与 1 参形态
 * （完全正常）自相矛盾。
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

describe("Bug 323 — Object.create(o, undefined) 整步跳过", () => {
  it("显式 undefined 第二实参 ⇒ 返回对象、不抛（改前定抛 TypeError）", () => {
    expect(v(wrap(`const o = { a: 1 }; return typeof Object.create(o, undefined);`))).toEqual({
      ok: true,
      value: "object",
    });
    expect(thrown(wrap(`const o = { a: 1 }; Object.create(o, undefined);`))).toBeUndefined();
  });

  it("负控制：1 参形态同样返回对象（与显式 undefined 同口径）", () => {
    expect(v(wrap(`const o = { a: 1 }; return typeof Object.create(o);`))).toEqual({
      ok: true,
      value: "object",
    });
  });

  it("负控制：null 第二实参 ⇒ TypeError（ToObject(null)，原生同款）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.create(o, null);`))).toBe("TypeError");
  });

  it("负控制：数字第二实参 ⇒ 零自有属性的包装器、不抛（原生同款）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.create(o, 5);`))).toBeUndefined();
  });

  it("负控制：第二实参带描述符 ⇒ 仍安装自有属性", () => {
    expect(
      v(
        wrap(
          `const o = Object.create(null, { a: { value: 1, enumerable: true } }); return JSON.stringify(Object.keys(o));`,
        ),
      ),
    ).toEqual({ ok: true, value: '["a"]' });
  });
});
