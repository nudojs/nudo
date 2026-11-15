/**
 * Bug 326 回归：Object.keys / values / entries 对**自有键集不完备**的对象
 * （Object.groupBy 的分组对象——组键由回调运行时 ToPropertyKey 决定，静态
 * 不可知）折 **partial**，不再折 exact 空元组。
 *
 * 原生（node v26 实测）：`Object.keys(Object.groupBy([1,2], f))` ===
 * ["[object Object]"]（组键 = 回调返回值的字符串化）——引擎折 exact [] 是
 * **自信的确切错值** ⇒ dts / zod / guard 三个产物面据此判「只接受空数组」
 * ⇒ TS 消费方吃假红、运行时校验器拒掉每一个真实值。
 *
 * 修复前：组键不可判时分组对象是「开放 obj + 零槽」⇒ 键家族精确枚举空槽
 * 表 ⇒ 折 exact []。
 *
 * 判据载体：prop flags 侧表里的标记键（不落 shape 字段——shape 类型在共享
 * 文件里）；「自有键集确为空」的开放对象（Object.create 的空槽产品）不受
 * 影响（负控制钉住）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 326 — 开放键集对象的 keys/values/entries 折 partial", () => {
  it("Object.groupBy 的 keys 不再折 exact 空元组（改前折 []）", () => {
    const r = call(
      wrap(`return Object.keys(Object.groupBy([1, 2], (x) => ({ t: "x" })));`),
      "f",
    );
    // 折 partial（arr 保守域，元素 string）⇒ 不是「确切空元组」
    expect(r.result.shape.k).toBe("arr");
    expect(r.result.conf).toBe("partial");
  });

  it("Object.groupBy 的 values / entries 同样不再折 exact 空元组", () => {
    for (const m of ["values", "entries"]) {
      const r = call(
        wrap(`return Object.${m}(Object.groupBy([1, 2], (x) => ({ t: "x" })));`),
        "f",
      );
      expect(r.result.shape.k).toBe("arr");
      expect(r.result.conf).toBe("partial");
    }
  });

  it("组键可判时（字面量键）仍折精确键集（原生 keys === [\"a\"]）", () => {
    expect(
      v(wrap(`return JSON.stringify(Object.keys(Object.groupBy([1, 2], (x) => "a")));`)),
    ).toEqual({ ok: true, value: '["a"]' });
  });

  it("负控制：普通对象的 keys/values/entries 仍精确", () => {
    expect(v(wrap(`return JSON.stringify(Object.keys({ a: 1 }));`))).toEqual({
      ok: true,
      value: '["a"]',
    });
    expect(v(wrap(`return JSON.stringify(Object.values({ a: 1 }));`))).toEqual({
      ok: true,
      value: "[1]",
    });
    expect(v(wrap(`return JSON.stringify(Object.entries({ a: 1 }));`))).toEqual({
      ok: true,
      value: '[["a",1]]',
    });
  });

  it("负控制：Object.create(<obj>) 的自有键集确为空 ⇒ 仍精确折 []（Bug 41 pin）", () => {
    expect(v(wrap(`return JSON.stringify(Object.keys(Object.create({ a: 1 })));`))).toEqual({
      ok: true,
      value: "[]",
    });
  });
});
