/**
 * Map / Set 字面量条目追踪（C1.1 / C1.2）。
 * 按 Abs 对象身份挂 side table：`m.set("k", v)` 后同 identity 的 `m.get("k")`
 * 可回查。非字面量 key 不入表；get/has 对未知 key 保守回落。
 */

import type { Abs } from "./abs.ts";
import { abs, litValue, unknown } from "./abs.ts";
import { objOf, joinAbs } from "./objects.ts";

type LitKey = string | number | boolean | null | undefined;

type MapTable = {
  byLit: Map<LitKey, Abs>;
  /** 非字面量 key 写入的值（get 未知 key 时 join 用） */
  shadowValues: Abs[];
};

type SetTable = {
  elements: Abs[];
};

const mapTables = new WeakMap<object, MapTable>();
const setTables = new WeakMap<object, SetTable>();

function emptyMapTable(): MapTable {
  return { byLit: new Map(), shadowValues: [] };
}

function emptySetTable(): SetTable {
  return { elements: [] };
}

function brandOf(name: string): Abs {
  return abs(
    { k: "brand", name, shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
}

function litKeyOf(a: Abs | undefined): LitKey | undefined {
  if (!a) return undefined;
  if (a.term?.op === "lit") return a.term.value as LitKey;
  const v = litValue(a);
  if (v === undefined && a.term === undefined) return undefined;
  return v;
}

export function isMapAbs(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "brand" && a.shape.name === "Map";
}

export function isSetAbs(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "brand" && a.shape.name === "Set";
}

/** 从可迭代 Abs 填充元素（tuple/arr）；其它形态忽略 */
function elementsFrom(iterable: Abs | undefined): Abs[] {
  if (!iterable) return [];
  if (iterable.shape.k === "tuple") return [...iterable.shape.elements];
  if (iterable.shape.k === "arr") {
    // 抽象数组：保留单元素类型；有界展开交给 for-of 路径
    return [iterable.shape.element];
  }
  if (iterable.shape.k === "sum") {
    return iterable.shape.members.flatMap(elementsFrom);
  }
  return [];
}

export function makeMapAbs(iterable?: Abs): Abs {
  const m = brandOf("Map");
  const table = emptyMapTable();
  for (const el of elementsFrom(iterable)) {
    // Map 构造接收 entry 元组 [k, v] 时拆开；否则整段作 value、key 未建模
    if (el.shape.k === "tuple" && el.shape.elements.length >= 2) {
      const k = litKeyOf(el.shape.elements[0]);
      const v = el.shape.elements[1]!;
      if (k !== undefined) table.byLit.set(k, v);
      else table.shadowValues.push(v);
    }
  }
  mapTables.set(m as object, table);
  return m;
}

export function makeSetAbs(iterable?: Abs): Abs {
  const s = brandOf("Set");
  const table = emptySetTable();
  table.elements.push(...elementsFrom(iterable));
  setTables.set(s as object, table);
  return s;
}

function mapTableOf(a: Abs): MapTable {
  const existing = mapTables.get(a as object);
  if (existing) return existing;
  const t = emptyMapTable();
  mapTables.set(a as object, t);
  return t;
}

function setTableOf(a: Abs): SetTable {
  const existing = setTables.get(a as object);
  if (existing) return existing;
  const t = emptySetTable();
  setTables.set(a as object, t);
  return t;
}

/** Map#set：原地更新 table，返回同一 Abs（JS 可变语义） */
export function mapSetEntry(mapAbs: Abs, key: Abs | undefined, value: Abs): Abs {
  const t = mapTableOf(mapAbs);
  const k = litKeyOf(key);
  if (k !== undefined) t.byLit.set(k, value);
  else if (value) t.shadowValues.push(value);
  return mapAbs;
}

export function mapGetEntry(mapAbs: Abs, key: Abs | undefined): Abs {
  const t = mapTables.get(mapAbs as object);
  if (!t) return unknown;
  const k = litKeyOf(key);
  if (k !== undefined && t.byLit.has(k)) return t.byLit.get(k)!;
  // 未知 key：已知 value 的并集（保守但比 unknown 有信息）
  const known = [...t.byLit.values(), ...t.shadowValues];
  if (known.length === 0) return unknown;
  return known.reduce((a, b) => joinAbs(a, b));
}

export function mapHasEntry(mapAbs: Abs, key: Abs | undefined): Abs {
  const t = mapTables.get(mapAbs as object);
  if (!t) return unknown;
  const k = litKeyOf(key);
  if (k === undefined) {
    return t.byLit.size > 0
      ? abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial")
      : unknown;
  }
  const hit = t.byLit.has(k);
  return abs(
    { k: "prim", type: "boolean" },
    { op: "lit", value: hit as never },
    undefined,
    "exact",
  );
}

export function mapSizeAbs(mapAbs: Abs): Abs {
  const t = mapTables.get(mapAbs as object);
  if (!t || t.shadowValues.length > 0) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  return abs(
    { k: "prim", type: "number" },
    { op: "lit", value: t.byLit.size as never },
    undefined,
    "exact",
  );
}

export function mapValuesAbs(mapAbs: Abs): Abs[] {
  const t = mapTables.get(mapAbs as object);
  if (!t) return [];
  return [...t.byLit.values(), ...t.shadowValues];
}

/** Set#add：原地更新，返回同一 Abs */
export function setAddEntry(setAbs: Abs, value: Abs): Abs {
  const t = setTableOf(setAbs);
  t.elements.push(value);
  return setAbs;
}

export function setHasEntry(setAbs: Abs, value: Abs): Abs {
  const t = setTables.get(setAbs as object);
  if (!t) return unknown;
  const k = litKeyOf(value);
  if (k !== undefined) {
    const hit = t.elements.some((el) => litKeyOf(el) === k);
    return abs(
      { k: "prim", type: "boolean" },
      { op: "lit", value: hit as never },
      undefined,
      "exact",
    );
  }
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
}

export function setSizeAbs(setAbs: Abs): Abs {
  const t = setTables.get(setAbs as object);
  if (!t) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  return abs(
    { k: "prim", type: "number" },
    { op: "lit", value: t.elements.length as never },
    undefined,
    "exact",
  );
}

export function setElementsAbs(setAbs: Abs): Abs[] {
  const t = setTables.get(setAbs as object);
  return t ? [...t.elements] : [];
}

/** 元素联合（for-of / Array.from）；无表 → unknown */
export function collectionElementJoin(c: Abs): Abs {
  const els = isSetAbs(c) ? setElementsAbs(c) : isMapAbs(c) ? mapValuesAbs(c) : [];
  if (els.length === 0) return unknown;
  return els.reduce((a, b) => joinAbs(a, b));
}

export function clearCollectionTables(): void {
  // WeakMap 无 clear；仅测试用——新建 Abs 即新表
}
