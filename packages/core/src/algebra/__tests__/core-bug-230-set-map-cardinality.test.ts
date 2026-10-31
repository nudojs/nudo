/**
 * BUG-230：`new Set(抽象可迭代)` / `new Map(抽象可迭代)` 的**基数**曾被建模
 * 成确定值 ⇒ 引擎印出宿主不可能产出的 exact `0` / `1` / `false`（自信的错值），
 * 且同一个 Set 的基数在 `size` 与 `Array.from(...).length` 两条读取路径上
 * 结论相反（exact 0 vs number）。
 *
 * 根因：`elementsFrom` 把抽象/未知可迭代映射成一份有限的「代表元素表」，该表
 * 随后又被当成**真实条目表**建表 ⇒ `setSizeAbs`/`mapSizeAbs` 按条目数折
 * exact 字面量、`setHasEntry` 对字面量键折 exact false。
 *
 * 修复：代表表只定**元素类型**；基数走独立通道（`cardinalityUnknown`）——
 * size 回 `number`(path)、has 回 partial、for-of/Array.from 的确切长度回
 * undefined（与 `collectionExactLen` 同口径）。确切迭代源（tuple / 字符串
 * 字面量 / nullish 空容器）仍折 exact。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  anyAbs,
  undefAbs,
  numLit,
  strLit,
  litValue,
  collectionExactLen,
  makeMapAbs,
  makeSetAbs,
  mapHasEntry,
  mapSizeAbs,
  setHasEntry,
  setSizeAbs,
  type Abs,
} from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 无界抽象数组（契约 `array(number())` 的同款形态）：元素已知、长度未知 */
const numArray = (): Abs =>
  abs(
    { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "path") },
    undefined,
    undefined,
    "path",
  );

const tupleOf = (...els: Abs[]): Abs =>
  abs({ k: "tuple", elements: els }, undefined, undefined, "exact");

const SRC = `
export function setSize(xs) { return new Set(xs).size; }
export function setLen(xs) { return Array.from(new Set(xs)).length; }
export function setHas(xs) { return new Set(xs).has("a"); }
export function mapSize(xs) { return new Map(xs).size; }
`;

describe("BUG-230：抽象可迭代构造的 Set/Map 基数不得折成确定值", () => {
  it("new Set(xs).size（xs: any）是 number(path)，不是 exact 0", () => {
    const r = call(SRC, "setSize", [anyAbs]);
    expect(r.result.shape).toMatchObject({ k: "prim", type: "number" });
    expect(r.result.conf).toBe("path");
  });

  it("new Set(xs).size（xs: number[]）不再是 exact 1——长度不可知", () => {
    const r = call(SRC, "setSize", [numArray()]);
    expect(r.result.shape).toMatchObject({ k: "prim", type: "number" });
    expect(r.result.conf).not.toBe("exact");
  });

  it("同一 Set 的 size 与 Array.from(...).length 同结论（都非 exact number）", () => {
    for (const arg of [anyAbs, numArray()]) {
      const size = call(SRC, "setSize", [arg]);
      const len = call(SRC, "setLen", [arg]);
      expect(size.result.shape).toMatchObject({ k: "prim", type: "number" });
      expect(len.result.shape).toMatchObject({ k: "prim", type: "number" });
      expect(size.result.conf).not.toBe("exact");
      expect(len.result.conf).not.toBe("exact");
    }
  });

  it('new Set(xs).has("a") 是 partial boolean，不是 exact false', () => {
    const r = call(SRC, "setHas", [anyAbs]);
    expect(r.result.shape).toMatchObject({ k: "prim", type: "boolean" });
    expect(r.result.conf).not.toBe("exact");
    // 不得折出确定的 false
    expect(litValue(r.result).ok).toBe(false);
  });

  it("new Map(xs).size 是 number(path)，不是 exact 0", () => {
    const r = call(SRC, "mapSize", [anyAbs]);
    expect(r.result.shape).toMatchObject({ k: "prim", type: "number" });
    expect(r.result.conf).toBe("path");
  });

  it("代表表的 table 面：size/has/确切长度都不折确定值", () => {
    for (const arg of [anyAbs, numArray()]) {
      expect(setSizeAbs(makeSetAbs(arg)).conf).toBe("path");
      expect(setHasEntry(makeSetAbs(arg), strLit("a")).conf).toBe("partial");
      expect(collectionExactLen(makeSetAbs(arg))).toBeUndefined();
    }
    expect(mapSizeAbs(makeMapAbs(anyAbs)).conf).toBe("path");
    expect(mapHasEntry(makeMapAbs(anyAbs), strLit("a")).conf).not.toBe("exact");
    expect(collectionExactLen(makeMapAbs(anyAbs))).toBeUndefined();
  });

  it("确切迭代源仍折 exact（tuple / nullish 空容器，无回归）", () => {
    expect(litValue(setSizeAbs(makeSetAbs(tupleOf(numLit(1), numLit(2), numLit(2)))))).toEqual({
      ok: true,
      value: 2,
    });
    // native new Set(undefined).size === 0
    expect(litValue(setSizeAbs(makeSetAbs(undefAbs())))).toEqual({ ok: true, value: 0 });
    expect(litValue(setSizeAbs(makeSetAbs()))).toEqual({ ok: true, value: 0 });

    const onePair = makeMapAbs(tupleOf(tupleOf(strLit("a"), numLit(1))));
    expect(litValue(mapSizeAbs(onePair))).toEqual({ ok: true, value: 1 });
    expect(litValue(mapSizeAbs(makeMapAbs()))).toEqual({ ok: true, value: 0 });
    // 确切源仍保留确切长度（for-of 有界展开路径不变）
    expect(collectionExactLen(makeSetAbs(tupleOf(numLit(1), numLit(2))))).toBe(2);
  });
});
