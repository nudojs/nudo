/**
 * Map / Set 字面量条目追踪（C1.1 / C1.2）。
 * 按 Abs 对象身份挂 side table：`m.set("k", v)` 后同 identity 的 `m.get("k")`
 * 可回查。非字面量 key 不入表；get/has 对未知 key 保守回落。
 */

import type { Abs } from "./abs.ts";
import { abs, anyAbs, litValue, unknown, confJoin, strLit, boolLit } from "./abs.ts";
import { objOf, joinAbs } from "./objects.ts";
import { isDomainShared } from "./len-sharing.ts";
import { NudoThrow } from "./nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "./may-throw.ts";

type LitKey = string | number | boolean | null | undefined;
/** litKeyOf 无字面量哨兵：lit(undefined) 是合法键，不得与「无字面量」共用 undefined */
const NO_LIT_KEY: unique symbol = Symbol("nudo:no-lit-key");
type LitKeyResult = LitKey | typeof NO_LIT_KEY;

type MapTable = {
  byLit: Map<LitKey, Abs>;
  /** 非字面量 key 写入的值（get 未知 key 时 join 用） */
  shadowValues: Abs[];
  /**
   * Bug 88：身份键条目（同一非字面量值——对象/函数/brand/any 绑定——
   * 重复写不重复计数）。键不可字面量化但有可判身份（identKeyOf），
   * size/keys/entries 仍可折 exact；无身份键的非字面量写入仍走
   * shadowValues（size 保守）。
   */
  identEntries: Array<{ key: Abs; value: Abs }>;
  /** 抽象分支并入后「可能不存在」的字面量键（get/has 需保守） */
  maybeAbsent?: Set<LitKey>;
};

type SetTable = {
  elements: Abs[];
  /**
   * fork 后 membership 不确定。
   * - `true`：整表不确定（未知 delete / 非字面量元素混杂）
   * - `Set<LitKey>`：这些字面 key 可能在部分臂缺失（跨臂 delete 不同元素时，长度启发式不够）
   */
  maybeAbsent?: true | Set<LitKey>;
};

const mapTables = new WeakMap<object, MapTable>();
const setTables = new WeakMap<object, SetTable>();

/** $fork 抽象分支：每侧独立 overlay，避免身份表被另一侧 set 污染。
 *  惰性：无集合写入时不分配 WeakMap（fork 热路径上无 Map/Set 是常态）。 */
type ArmOverlay = WeakMap<object, { map?: MapTable; set?: SetTable }>;
let armOverlays: (ArmOverlay | null)[] = [];

export function pushCollectionArm(): void {
  armOverlays.push(null);
}

export function popCollectionArm(): ArmOverlay | undefined {
  return armOverlays.pop() ?? undefined;
}

function topArmOverlay(): ArmOverlay {
  const i = armOverlays.length - 1;
  let top = armOverlays[i];
  if (!top) {
    top = new WeakMap();
    armOverlays[i] = top;
  }
  return top;
}

function cloneMapTable(t: MapTable): MapTable {
  return {
    byLit: new Map(t.byLit),
    shadowValues: [...t.shadowValues],
    identEntries: t.identEntries.map((e) => ({ ...e })),
    maybeAbsent: t.maybeAbsent ? new Set(t.maybeAbsent) : undefined,
  };
}

function cloneSetTable(t: SetTable): SetTable {
  return {
    elements: [...t.elements],
    maybeAbsent:
      t.maybeAbsent instanceof Set ? new Set(t.maybeAbsent) : t.maybeAbsent,
  };
}

function setAbsentKey(t: SetTable | undefined, k: LitKey): boolean {
  if (!t) return false;
  if (t.maybeAbsent === true) return true;
  return t.maybeAbsent instanceof Set && t.maybeAbsent.has(k);
}

function setAnyAbsent(t: SetTable | undefined): boolean {
  if (!t) return false;
  return t.maybeAbsent === true || (t.maybeAbsent instanceof Set && t.maybeAbsent.size > 0);
}

/**
 * 合并 fork 各臂 overlay → 全局表（由 endCollectionFork 实现）。
 * 保留导出名以免外部测试/调用点漂移。
 */
export function mergeCollectionArms(arms: Array<ArmOverlay | undefined | null>): void {
  endCollectionFork(arms);
}

/** $fork 用：记录本 fork 探索中被写过的 identity。
 *  惰性：无写入时栈槽为 null（fork 常态），避免每 fork 分配 Set。 */
let forkTouchedStack: (Set<object> | null)[] = [];

export function beginCollectionFork(): void {
  forkTouchedStack.push(null);
}

export function noteCollectionWrite(id: object): void {
  const i = forkTouchedStack.length - 1;
  if (i < 0) return;
  let top = forkTouchedStack[i];
  if (!top) {
    top = new Set();
    forkTouchedStack[i] = top;
  }
  top.add(id);
}

export function endCollectionFork(arms: Array<ArmOverlay | undefined | null>): void {
  const touched = forkTouchedStack.pop();
  // 无集合写入 → 零 merge（fork 热路径快出）
  if (!touched || touched.size === 0) return;
  // 空臂槽位必须计入 perArm.length（条件写入的 maybeAbsent 依赖臂计数）
  if (arms.length === 0) return;
  // 嵌套 fork：外层臂 overlay 仍在栈上时，merge 结果只能写入当前臂，
  // 绝不能落盘全局——否则兄弟臂未写时会读到内层污染。
  // 外层臂可能尚未 materialize（惰性 overlay）——commit 时再建，不能落全局。
  const nested = armOverlays.length > 0;
  const outerArm = nested ? armOverlays[armOverlays.length - 1] : undefined;
  const commitMap = (id: object, merged: MapTable): void => {
    if (nested) {
      const outer = topArmOverlay();
      const e = outer.get(id) ?? {};
      outer.set(id, { ...e, map: merged });
    } else {
      mapTables.set(id, merged);
    }
  };
  const commitSet = (id: object, merged: SetTable): void => {
    if (nested) {
      const outer = topArmOverlay();
      const e = outer.get(id) ?? {};
      outer.set(id, { ...e, set: merged });
    } else {
      setTables.set(id, merged);
    }
  };
  for (const id of touched) {
    const armTables: Array<MapTable | undefined> = [];
    const armSetTables: Array<SetTable | undefined> = [];
    let anyMap = false;
    let anySet = false;
    for (const arm of arms) {
      const e = arm?.get(id);
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
    // 对齐各臂：未写入的臂用基表（嵌套时优先读外层 overlay，再读全局）
    if (anyMap || armTables.some(Boolean)) {
      const base =
        (nested ? mapTableForReadBase(outerArm, id) : mapTables.get(id)) ?? emptyMapTable();
      const perArm: MapTable[] = arms.map((arm) => {
        const e = arm?.get(id);
        return e?.map ?? cloneMapTable(base);
      });
      const merged: MapTable = { byLit: new Map(), shadowValues: [], identEntries: [], maybeAbsent: new Set() };
      const keyArms = new Map<LitKey, number>();
      const forcedAbsent = new Set<LitKey>();
      // Bug 88：身份键条目按臂计数——全臂在场的键保 exact（值 join），
      // 部分臂在场 → 键可能缺席 → 值降级 shadowValues（size/get 保守）
      const identArms = new Map<object, { key: Abs; value: Abs; count: number }>();
      for (const t of perArm) {
        for (const [k, v] of t.byLit) {
          const prev = merged.byLit.get(k);
          merged.byLit.set(k, prev ? joinAbs(prev, v) : v);
          keyArms.set(k, (keyArms.get(k) ?? 0) + 1);
        }
        for (const sv of t.shadowValues) merged.shadowValues.push(sv);
        for (const e of t.identEntries) {
          const ik = refIdentKeyOf(e.key) ?? (e.key as object);
          const prev = identArms.get(ik);
          if (prev) {
            prev.value = joinAbs(prev.value, e.value);
            prev.count++;
          } else {
            identArms.set(ik, { key: e.key, value: e.value, count: 1 });
          }
        }
        // 未知 key delete 只标 maybeAbsent、byLit 仍保留：键计数不够，必须并集
        if (t.maybeAbsent) {
          for (const k of t.maybeAbsent) forcedAbsent.add(k);
        }
      }
      for (const [k, count] of keyArms) {
        if (count < perArm.length) merged.maybeAbsent!.add(k);
      }
      for (const k of forcedAbsent) merged.maybeAbsent!.add(k);
      for (const e of identArms.values()) {
        if (e.count >= perArm.length) merged.identEntries.push({ key: e.key, value: e.value });
        else merged.shadowValues.push(e.value);
      }
      if (merged.maybeAbsent!.size === 0) delete merged.maybeAbsent;
      commitMap(id, merged);
    }
    if (anySet || armSetTables.some(Boolean)) {
      const base =
        (nested ? setTableForReadBase(outerArm, id) : setTables.get(id)) ?? emptySetTable();
      const perArm: SetTable[] = arms.map((arm) => {
        const e = arm?.get(id);
        return e?.set ?? cloneSetTable(base);
      });
      const seen = new Set<LitKey>();
      const mergedEls: Abs[] = [];
      // per-key 臂计数（对齐 Map merge）：跨臂 delete 不同字面 key、长度相同也必须 maybeAbsent
      const litArmCount = new Map<LitKey, number>();
      const forcedAbsent = new Set<LitKey>();
      // Bug 88：身份键元素跨臂并集去重（同身份 = 原生同一对象），臂计数对齐
      // 字面 key——部分臂在场 → membership 不确定（wholeUncertain）
      const identSeen = new Set<object>();
      const identArmCount = new Map<object, number>();
      let wholeUncertain = false;
      let hasNonLit = false;
      for (const t of perArm) {
        if (t.maybeAbsent === true) wholeUncertain = true;
        if (t.maybeAbsent instanceof Set) {
          for (const k of t.maybeAbsent) forcedAbsent.add(k);
        }
        const armLits = new Set<LitKey>();
        const armIdents = new Set<object>();
        for (const el of t.elements) {
          const lk = litKeyOf(el);
          if (isLitKey(lk)) {
            if (!seen.has(lk)) {
              seen.add(lk);
              mergedEls.push(el);
            }
            armLits.add(lk);
          } else {
            const ik = identKeyOf(el);
            if (ik !== undefined) {
              if (!identSeen.has(ik)) {
                identSeen.add(ik);
                mergedEls.push(el);
              }
              armIdents.add(ik);
            } else {
              hasNonLit = true;
              mergedEls.push(el);
            }
          }
        }
        for (const k of armLits) {
          litArmCount.set(k, (litArmCount.get(k) ?? 0) + 1);
        }
        for (const ik of armIdents) {
          identArmCount.set(ik, (identArmCount.get(ik) ?? 0) + 1);
        }
      }
      const maybeKeys = new Set<LitKey>();
      if (wholeUncertain || hasNonLit) {
        wholeUncertain = true;
      } else {
        for (const [k, count] of litArmCount) {
          if (count < perArm.length) maybeKeys.add(k);
        }
        for (const k of forcedAbsent) maybeKeys.add(k);
        // Bug 88：身份键部分臂在场 → 该元素 membership 不确定 → 整表不确定
        for (const count of identArmCount.values()) {
          if (count < perArm.length) wholeUncertain = true;
        }
      }
      commitSet(id, {
        elements: mergedEls,
        maybeAbsent: wholeUncertain
          ? true
          : maybeKeys.size > 0
            ? maybeKeys
            : undefined,
      });
    }
  }
}

function mapTableForReadBase(arm: ArmOverlay | null | undefined, id: object): MapTable | undefined {
  return arm?.get(id)?.map ?? mapTables.get(id);
}

function setTableForReadBase(arm: ArmOverlay | null | undefined, id: object): SetTable | undefined {
  return arm?.get(id)?.set ?? setTables.get(id);
}

function emptyMapTable(): MapTable {
  return { byLit: new Map(), shadowValues: [], identEntries: [] };
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

function litKeyOf(a: Abs | undefined): LitKeyResult {
  if (!a) return NO_LIT_KEY;
  // 仅 term lit 是字面量键（含 lit(undefined)）；抽象 Abs → NO_LIT_KEY
  if (a.term?.op === "lit") return a.term.value as LitKey;
  return NO_LIT_KEY;
}

function isLitKey(x: LitKeyResult): x is LitKey {
  return x !== NO_LIT_KEY;
}

/** SameValueZero（JS Set/Map 键语义）：NaN 相等、+0/-0 相等 */
function sameValueZeroKey(a: LitKeyResult, b: LitKeyResult): boolean {
  if (a === NO_LIT_KEY || b === NO_LIT_KEY) return false;
  if (a === b) return true;
  return typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b);
}

/**
 * Bug 88：**引用语义**身份键——同键 ⇒ 原生同一引用值（SameValueZero 相等）。
 * 引用语义形态（obj/arr/tuple/fn/brand/eff + symbol）以 **Abs 引用** 为身份：
 * 同一创建事件 / 同一绑定的别名传播（变量赋值、槽位存取、函数传参）复用
 * 同一 Abs 引用（instance-id.ts 同一健全性依据，strictEqAbs 同引用臂同口径）。
 * 不可作身份键（返回 undefined）：
 * - 字面量键（走 byLit 通道，含 lit(undefined)/NaN）；
 * - 域共享值（len-sharing.ts：xs[0]/xs[1] 元素域分发、回调元素实参）——
 *   同一 Abs 代表**多个**具体值，去重会假 1；
 * - 抽象 prim 域（无 lit term 的 number/string/bool/bigint）、any/unknown、
 *   sum——同 Abs 只保证同抽象域，不保证同具体值。
 * 该谓词可安全用于「未命中 ⇒ 一定不存在」的精确 miss 折叠：引用值与
 * 字面量/其它引用恒不等（fresh instance 身份，strictEqAbs 同口径）。
 */
function refIdentKeyOf(a: Abs | undefined): object | undefined {
  if (!a) return undefined;
  if (isLitKey(litKeyOf(a))) return undefined;
  if (isDomainShared(a)) return undefined;
  const k = a.shape.k;
  if (k === "obj" || k === "arr" || k === "tuple" || k === "fn" || k === "brand" || k === "eff") {
    return a as object;
  }
  // symbol：同引用同符号（strictEqAbs 同口径；symbol-id 侧表另有细分，此处只取同引用恒等）
  if (k === "prim" && a.shape.type === "symbol") return a as object;
  return undefined;
}

/**
 * Bug 88：**绑定级**身份键 = 引用语义键 + 非单例 any/unknown 绑定值
 * （逐形参/逐成员铸造的新 Abs，如 check 入口的 any 形参）。同一 Abs 引用
 * = 同一绑定/同一创建事件 → 原生同一值，可用于**同绑定去重**（add 侧）；
 * 但 any/unknown 键原生可能恰为某字面量/其它引用（形参无约束），**不得**
 * 用于精确 miss / 键域全特定 / Map 键通道（那类判断用 refIdentKeyOf）。
 * 全局共享单例 anyAbs/unknown（失败兜底值跨来源复用同一引用）除外。
 * 注意：两个**不同**身份键只代表「不同绑定/创建事件」，原生仍可能巧合
 * 同引用（s.add(x); s.add(y) 两 any 形参实参相同对象）——该残余过近似
 * 是既有口径（此前同样折 exact 计数），不在 Bug 88 范围。
 */
function identKeyOf(a: Abs | undefined): object | undefined {
  const ref = refIdentKeyOf(a);
  if (ref !== undefined || !a) return ref;
  const k = a.shape.k;
  if ((k === "any" || k === "unknown") && a !== anyAbs && a !== unknown) return a as object;
  return undefined;
}

export function isMapAbs(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "brand" && a.shape.name === "Map";
}

export function isSetAbs(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "brand" && a.shape.name === "Set";
}

/** 从可迭代 Abs 填充元素（tuple/arr/string/Set/Map）；其它形态忽略 */
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
  // 字符串字面量：按 code point 迭代（new Set('aab') → {a,b}）
  const svR = litValue(iterable);
  const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
  if (typeof sv === "string") {
    return [...sv].map((c) => strLit(c));
  }
  // Set/Map 拷贝：条目表（Map 条目是 [k,v] 元组）
  if (isSetAbs(iterable)) return [...setElementsAbs(iterable)];
  if (isMapAbs(iterable)) return [...mapEntriesAbs(iterable)];
  return [];
}

/** Bug 43：CanBeHeldWeakly 校验分类（FinalizationRegistry.register/unregister 弱键；
 *  Bug 8 起也供集合构造器条目键复用。自 builtins/error.ts 移入本内核叶子，
 *  避免 collections ↔ builtins 新环，单一口径。） */
export type WeakHeldClass = { k: "ok" } | { k: "def" } | { k: "may" };

/**
 * Bug 43：ES CanBeHeldWeakly 分类——对象形态（obj/tuple/arr/fn/brand/eff）
 * 与 symbol 是合法弱键（node 26 实测 register(Symbol(),1) 不抛）；
 * number/string/boolean/bigint 字面量与 nullish 字面量/缺省 ≡ undefined
 * → 确定非弱键；抽象 prim/any/unknown/含坏成员 union → may。
 */
export function classifyCanBeHeldWeakly(a: Abs | undefined): WeakHeldClass {
  if (!a) return { k: "def" }; // 缺省 ≡ undefined：非弱键
  const s = a.shape;
  if (s.k === "prim") {
    // shape-first：symbol 恒无 lit term（无 symbol 字面量），先查形态
    if (s.type === "symbol") return { k: "ok" };
    return a.term?.op === "lit" ? { k: "def" } : { k: "may" }; // 抽象 prim：值未知
  }
  if (s.k === "any" || s.k === "unknown") {
    if (a.term?.op !== "lit") return { k: "may" };
    // nullish 字面量挂 k:"unknown" + lit term（与 isNullishLit 同口径）→
    // 非弱键；symbol 字面量同挂 unknown 形态（shapeOfTerm）但可弱持有
    // （node 实测 new WeakSet([Symbol()]) 不抛）
    return typeof a.term.value === "symbol" ? { k: "ok" } : { k: "def" };
  }
  if (s.k === "sum") {
    // 有坏成员但可能取好成员 → 整体 may（与 classifyToIndex 同口径，不 definite）
    for (const m of s.members) {
      if (classifyCanBeHeldWeakly(m).k !== "ok") return { k: "may" };
    }
    return { k: "ok" };
  }
  return { k: "ok" }; // obj/fn/brand/tuple/arr/eff：对象 → 弱键合法
}

/** Bug 8：条目「是对象」分类（Map/WeakMap AddEntriesFromIterable 的 IsObject，
 *  node 实测 new Map([null]) / ([1]) / (["s"]) / ([Symbol()]) 均
 *  TypeError "Iterator value … is not an entry object"）：
 *  prim（number/string/bool/bigint/symbol——含抽象 prim）与 nullish/symbol
 *  字面量（shape unknown + lit term）→ 确定非对象；any/unknown 非字面量、
 *  开放 obj → 可能非对象；tuple/arr/fn/brand/eff/闭 obj → 对象。 */
type EntryObjectClass = { k: "ok" } | { k: "def" } | { k: "may" };

function classifyEntryObject(a: Abs | undefined): EntryObjectClass {
  if (!a) return { k: "def" }; // 缺省 ≡ undefined：非 entry 对象
  const s = a.shape;
  if (s.k === "prim") return { k: "def" };
  if (s.k === "any" || s.k === "unknown") {
    return a.term?.op === "lit" ? { k: "def" } : { k: "may" };
  }
  if (s.k === "obj") return s.open === true ? { k: "may" } : { k: "ok" };
  if (s.k === "sum") {
    for (const m of s.members) {
      if (classifyEntryObject(m).k !== "ok") return { k: "may" };
    }
    return { k: "ok" };
  }
  return { k: "ok" }; // tuple/arr/fn/brand/eff/never：对象（never 空臂不可达）
}

/** Bug 8：WeakMap 条目键 = Get(entry, "0")——按条目形态取下标 0 的值。
 *  keyUndefined 表示键不可知（开放对象/index/eff 等查不到 0 槽的形态），
 *  供 may 记录；tuple 缺首元素 / 闭形态无 0 槽 ≡ 键 undefined（非弱键）。 */
function weakMapEntryKey(el: Abs): { key: Abs | undefined; keyUnknown: boolean } {
  let s: Abs["shape"] = el.shape;
  while (s.k === "brand") s = s.shape.shape;
  if (s.k === "tuple") {
    if (s.holes?.includes(0)) return { key: undefined, keyUnknown: false };
    return { key: s.elements[0], keyUnknown: false };
  }
  if (s.k === "obj" || s.k === "fn") {
    const slot0 = s.slots?.["0"];
    if (slot0) return { key: slot0.value, keyUnknown: false };
    if (s.k === "obj" && (s.open === true || s.index)) return { key: undefined, keyUnknown: true };
    return { key: undefined, keyUnknown: false };
  }
  if (s.k === "arr") return { key: s.element, keyUnknown: false };
  return { key: undefined, keyUnknown: true };
}

/** Bug 8：外层 iterable「可能非可迭代」——迭代性不确定的形态记 may TypeError。
 *  Map/Set brand 自身带迭代协议（拷贝构造全定不记，避免 gate 假阳）；
 *  prim 非串臂仅 sum 成员可达（顶层已被 nonIterableLit 定抛）。 */
function mayBeNonIterableOuter(a: Abs): boolean {
  const k = a.shape.k;
  if (k === "prim") return (a.shape as { k: "prim"; type: string }).type !== "string";
  if (k === "sum") return (a.shape as { k: "sum"; members: Abs[] }).members.some(mayBeNonIterableOuter);
  if (k === "brand") {
    const n = (a.shape as { k: "brand"; name: string }).name;
    return n !== "Map" && n !== "Set";
  }
  return k === "any" || k === "unknown" || k === "obj" || k === "fn";
}

/**
 * 构造器实参**确定**非法（原生 TypeError 域）：
 * - 非可迭代字面量（number/boolean/symbol/bigint、闭对象字面量、symbol
 *   字面量）→ 四个集合构造器都抛
 * - Map/WeakMap 条目必须是对象（IsObject）：prim 条目（含字符串实参的
 *   每个字符、tuple/Set 元素）与 nullish 字面量条目 → TypeError
 *   （Bug 8：null/undefined/symbol 字面量挂 shape unknown + lit term，
 *   旧 primEntry 只查 prim 形态 → 漏抛）
 * - WeakMap 键 = Get(entry, "0") 须可弱持有（classifyCanBeHeldWeakly 同
 *   口径）：零/一元组、闭对象/fn/无 0 槽 brand 条目键 undefined、prim/
 *   nullish 键 → TypeError（Bug 8：旧口径只查 ≥2 元组首元素 prim）
 * - WeakSet 元素须可弱持有：prim/nullish 字面量元素（含字符串字符）→
 *   TypeError；symbol 元素合法（node 实测 new WeakSet([Symbol()]) 不抛）
 * - Bug 8 gate 面：抽象外层 iterable（any/unknown/开放 obj/fn/其它 brand）
 *   可能非可迭代、抽象元素（含抽象字符串实参的字符臂）可能非 entry/
 *   非弱键 → recordMayThrow（三个分派点共用本判定，集中记录）
 */
export function ctorArgDefinitelyInvalid(
  name: "Map" | "Set" | "WeakMap" | "WeakSet",
  iterable: Abs | undefined,
): boolean {
  if (!iterable) return false; // null/undefined → 空容器
  // nullish 字面量：空容器（new Set(null) 合法）
  if (iterable.term?.op === "lit" && iterable.term.value === null) return false;
  if (iterable.term?.op === "lit" && iterable.term.value === undefined) return false;
  const nonIterableLit = (a: Abs): boolean => {
    if (a.shape.k === "prim") {
      const vR = litValue(a);
      const v = vR.ok ? vR.value : undefined;
      if (typeof v === "string") return false; // 字符串可迭代
      return true; // number/bool/symbol/bigint 字面量不可迭代
    }
    // symbol 字面量挂 unknown 形态（shapeOfTerm），同样不可迭代
    if (a.shape.k === "unknown" && a.term?.op === "lit" && typeof a.term.value === "symbol") {
      return true;
    }
    if (a.shape.k === "obj" && a.shape.open !== true) return true; // 闭对象字面量
    return false;
  };
  if (nonIterableLit(iterable)) return true;
  // Bug 8：抽象外层 iterable 可能非可迭代 → L2 gate 记 may TypeError；
  // 抽象字符串实参的字符是非 entry prim / 非弱键（空串臂合法）→ 同记
  // （Set 不查元素形态，仅非可迭代面）
  if (mayBeNonIterableOuter(iterable)) {
    recordMayThrow({
      kind: "TypeError",
      cause: `new ${name}(x) iterable may be non-iterable`,
    });
  } else if (
    name !== "Set" &&
    iterable.shape.k === "prim" &&
    iterable.shape.type === "string" &&
    iterable.term?.op !== "lit"
  ) {
    recordMayThrow({
      kind: "TypeError",
      cause: `new ${name}(str) char entries may be non-object or non-weak key`,
    });
  }
  if (name === "Set") return false;
  // Map/WeakMap/WeakSet：逐条目/元素校验（elementsFrom 与值侧同源：
  // tuple/arr/sum/字符串字面量/Set/Map 拷贝）
  for (const el of elementsFrom(iterable)) {
    if (name === "WeakSet") {
      const wk = classifyCanBeHeldWeakly(el);
      if (wk.k === "def") return true;
      if (wk.k === "may") {
        recordMayThrow({
          kind: "TypeError",
          cause: "new WeakSet(x) element may not be weakly holdable",
        });
      }
      continue;
    }
    const eo = classifyEntryObject(el);
    if (eo.k === "def") return true;
    if (name === "WeakMap") {
      const { key, keyUnknown } = weakMapEntryKey(el);
      const wk = classifyCanBeHeldWeakly(key);
      if (wk.k === "def") return true;
      if (wk.k === "may" || keyUnknown || eo.k === "may") {
        recordMayThrow({
          kind: "TypeError",
          cause: "new WeakMap(x) entry key may not be weakly holdable",
        });
      }
      continue;
    }
    if (eo.k === "may") {
      recordMayThrow({
        kind: "TypeError",
        cause: "new Map(x) iterator value may not be an entry object",
      });
    }
  }
  return false;
}

/**
 * Bug 15：new WeakMap/WeakSet(iterable) —— Map/Set 同口径的 iterable 实参校验
 * （非可迭代字面量 / prim 条目·元素 / WeakMap prim 键 → 原生 TypeError，
 * NudoThrow 由调用边界收成 throws）；缺省/nullish/空串合法 → 空 brand。
 * 弱持有条目表不建模（key 身份不在分析域）。
 */
export function makeWeakCollectionAbs(
  name: "WeakMap" | "WeakSet",
  iterable: Abs | undefined,
): Abs {
  if (ctorArgDefinitelyInvalid(name, iterable)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  return brandOf(name);
}

export function makeMapAbs(iterable?: Abs): Abs {
  const m = brandOf("Map");
  const table = emptyMapTable();
  for (const el of elementsFrom(iterable)) {
    // Map 构造接收 entry 元组 [k, v] 时拆开；否则整段作 value、key 未建模。
    // Bug 8：一元/零元组也是合法条目（缺省键/值 ≡ undefined——native
    // new Map([["a"]]).size === new Map([[]]).size === 1），此前 ≥2 元组
    // 才入表 → size 假 0
    if (el.shape.k === "tuple") {
      const k = el.shape.elements[0] ?? undefAbs();
      const v = el.shape.elements[1] ?? undefAbs();
      // Bug 88：非字面量键走身份通道（同键覆盖写）——new Map([[k,1],[k,2]])
      // 原生单条目
      mapTableSet(table, k, v);
      continue;
    }
    // Bug 8：对象条目键 = Get(entry, "0")——闭形态（obj/fn/brand 剥壳）无
    // 0 槽 → undefined 键入表（size 精确 +1）；开放 obj/index → 键不可知
    // → shadow（size 诚实 unknown）
    let s: Abs["shape"] = el.shape;
    while (s.k === "brand") s = s.shape.shape;
    if (s.k === "obj" || s.k === "fn") {
      const slot0 = s.slots?.["0"];
      const slot1 = s.slots?.["1"];
      if (slot0) {
        // Bug 88：同上——键可判身份时精确入表
        mapTableSet(table, slot0.value, slot1?.value ?? undefAbs());
      } else if (s.k === "obj" && (s.open === true || s.index)) {
        table.shadowValues.push(undefAbs());
      } else {
        table.byLit.set(undefined, undefAbs());
      }
      continue;
    }
    if (s.k === "arr") {
      // 数组条目：键 = 首元素（抽象数组的元素域）
      const lk = litKeyOf(s.element);
      if (isLitKey(lk)) table.byLit.set(lk, undefAbs());
      else table.shadowValues.push(undefAbs());
      continue;
    }
    // 抽象条目（any/unknown/sum）：可能入包 → size 不可折（shadow 保底）
    table.shadowValues.push(unknown);
  }
  mapTables.set(m as object, table);
  return m;
}

export function makeSetAbs(iterable?: Abs): Abs {
  const s = brandOf("Set");
  const table = emptySetTable();
  const seen = new Set<LitKey>();
  // Bug 88：非字面量元素按身份去重（new Set([k,k]) → 单条目）
  const seenIdent = new Set<object>();
  for (const el of elementsFrom(iterable)) {
    const lk = litKeyOf(el);
    if (isLitKey(lk)) {
      if (seen.has(lk)) continue;
      seen.add(lk);
    } else {
      const ik = identKeyOf(el);
      if (ik !== undefined) {
        if (seenIdent.has(ik)) continue;
        seenIdent.add(ik);
      }
    }
    table.elements.push(el);
  }
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
    let base: MapTable | undefined;
    for (let i = 0; i < armOverlays.length; i++) {
      const e = armOverlays[i]?.get(a as object);
      if (e?.map) base = e.map;
    }
    if (!base) base = mapTables.get(a as object);
    const top = topArmOverlay();
    let entry = top.get(a as object);
    if (!entry?.map) {
      const cloned = cloneMapTable(base ?? emptyMapTable());
      entry = { ...(entry ?? {}), map: cloned };
      top.set(a as object, entry);
      return cloned;
    }
    return entry.map;
  }
  return mapTableOf(a);
}

function mapTableForRead(a: Abs): MapTable | undefined {
  for (let i = armOverlays.length - 1; i >= 0; i--) {
    const entry = armOverlays[i]?.get(a as object);
    if (entry?.map) return entry.map;
  }
  return mapTables.get(a as object);
}

function setTableForWrite(a: Abs): SetTable {
  noteCollectionWrite(a as object);
  if (armOverlays.length > 0) {
    let base: SetTable | undefined;
    for (let i = 0; i < armOverlays.length; i++) {
      const e = armOverlays[i]?.get(a as object);
      if (e?.set) base = e.set;
    }
    if (!base) base = setTables.get(a as object);
    const top = topArmOverlay();
    let entry = top.get(a as object);
    if (!entry?.set) {
      const cloned = cloneSetTable(base ?? emptySetTable());
      entry = { ...(entry ?? {}), set: cloned };
      top.set(a as object, entry);
      return cloned;
    }
    return entry.set;
  }
  return setTableOf(a);
}

function setTableForRead(a: Abs): SetTable | undefined {
  for (let i = armOverlays.length - 1; i >= 0; i--) {
    const entry = armOverlays[i]?.get(a as object);
    if (entry?.set) return entry.set;
  }
  return setTables.get(a as object);
}

/**
 * Bug 88：MapTable 条目写入——字面量键 byLit、引用身份键 identEntries
 * （Map#set 覆盖写：同 SameValueZero 键替换值、不重复计数）、其余非字面量
 * 键 shadowValues（size 保守）。身份键只取**引用语义**形态（refIdentKeyOf）：
 * any/unknown 键原生可能恰为某字面量/其它引用，入身份通道会让字面量
 * miss 折 exact false——必须留在 shadow 通道。
 */
function mapTableSet(t: MapTable, key: Abs, value: Abs): void {
  const lk = litKeyOf(key);
  if (isLitKey(lk)) {
    t.byLit.set(lk, value);
    return;
  }
  const ik = refIdentKeyOf(key);
  if (ik !== undefined) {
    const hit = t.identEntries.find((e) => refIdentKeyOf(e.key) === ik);
    if (hit) hit.value = value;
    else t.identEntries.push({ key, value });
    return;
  }
  t.shadowValues.push(value);
}

/** Map#set：fork 内写 overlay；否则原地。返回同一 Abs（JS 可变语义） */
export function mapSetEntry(mapAbs: Abs, key: Abs | undefined, value: Abs): Abs {
  const t = mapTableForWrite(mapAbs);
  if (key) mapTableSet(t, key, value);
  else if (value) t.shadowValues.push(value);
  return mapAbs;
}

/** Map#delete：fork overlay 内移除字面量键；未知 key 仅标 shadow 不确定。
 * Bug 88：引用身份键删除可精确命中（同引用条目移除）/精确 miss（键域全
 * 特定且无 shadow 时）。any/unknown 等无引用身份的抽象键删除 → 身份条目
 * 降级 shadow（键可能就是任一身份键，size/get 回保守）。 */
export function mapDeleteEntry(mapAbs: Abs, key: Abs | undefined): Abs {
  const t = mapTableForWrite(mapAbs);
  const k = litKeyOf(key);
  if (isLitKey(k)) {
    t.byLit.delete(k);
    t.maybeAbsent?.delete(k);
    // 删除后若仍有 shadow 写入，get/has 仍须保守
    return abs(
      { k: "prim", type: "boolean" },
      undefined,
      undefined,
      "path",
    );
  }
  const ik = refIdentKeyOf(key);
  if (ik !== undefined) {
    const before = t.identEntries.length;
    t.identEntries = t.identEntries.filter((e) => refIdentKeyOf(e.key) !== ik);
    if (t.identEntries.length < before) return boolLit(true);
    if (t.shadowValues.length === 0) return boolLit(false);
    // shadow 存在：未知键可能就是查询键 → 删除结果不确定（保守 partial）
    return abs(
      { k: "prim", type: "boolean" },
      undefined,
      undefined,
      "path",
    );
  }
  // 抽象键（any/unknown/域共享/prim 域）：可能删掉任一已知键——字面量键
  // maybeAbsent；身份条目降级 shadow（不降级会让 get/has/keys 假精确）
  if (t.byLit.size > 0) t.maybeAbsent = new Set(t.byLit.keys());
  for (const e of t.identEntries) t.shadowValues.push(e.value);
  t.identEntries.length = 0;
  return abs(
    { k: "prim", type: "boolean" },
    undefined,
    undefined,
    "path",
  );
}

/** Map#clear：清空条目；fork 下仍走 overlay */
export function mapClearEntries(mapAbs: Abs): Abs {
  const t = mapTableForWrite(mapAbs);
  t.byLit.clear();
  t.shadowValues.length = 0;
  t.identEntries.length = 0;
  delete t.maybeAbsent;
  return undefAbs();
}

function undefAbs(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");
}

function joinAll(els: Abs[]): Abs | undefined {
  if (els.length === 0) return undefined;
  return els.reduce((a, b) => joinAbs(a, b));
}

/** Map#get：命中字面量/身份 key → 精确；miss / 未知 key / maybeAbsent / shadow 并 undefined */
export function mapGetEntry(mapAbs: Abs, key: Abs | undefined): Abs {
  const t = mapTableForRead(mapAbs);
  if (!t) return unknown;
  const k = litKeyOf(key);
  if (isLitKey(k)) {
    const v = t.byLit.get(k);
    const absent = t.maybeAbsent?.has(k) === true;
    if (v !== undefined && !absent && t.shadowValues.length === 0) return v;
    if (v !== undefined) {
      // shadow key 可能覆盖同一字面量键；maybeAbsent 表示键可能不存在
      return joinAll([v, ...t.shadowValues, undefAbs()]) ?? undefAbs();
    }
    if (t.shadowValues.length === 0) return undefAbs();
  }
  // Bug 88：引用身份键命中——shadow 为空时精确（get(k) 只依赖键 k 的条目）；
  // shadow key（未知键，原生可能就是 k 且后写覆盖）须并入
  const ik = refIdentKeyOf(key);
  if (ik !== undefined) {
    const hit = t.identEntries.find((e) => refIdentKeyOf(e.key) === ik);
    if (hit) {
      if (t.shadowValues.length === 0) return hit.value;
      return joinAll([hit.value, ...t.shadowValues, undefAbs()]) ?? undefAbs();
    }
    if (t.shadowValues.length === 0) {
      // 精确 miss：引用键 ≠ 字面量键/其它引用键（maybeAbsent 只涉字面量键）
      return undefAbs();
    }
  }
  // 字面量 miss / 未知 key：并入 undefined（存在性）+ 全部已知值
  const known = [...t.byLit.values(), ...t.identEntries.map((e) => e.value), ...t.shadowValues];
  const joined = joinAll(known);
  if (isLitKey(k) && t.shadowValues.length === 0) {
    // 纯字面量 miss：值只能是 undefined（shadows 为空时）
    return undefAbs();
  }
  if (joined === undefined) {
    return isLitKey(k) ? undefAbs() : unknown;
  }
  return joinAbs(joined, undefAbs());
}

/** Map#has：字面量 miss 折 exact false 时，get 必须是 undefined（不可再并 value） */
export function mapHasEntry(mapAbs: Abs, key: Abs | undefined): Abs {
  const t = mapTableForRead(mapAbs);
  if (!t) return unknown;
  const k = litKeyOf(key);
  if (!isLitKey(k)) {
    // Bug 88：引用身份键命中 → 条目在场（覆盖写不改在场性）→ exact true；
    // miss 且无 shadow → 键域全特定 → exact false。any/unknown 查询键无
    // 引用身份 → 保守 partial（可能就是任一身份键）
    const ik = refIdentKeyOf(key);
    if (ik !== undefined) {
      const hit = t.identEntries.some((e) => refIdentKeyOf(e.key) === ik);
      if (hit) return boolLit(true);
      if (t.shadowValues.length === 0) return boolLit(false);
    }
    // 未知 key：有条目则可能 true/false，无条目 unknown
    return t.byLit.size > 0 || t.shadowValues.length > 0 || t.identEntries.length > 0
      ? abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial")
      : unknown;
  }
  const hit = t.byLit.has(k);
  const maybeAbsent = t.maybeAbsent?.has(k) === true;
  // shadow key / fork maybeAbsent 不能折 exact true/false
  if (t.shadowValues.length > 0 || maybeAbsent) {
    return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
  }
  return abs(
    { k: "prim", type: "boolean" },
    { op: "lit", value: hit },
    undefined,
    "exact",
  );
}

export function mapSizeAbs(mapAbs: Abs): Abs {
  const t = mapTableForRead(mapAbs);
  // shadow key / maybeAbsent 键 → 真实 size 不确定
  // Bug 88：引用身份条目计数确定（覆盖写不增长）——size 保持 exact
  if (!t || t.shadowValues.length > 0 || (t.maybeAbsent && t.maybeAbsent.size > 0)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  return abs(
    { k: "prim", type: "number" },
    { op: "lit", value: (t.byLit.size + t.identEntries.length) as never },
    undefined,
    "exact",
  );
}

export function mapValuesAbs(mapAbs: Abs): Abs[] {
  const t = mapTableForRead(mapAbs);
  if (!t) return [];
  return [...t.byLit.values(), ...t.identEntries.map((e) => e.value), ...t.shadowValues];
}

/** LitKey → key Abs（Map entry 迭代用）；非字面量 key 走 unknown */
function keyAbsFromLitKey(k: LitKey): Abs {
  if (k === null) {
    return abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
  }
  if (k === undefined) {
    return abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");
  }
  if (typeof k === "string") return abs({ k: "prim", type: "string" }, { op: "lit", value: k }, undefined, "exact");
  if (typeof k === "number") return abs({ k: "prim", type: "number" }, { op: "lit", value: k }, undefined, "exact");
  return abs({ k: "prim", type: "boolean" }, { op: "lit", value: k }, undefined, "exact");
}

/**
 * Map 迭代条目：JS `for (const [k,v] of map)` / `Array.from(map)` 产出
 * `[key, value]` 元组 Abs。字面量 key 精确；shadow 写入 key 为 unknown。
 */
export function mapEntriesAbs(mapAbs: Abs): Abs[] {
  const t = mapTableForRead(mapAbs);
  if (!t) return [];
  const entries: Abs[] = [];
  for (const [k, v] of t.byLit) {
    entries.push(
      abs(
        { k: "tuple", elements: [keyAbsFromLitKey(k), v] },
        undefined,
        undefined,
        confJoin(v.conf, "exact"),
      ),
    );
  }
  const unkKey = abs({ k: "unknown" }, undefined, undefined, "partial");
  for (const v of t.shadowValues) {
    entries.push(
      abs(
        { k: "tuple", elements: [unkKey, v] },
        undefined,
        undefined,
        "partial",
      ),
    );
  }
  // Bug 88：引用身份条目——键为该特定引用（keys()/entries 精确展开）
  for (const e of t.identEntries) {
    entries.push(
      abs(
        { k: "tuple", elements: [e.key, e.value] },
        undefined,
        undefined,
        confJoin(e.value.conf, "exact"),
      ),
    );
  }
  return entries;
}

/**
 * Bug 28：Map 键序列——ES2025 Set 方法族的 Map 实参语义：GetSetRecord
 * 迭代 `other.keys()`，条目值不参与（`set.union(map)` = 元素 ∪ map 键）。
 * 调用方以 collectionExactLen 前置门控保证无影子键（全字面键）。
 * Bug 88：引用身份键条目计入（union 并集原生含对象键；其余运算经
 * setMethodFold 的全字面量门自然保守回落）。
 */
export function mapKeysAbs(mapAbs: Abs): Abs[] {
  const t = mapTableForRead(mapAbs);
  if (!t) return [];
  const keys: Abs[] = [];
  for (const k of t.byLit.keys()) keys.push(keyAbsFromLitKey(k));
  for (const e of t.identEntries) keys.push(e.key);
  return keys;
}

/** Set#add：fork 内写 overlay；返回同一 Abs */
export function setAddEntry(setAbs: Abs, value: Abs): Abs {
  const t = setTableForWrite(setAbs);
  const lk = litKeyOf(value);
  if (isLitKey(lk) && t.elements.some((el) => sameValueZeroKey(litKeyOf(el), lk))) {
    return setAbs; // JS Set 语义：重复 add 不增长（SameValueZero）
  }
  // Bug 88：非字面量值可判身份时按 SameValueZero 去重（s.add(k); s.add(k)
  // 原生单条目）；无身份键（抽象值/域共享/单例）保持逐次入表
  const ik = identKeyOf(value);
  if (ik !== undefined && t.elements.some((el) => identKeyOf(el) === ik)) {
    return setAbs;
  }
  t.elements.push(value);
  return setAbs;
}

/** Set#delete：按字面量/身份元素移除；fork overlay 内生效。
 * 字面量删除且无残留非字面量元素 → 该臂可精确 miss；
 * 臂间分歧由 endCollectionFork 按元素数差标 maybeAbsent。
 * Bug 88：身份删除按绑定级身份匹配（s.add(x); s.delete(x) 同绑定必命中）；
 * 「无残留不确定元素」的精确 miss 判定用引用级身份——any/unknown 元素
 * 原生可能恰为被删字面量/查询引用，不得当特定值。 */
export function setDeleteEntry(setAbs: Abs, value: Abs): Abs {
  const t = setTableForWrite(setAbs);
  const lk = litKeyOf(value);
  // 残留元素中「值不可判」的：非字面量且无引用级身份（any/unknown/域共享/prim 域）
  const hasAbstract = (els: Abs[]): boolean =>
    els.some((el) => !isLitKey(litKeyOf(el)) && refIdentKeyOf(el) === undefined);
  if (isLitKey(lk)) {
    t.elements = t.elements.filter((el) => !sameValueZeroKey(litKeyOf(el), lk));
    // Bug 88：引用级身份元素是特定引用 ≠ 被删字面量——不构成「可能删掉了它」
    if (hasAbstract(t.elements)) t.maybeAbsent = true;
    else delete t.maybeAbsent;
  } else {
    const ik = identKeyOf(value);
    const rk = refIdentKeyOf(value);
    if (ik !== undefined) {
      const before = t.elements.length;
      t.elements = t.elements.filter((el) => identKeyOf(el) !== ik);
      const removed = t.elements.length < before;
      const abstractLeft = hasAbstract(t.elements);
      if (abstractLeft) t.maybeAbsent = true;
      else delete t.maybeAbsent;
      if (removed) return boolLit(true);
      // 精确 miss 仅限引用语义查询键：any/unknown 绑定键可能等值于表中
      // 字面量/引用元素（delete 结果原生可为 true），不得折 false
      if (rk !== undefined && !abstractLeft) return boolLit(false);
    } else {
      t.maybeAbsent = true;
    }
  }
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "path");
}

/** Set#clear */
export function setClearEntries(setAbs: Abs): Abs {
  const t = setTableForWrite(setAbs);
  t.elements = [];
  delete t.maybeAbsent;
  return undefAbs();
}

export function setHasEntry(setAbs: Abs, value: Abs): Abs {
  const t = setTableForRead(setAbs);
  if (!t) return unknown;
  const k = litKeyOf(value);
  if (isLitKey(k)) {
    const hit = t.elements.some((el) => sameValueZeroKey(litKeyOf(el), k));
    // 该字面 key 跨臂 membership 不一致 → 不能折 exact
    if (setAbsentKey(t, k)) {
      return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
    }
    // Bug 88：miss 时若有「值不可判」元素（any/unknown/域共享/prim 域——
    // 原生可能恰为该字面量）不得折 exact false；引用级身份元素是特定
    // 引用，恒不等字面量，不构成不确定性
    if (!hit && t.elements.some((el) => !isLitKey(litKeyOf(el)) && refIdentKeyOf(el) === undefined)) {
      return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
    }
    return abs(
      { k: "prim", type: "boolean" },
      { op: "lit", value: hit },
      undefined,
      "exact",
    );
  }
  // Bug 88：绑定级身份命中 → 该特定值在场 → exact true；引用语义查询键
  // 的 miss 在表内无非字面量「值不可判」元素（any/unknown/域共享/prim 域
  // ——它们可能恰为查询引用）时 → exact false（该特定引用 ≠ 任何字面量
  // /其它引用）。any/unknown 查询键不作精确 miss（可能等值于其它抽象
  // 元素）；fork membership 不确定（setAnyAbsent）时保守 partial。
  const ik = identKeyOf(value);
  if (ik !== undefined && !setAnyAbsent(t)) {
    if (t.elements.some((el) => identKeyOf(el) === ik)) return boolLit(true);
    if (
      refIdentKeyOf(value) !== undefined &&
      !t.elements.some((el) => !isLitKey(litKeyOf(el)) && refIdentKeyOf(el) === undefined)
    ) {
      return boolLit(false);
    }
  }
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
}

export function setSizeAbs(setAbs: Abs): Abs {
  const t = setTableForRead(setAbs);
  // 任一字面 key 不确定或整表不确定 → size 不能 exact
  if (!t || setAnyAbsent(t)) {
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
  const t = setTableForRead(setAbs);
  return t ? [...t.elements] : [];
}

/**
 * Bug 28：ES2025 Set 方法族值域折叠（union/intersection/difference/
 * symmetricDifference/isSubsetOf/isSupersetOf/isDisjointFrom）。
 * 前提：receiver 与实参（Set/Map brand）均持有确切条目表
 * （collectionExactLen 定义；无表 / maybeAbsent / shadow 不折，调用方先过
 * enforceSetMethodArg 校验面）。Map 实参语义是键域（GetSetRecord 迭代
 * other.keys()，条目值不参与——node 实测 set.union(map) = 元素 ∪ map 键）。
 * union 恒折（元素并，SameValueZero 字面量去重，抽象元素可能重复——
 * 表域口径）；其余运算与 is* 谓词仅在双方元素全字面量（SameValueZero
 * 成员判定可判）时折，否则返回 undefined（集合运算诚实 unknown / is*
 * 抽象 boolean 由调用方兜底）。
 */
export function setMethodFold(recv: Abs, method: string, arg: Abs): Abs | undefined {
  if (collectionExactLen(recv) === undefined) return undefined;
  if (!isSetAbs(arg) && !isMapAbs(arg)) return undefined;
  if (collectionExactLen(arg) === undefined) return undefined;
  const recvEls = setElementsAbs(recv);
  const argEls = isSetAbs(arg) ? setElementsAbs(arg) : mapKeysAbs(arg);
  if (method === "union") {
    return makeSetAbs(
      abs({ k: "tuple", elements: [...recvEls, ...argEls] }, undefined, undefined, "path"),
    );
  }
  // 其余运算：双方元素全字面量才可做成员判定
  const recvKeysAll = recvEls.map(litKeyOf);
  const argKeysAll = argEls.map(litKeyOf);
  if (recvKeysAll.some((k) => !isLitKey(k)) || argKeysAll.some((k) => !isLitKey(k))) {
    return undefined;
  }
  const recvKeys = recvKeysAll.filter(isLitKey);
  const argKeys = argKeysAll.filter(isLitKey);
  const hasKey = (keys: LitKey[], k: LitKey) => keys.some((b) => sameValueZeroKey(k, b));
  switch (method) {
    case "intersection":
      return makeSetAbs(
        abs(
          { k: "tuple", elements: recvEls.filter((_, i) => hasKey(argKeys, recvKeys[i]!)) },
          undefined,
          undefined,
          "path",
        ),
      );
    case "difference":
      return makeSetAbs(
        abs(
          { k: "tuple", elements: recvEls.filter((_, i) => !hasKey(argKeys, recvKeys[i]!)) },
          undefined,
          undefined,
          "path",
        ),
      );
    case "symmetricDifference":
      return makeSetAbs(
        abs(
          {
            k: "tuple",
            elements: [
              ...recvEls.filter((_, i) => !hasKey(argKeys, recvKeys[i]!)),
              ...argEls.filter((_, i) => !hasKey(recvKeys, argKeys[i]!)),
            ],
          },
          undefined,
          undefined,
          "path",
        ),
      );
    case "isSubsetOf":
      return boolLit(recvKeys.every((k) => hasKey(argKeys, k)));
    case "isSupersetOf":
      return boolLit(argKeys.every((k) => hasKey(recvKeys, k)));
    case "isDisjointFrom":
      return boolLit(!recvKeys.some((k) => hasKey(argKeys, k)));
    default:
      return undefined;
  }
}

/**
 * 确切条目数：Set 无 maybeAbsent / Map 无 shadow+maybeAbsent 时返回长度；
 * 否则 undefined（for-of 不得假装有界）。
 */
export function collectionExactLen(c: Abs): number | undefined {
  if (isSetAbs(c)) {
    const t = setTableForRead(c);
    if (!t) return undefined;
    if (t.maybeAbsent === true || (t.maybeAbsent instanceof Set && t.maybeAbsent.size > 0)) {
      return undefined;
    }
    return t.elements.length;
  }
  if (isMapAbs(c)) {
    const t = mapTableForRead(c);
    if (!t) return undefined;
    if (t.shadowValues.length > 0 || (t.maybeAbsent && t.maybeAbsent.size > 0)) {
      return undefined;
    }
    // Bug 88：引用身份条目计数确定
    return t.byLit.size + t.identEntries.length;
  }
  return undefined;
}

/** 元素联合（for-of / Array.from）；无表 → unknown。
 *  Map 语义是 entry `[k,v]` 元组联合，不是裸 value。 */
export function collectionElementJoin(c: Abs): Abs {
  const els = isSetAbs(c) ? setElementsAbs(c) : isMapAbs(c) ? mapEntriesAbs(c) : [];
  if (els.length === 0) return unknown;
  return els.reduce((a, b) => joinAbs(a, b));
}

export function clearCollectionTables(): void {
  // WeakMap 无 clear；仅测试用——新建 Abs 即新表
}
