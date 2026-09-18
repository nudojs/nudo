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
  /** 抽象分支并入后「可能不存在」的字面量键（get/has 需保守） */
  maybeAbsent?: Set<LitKey>;
};

type SetTable = {
  elements: Abs[];
  maybeAbsent?: boolean;
};

const mapTables = new WeakMap<object, MapTable>();
const setTables = new WeakMap<object, SetTable>();

/** $fork 抽象分支：每侧独立 overlay，避免身份表被另一侧 set 污染 */
type ArmOverlay = WeakMap<object, { map?: MapTable; set?: SetTable }>;
let armOverlays: ArmOverlay[] = [];

export function pushCollectionArm(): void {
  armOverlays.push(new WeakMap());
}

export function popCollectionArm(): ArmOverlay | undefined {
  return armOverlays.pop();
}

function cloneMapTable(t: MapTable): MapTable {
  return {
    byLit: new Map(t.byLit),
    shadowValues: [...t.shadowValues],
    maybeAbsent: t.maybeAbsent ? new Set(t.maybeAbsent) : undefined,
  };
}

function cloneSetTable(t: SetTable): SetTable {
  return { elements: [...t.elements], maybeAbsent: t.maybeAbsent };
}

/**
 * 合并 fork 各臂 overlay → 全局表（由 endCollectionFork 实现）。
 * 保留导出名以免外部测试/调用点漂移。
 */
export function mergeCollectionArms(arms: Array<ArmOverlay | undefined>): void {
  endCollectionFork(arms);
}

/** $fork 用：记录本 fork 探索中被写过的 identity */
let forkTouchedStack: Set<object>[] = [];

export function beginCollectionFork(): void {
  forkTouchedStack.push(new Set());
}

export function noteCollectionWrite(id: object): void {
  const top = forkTouchedStack[forkTouchedStack.length - 1];
  if (top) top.add(id);
}

export function endCollectionFork(arms: Array<ArmOverlay | undefined>): void {
  const touched = forkTouchedStack.pop() ?? new Set();
  const live = arms.filter(Boolean) as ArmOverlay[];
  if (live.length === 0) return;
  for (const id of touched) {
    const armTables: Array<MapTable | undefined> = [];
    const armSetTables: Array<SetTable | undefined> = [];
    let anyMap = false;
    let anySet = false;
    for (const arm of live) {
      const e = arm.get(id);
      if (e?.map) {
        anyMap = true;
        armTables.push(e.map);
      } else if (anyMap || armTables.length > 0) {
        armTables.push(undefined);
      }
      if (e?.set) {
        anySet = true;
        armSetTables.push(e.set);
      } else if (anySet || armSetTables.length > 0) {
        armSetTables.push(undefined);
      }
    }
    // 对齐各臂：未写入的臂用基表（或空）
    if (anyMap || armTables.some(Boolean)) {
      const base = mapTables.get(id) ?? emptyMapTable();
      const perArm: MapTable[] = live.map((arm) => {
        const e = arm.get(id);
        return e?.map ?? cloneMapTable(base);
      });
      const merged: MapTable = { byLit: new Map(), shadowValues: [], maybeAbsent: new Set() };
      const keyArms = new Map<LitKey, number>();
      for (const t of perArm) {
        for (const [k, v] of t.byLit) {
          const prev = merged.byLit.get(k);
          merged.byLit.set(k, prev ? joinAbs(prev, v) : v);
          keyArms.set(k, (keyArms.get(k) ?? 0) + 1);
        }
        for (const sv of t.shadowValues) merged.shadowValues.push(sv);
      }
      for (const [k, count] of keyArms) {
        if (count < perArm.length) merged.maybeAbsent!.add(k);
      }
      if (merged.maybeAbsent!.size === 0) delete merged.maybeAbsent;
      mapTables.set(id, merged);
    }
    if (anySet || armSetTables.some(Boolean)) {
      const base = setTables.get(id) ?? emptySetTable();
      const perArm: SetTable[] = live.map((arm) => {
        const e = arm.get(id);
        return e?.set ?? cloneSetTable(base);
      });
      const seen = new Set<LitKey>();
      const mergedEls: Abs[] = [];
      let missing = false;
      for (const t of perArm) {
        for (const el of t.elements) {
          const lk = litKeyOf(el);
          if (lk !== undefined) {
            if (seen.has(lk)) continue;
            seen.add(lk);
          }
          mergedEls.push(el);
        }
      }
      // 元素数不同 → 可能有臂未 add
      const maxLen = Math.max(...perArm.map((t) => t.elements.length), 0);
      if (perArm.some((t) => t.elements.length < maxLen)) missing = true;
      setTables.set(id, { elements: mergedEls, maybeAbsent: missing || undefined });
    }
  }
}

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

function mapTableForWrite(a: Abs): MapTable {
  noteCollectionWrite(a as object);
  if (armOverlays.length > 0) {
    const top = armOverlays[armOverlays.length - 1]!;
    let entry = top.get(a as object);
    if (!entry?.map) {
      const base = mapTables.get(a as object) ?? emptyMapTable();
      const cloned = cloneMapTable(base);
      entry = { ...(entry ?? {}), map: cloned };
      top.set(a as object, entry);
      return cloned;
    }
    return entry.map;
  }
  return mapTableOf(a);
}

function mapTableForRead(a: Abs): MapTable | undefined {
  if (armOverlays.length > 0) {
    const top = armOverlays[armOverlays.length - 1]!;
    const entry = top.get(a as object);
    if (entry?.map) return entry.map;
  }
  return mapTables.get(a as object);
}

function setTableForWrite(a: Abs): SetTable {
  noteCollectionWrite(a as object);
  if (armOverlays.length > 0) {
    const top = armOverlays[armOverlays.length - 1]!;
    let entry = top.get(a as object);
    if (!entry?.set) {
      const base = setTables.get(a as object) ?? emptySetTable();
      const cloned = cloneSetTable(base);
      entry = { ...(entry ?? {}), set: cloned };
      top.set(a as object, entry);
      return cloned;
    }
    return entry.set;
  }
  return setTableOf(a);
}

function setTableForRead(a: Abs): SetTable | undefined {
  if (armOverlays.length > 0) {
    const top = armOverlays[armOverlays.length - 1]!;
    const entry = top.get(a as object);
    if (entry?.set) return entry.set;
  }
  return setTables.get(a as object);
}

/** Map#set：fork 内写 overlay；否则原地。返回同一 Abs（JS 可变语义） */
export function mapSetEntry(mapAbs: Abs, key: Abs | undefined, value: Abs): Abs {
  const t = mapTableForWrite(mapAbs);
  const k = litKeyOf(key);
  if (k !== undefined) t.byLit.set(k, value);
  else if (value) t.shadowValues.push(value);
  return mapAbs;
}

function undefAbs(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined as never }, undefined, "exact");
}

function joinAll(els: Abs[]): Abs | undefined {
  if (els.length === 0) return undefined;
  return els.reduce((a, b) => joinAbs(a, b));
}

/** Map#get：命中字面量 key → 精确；miss / 未知 key / maybeAbsent 并 undefined */
export function mapGetEntry(mapAbs: Abs, key: Abs | undefined): Abs {
  const t = mapTableForRead(mapAbs);
  if (!t) return unknown;
  const k = litKeyOf(key);
  if (k !== undefined) {
    const v = t.byLit.get(k);
    const absent = t.maybeAbsent?.has(k) === true;
    if (v !== undefined && !absent && t.shadowValues.length === 0) return v;
    if (v !== undefined && (absent || t.shadowValues.length > 0)) {
      return joinAbs(v, undefAbs());
    }
    if (t.shadowValues.length === 0) return undefAbs();
  }
  // 字面量 miss / 未知 key：并入 undefined（存在性）
  const known = [...t.byLit.values(), ...t.shadowValues];
  const joined = joinAll(known);
  if (k !== undefined && t.shadowValues.length === 0 && t.maybeAbsent?.has(k) !== false) {
    return undefAbs();
  }
  if (joined === undefined) {
    return k !== undefined ? undefAbs() : unknown;
  }
  return joinAbs(joined, undefAbs());
}

/** Map#has：字面量 miss 折 exact false 时，get 必须是 undefined（不可再并 value） */
export function mapHasEntry(mapAbs: Abs, key: Abs | undefined): Abs {
  const t = mapTableForRead(mapAbs);
  if (!t) return unknown;
  const k = litKeyOf(key);
  if (k === undefined) {
    // 未知 key：有条目则可能 true/false，无条目 unknown
    return t.byLit.size > 0 || t.shadowValues.length > 0
      ? abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial")
      : unknown;
  }
  const hit = t.byLit.has(k);
  const maybeAbsent = t.maybeAbsent?.has(k) === true;
  // shadow key / fork maybeAbsent 不能折 exact false
  if ((!hit && t.shadowValues.length > 0) || maybeAbsent || (!hit && t.shadowValues.length > 0)) {
    return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
  }
  if (hit && maybeAbsent) {
    return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
  }
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

/** Set#add：fork 内写 overlay；返回同一 Abs */
export function setAddEntry(setAbs: Abs, value: Abs): Abs {
  const t = setTableForWrite(setAbs);
  t.elements.push(value);
  return setAbs;
}

export function setHasEntry(setAbs: Abs, value: Abs): Abs {
  const t = setTableForRead(setAbs);
  if (!t) return unknown;
  const k = litKeyOf(value);
  if (k !== undefined) {
    const hit = t.elements.some((el) => litKeyOf(el) === k);
    if (t.maybeAbsent && !hit) {
      return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
    }
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
