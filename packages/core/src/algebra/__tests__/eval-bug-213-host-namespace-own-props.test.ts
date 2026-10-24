/**
 * Bug 213 回归：宿主 / 命名空间对象（`Math` / `JSON` / `Reflect`）的自有属性
 * 投影**不得只取可枚举键**。
 *
 * 根因：`litAbsFromJs` 用 `Object.entries` 投影宿主对象——只取**可枚举**自有
 * 属性；而 `Math` / `JSON` / `Reflect` 的自有属性几乎**全部不可枚举**
 * （原生 `Object.keys(Math)` → `[]`，`Object.getOwnPropertyNames(Math)` → 非空）。
 * 投影因此丢光整个自有面，却仍把对象标成**闭 + conf:"exact"** ⇒ 下游走
 * 「确定无此属性」分支：gOPN 折 exact `[]`、hasOwn 折 exact `false`、
 * gOPD 折 exact `undefined`（再读 `.value` 就定抛）、`Reflect.ownKeys` 折
 * exact `[]`。
 *
 * 修法：按 `Object.getOwnPropertyNames`（全部自有字符串键）投影，并逐键记下
 * 原生描述符标志（enumerable / writable / configurable）——不可枚举键仍**不**
 * 进枚举面（`Object.keys(Math)` 仍为 0，与原生一致），描述符面与原生逐字段一致。
 *
 * 不变量（负控制钉住）：
 * - 可枚举面不变：`Object.keys(Math)` → 0、`Object.keys({a:1,b:2})` → 2；
 * - 成员读面不变：`String(Math.PI)` → "3.141592653589793"；
 * - 用户对象的 gOPN / hasOwn / gOPD 不受影响；
 * - 用户对象的**不可枚举**自有键：进 gOPN 面、不进 keys 面。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 213 — 宿主 / 命名空间对象的自有属性投影（不止可枚举键）", () => {
  it("gOPN(Math) 非空（此前折 exact 0）", () => {
    expect(v(wrap(`return Object.getOwnPropertyNames(Math).length > 0;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("gOPN(Math) 含 'PI'（此前整个自有面被丢弃）", () => {
    expect(
      v(wrap(`return Object.getOwnPropertyNames(Math).join(",").indexOf("PI") >= 0;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("gOPN(JSON) 非空（此前折 exact 0）", () => {
    expect(v(wrap(`return Object.getOwnPropertyNames(JSON).length > 0;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Reflect.ownKeys(Math) 非空（此前折 exact 0）", () => {
    expect(v(wrap(`return Reflect.ownKeys(Math).length > 0;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("hasOwn(Math,'PI') → true（此前折 exact false）", () => {
    expect(v(wrap(`return String(Object.hasOwn(Math,"PI"));`))).toEqual({
      ok: true,
      value: "true",
    });
  });

  it("gOPD(Math,'PI').value → '3.141592653589793'（此前折 exact undefined → 读 .value 定抛）", () => {
    expect(
      v(wrap(`return String(Object.getOwnPropertyDescriptor(Math,"PI").value);`)),
    ).toEqual({ ok: true, value: "3.141592653589793" });
  });

  it("gOPD(Math,'PI').enumerable → 'false'（原生 Math.PI 不可枚举）", () => {
    expect(
      v(wrap(`return String(Object.getOwnPropertyDescriptor(Math,"PI").enumerable);`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("gOPD(Math,'PI').writable → 'false'（原生 Math.PI 不可写）", () => {
    expect(
      v(wrap(`return String(Object.getOwnPropertyDescriptor(Math,"PI").writable);`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("负控制：Object.keys(Math) 仍为 0（可枚举面本就空）", () => {
    expect(v(wrap(`return Object.keys(Math).length;`))).toEqual({ ok: true, value: 0 });
  });

  it("负控制：成员读 Math.PI 不受影响", () => {
    expect(v(wrap(`return String(Math.PI);`))).toEqual({
      ok: true,
      value: "3.141592653589793",
    });
  });

  it("负控制：用户对象 gOPN / hasOwn / gOPD 不受影响", () => {
    expect(v(wrap(`return Object.getOwnPropertyNames({a:1}).length;`))).toEqual({
      ok: true,
      value: 1,
    });
    expect(v(wrap(`return String(Object.hasOwn({a:1},"a"));`))).toEqual({
      ok: true,
      value: "true",
    });
    expect(v(wrap(`return String(Object.getOwnPropertyDescriptor({a:1},"a").value);`))).toEqual({
      ok: true,
      value: "1",
    });
    expect(v(wrap(`return Object.keys({a:1,b:2}).length;`))).toEqual({ ok: true, value: 2 });
  });

  it("负控制：用户对象的不可枚举自有键进 gOPN 面、不进 keys 面", () => {
    expect(
      v(
        wrap(
          `const o={}; Object.defineProperty(o,"x",{value:1,enumerable:false}); return Object.getOwnPropertyNames(o).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "x" });
    expect(
      v(
        wrap(
          `const o={}; Object.defineProperty(o,"x",{value:1,enumerable:false}); return Object.keys(o).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 0 });
  });
});
