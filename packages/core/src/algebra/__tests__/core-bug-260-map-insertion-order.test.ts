/**
 * BUG-260：Map 的 Abs 表被拆成 `byLit`（字面量键）与 `identEntries`（引用
 * 身份键）两个通道，却**没有插入序**字段 ⇒ 键/值/条目迭代恒先吐字面量键、
 * 再吐身份键 ⇒ 与宿主插入序相反 ⇒ 依赖迭代序的 L1 契约假红 + `#exact` 的
 * 自信错值（Map 是 JS 里唯一保证插入序的集合）。
 *
 * 修复：MapTable 记录插入序（`order`），写面（set/delete/clear/fork 合并）
 * 维护宿主语义（重写既有键不换位、delete 后再写排到末尾），keys/values/
 * entries 按插入序投影。
 *
 * 用例必须**混插**字面量键与身份键：只有字面量键时两通道顺序恰好一致，
 * 缺陷测不出来。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  litValue,
  makeMapAbs,
  mapDeleteEntry,
  mapEntriesAbs,
  mapSetEntry,
  mapValuesAbs,
  numLit,
  strLit,
  type Abs,
} from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const objAbs = (): Abs => abs({ k: "obj", slots: {} }, undefined, undefined, "exact");

/** entry 元组的键 Abs（迭代序断言用） */
const keyOfEntry = (e: Abs): Abs =>
  e.shape.k === "tuple" ? e.shape.elements[0]! : e;

const KEYS_SRC = `
export function f() {
  const m = new Map();
  const o = { z: 1 };
  m.set(o, 1);
  m.set("a", 2);
  const out = [];
  for (const k of m.keys()) { out.push(typeof k === "string" ? k : "obj"); }
  return out.join(",");
}
`;

const VALUES_SRC = `
export function f() {
  const m = new Map();
  const o = { z: 1 };
  m.set(o, "first");
  m.set("a", "second");
  const out = [];
  for (const v of m.values()) out.push(v);
  return out.join(",");
}
`;

const ENTRIES_SRC = `
export function f() {
  const m = new Map();
  const o = { z: 1 };
  m.set(o, "first");
  m.set("a", "second");
  let s = "";
  for (const [k, v] of m) { s += (typeof k === "string" ? k : "obj") + ":" + v + ";"; }
  return s;
}
`;

describe("BUG-260：Map 迭代按宿主插入序（字面量键与身份键混插）", () => {
  it("keys()：身份键先插 → 迭代在前（宿主 obj,a）", () => {
    // 宿主：const m=new Map(); m.set(o,1); m.set("a",2) → [...m.keys()] = [o, "a"]
    expect(litValue(call(KEYS_SRC, "f").result)).toEqual({ ok: true, value: "obj,a" });
  });

  it("values()：值顺序同样跟插入序（宿主 first,second）", () => {
    expect(litValue(call(VALUES_SRC, "f").result)).toEqual({
      ok: true,
      value: "first,second",
    });
  });

  it("entries() / for-of 解构：条目顺序同样跟插入序", () => {
    expect(litValue(call(ENTRIES_SRC, "f").result)).toEqual({
      ok: true,
      value: "obj:first;a:second;",
    });
  });

  it("table 面：字面量键与身份键混插时按写入序投影", () => {
    const m = makeMapAbs();
    const obj = objAbs();
    mapSetEntry(m, obj, numLit(1));
    mapSetEntry(m, strLit("a"), numLit(2));

    const entries = mapEntriesAbs(m);
    expect(entries).toHaveLength(2);
    // 第一项必须是身份键（修复前恒为字面量键 "a"）
    expect(keyOfEntry(entries[0]!)).toBe(obj);
    expect(litValue(keyOfEntry(entries[1]!))).toEqual({ ok: true, value: "a" });
    expect(mapValuesAbs(m).map((v) => litValue(v))).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  });

  it("重写既有键不换位；delete 后再写排到末尾（宿主语义）", () => {
    const m = makeMapAbs();
    const obj = objAbs();
    mapSetEntry(m, obj, numLit(1));
    mapSetEntry(m, strLit("a"), numLit(2));

    // m.set(o, v2)：值更新、位置不变
    mapSetEntry(m, obj, numLit(9));
    expect(mapValuesAbs(m).map((v) => litValue(v))).toEqual([
      { ok: true, value: 9 },
      { ok: true, value: 2 },
    ]);

    // m.delete(o); m.set(o, v3)：重新插入 → 排到末尾
    mapDeleteEntry(m, obj);
    mapSetEntry(m, obj, numLit(7));
    expect(mapValuesAbs(m).map((v) => litValue(v))).toEqual([
      { ok: true, value: 2 },
      { ok: true, value: 7 },
    ]);
    expect(keyOfEntry(mapEntriesAbs(m)[1]!)).toBe(obj);
  });
});
