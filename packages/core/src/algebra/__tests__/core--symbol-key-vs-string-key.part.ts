/**
 * Bug 99 回归：`ARRAY_PROTO_METHOD_NAMES` 把 "@@iterator" 当**普通字符串键**
 * ⇒ `[1,2]["@@iterator"]` 折成函数、`"@@iterator" in [1,2]` 折成 true
 * （原生 undefined / false），而 `Symbol.iterator in [1,2]` 必须仍为 true。
 *
 * 修法：查表点按 symbolKey 信号分态——`$in` 用 symSlotKey、`$get` 用
 * opts.symbolKey。字符串键 "@@iterator" 与符号键 Symbol.iterator 是两个
 * 不同的 PropertyKey，不得合并成同一个事实。
 *
 * 原生 ground truth：
 *   [1,2]["@@iterator"] === undefined / typeof === "undefined"
 *   "@@iterator" in [1,2] === false / Symbol.iterator in [1,2] === true
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";
import { arrayProtoMemberForKey, ARRAY_ITERATOR_SLOT_KEY } from "../exec/member-diag.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 99：符号键与字符串 \"@@iterator\" 分态", () => {
  it("字符串键 \"@@iterator\" 在 tuple 上确定缺席（改前折成函数）", () => {
    expect(v(`export function f() { return [1,2]["@@iterator"]; }`)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(v(`export function f() { return typeof [1,2]["@@iterator"]; }`)).toEqual({
      ok: true,
      value: "undefined",
    });
  });

  it("\"@@iterator\" in [1,2] → false（改前是自信的 true）", () => {
    expect(v(`export function f() { return "@@iterator" in [1,2]; }`)).toEqual({
      ok: true,
      value: false,
    });
  });

  it("Symbol.iterator in [1,2] → true（符号键保持命中，既有钉不回归）", () => {
    expect(v(`export function f() { return Symbol.iterator in [1,2]; }`)).toEqual({
      ok: true,
      value: true,
    });
    // eval-proxy-symbol-key.test.ts 的同款钉：符号键读仍是迭代器函数
    expect(v(`export function f() { return typeof [1,2][Symbol.iterator]; }`)).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("普通对象面本就正确，不回归", () => {
    expect(v(`export function f() { const o = { k: 1 }; return o["@@iterator"]; }`)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(v(`export function f() { return "@@iterator" in { k: 1 }; }`)).toEqual({
      ok: true,
      value: false,
    });
  });

  it("Array.prototype 普通字符串键方法不受影响", () => {
    expect(v(`export function f() { return typeof [1,2].map; }`)).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(`export function f() { return "map" in [1,2]; }`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("调用面同样分态：字符串键 \"@@iterator\"() 不产迭代器、Symbol.iterator() 产迭代器", () => {
    // `$invokeKey` 把运行时键折成 "@@iterator" 槽名后，必须把**键身份**
    // 一并透传到 $get：字符串键 "@@iterator" 不是 Symbol.iterator，原生
    // `[1,2]["@@iterator"]()` 定抛 TypeError。此前调用面把两者合并 ⇒
    // 字符串键也能拿到迭代器面（Bug 198 / 314 的符号键调用则反过来全塌）。
    expect(v(`export function f() { return [1,2]["@@iterator"]().next().value; }`)).toEqual({
      ok: false,
    });
    expect(
      v(`export function f() { const k = "@@iterator"; return [1,2][k]().next().value; }`),
    ).toEqual({ ok: false });
    expect(v(`export function f() { return [1,2][Symbol.iterator]().next().value; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(
      v(`export function f() { return new Map([["a",1]])[Symbol.iterator]().next().value[0]; }`),
    ).toEqual({ ok: true, value: "a" });
  });

  it("brand 面同样分态：m[\"@@iterator\"] 定缺、m[Symbol.iterator] 折函数", () => {
    expect(v(`export function f() { return new Map()["@@iterator"]; }`)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(v(`export function f() { return typeof new Map()[Symbol.iterator]; }`)).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("arrayProtoMemberForKey：只在真符号键下命中迭代器投影名", () => {
    expect(arrayProtoMemberForKey(ARRAY_ITERATOR_SLOT_KEY, false)).toBe(false);
    expect(arrayProtoMemberForKey(ARRAY_ITERATOR_SLOT_KEY, true)).toBe(true);
    expect(arrayProtoMemberForKey("map", false)).toBe(true);
    expect(arrayProtoMemberForKey("map", true)).toBe(true);
    expect(arrayProtoMemberForKey("zzz", false)).toBe(false);
  });
});
