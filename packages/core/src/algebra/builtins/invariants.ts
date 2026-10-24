/**
 * 对象不变性侧表（freeze/seal/preventExtensions/defineProperty）。
 * WeakMap 侧表：Abs 不可变，写路径读侧表复现 sloppy 静默失败。
 *
 * Invariants（Bug 295）：
 * - 枚举视图分**两套口径**，不得混用：
 *   - `enumOwnKeys` = **CopyDataProperties 视图**（自有可枚举键，**含**
 *     symbol 投影槽）——原生 spread `{...o}` / **对象 rest** / Object.assign
 *     复制自有可枚举 **symbol 键**（node v26 实测：rest 也拷——`rest[
 *     Symbol.toStringTag] === 2`；`{...{[Symbol.iterator](){}}}` 仍可迭代 ⇒
 *     引擎的 @@iterator 协议槽正靠这条拷贝链落地）。
 *   - `enumOwnStringKeys` = **字符串键视图**（**剔除** symbol 投影槽）——
 *     原生 for-in / Object.keys|values|entries / getOwnPropertyNames /
 *     JSON.stringify 只枚举字符串键。
 *     **注意**（Bug 1075）：`Object.getOwnPropertyDescriptors` **不在**此列——
 *     原生 gOPDs 走 [[OwnPropertyKeys]]（**含** symbol 键：结果对象带真
 *     symbol 键，`Object.getOwnPropertySymbols(gOPDs(o))` 看得到）。
 * - 报告建议「给 enumOwnKeys 补 symbolKey 过滤」与原生 oracle 冲突：它会
 *   把 symbol 键从 spread/assign/rest 的拷贝链里剔掉 ⇒ 折坏 @@iterator 协议
 *   槽（core 既有 8 处回归）。故按 oracle 拆两套视图，调用点分流。
 */
import type { Abs } from "../abs.ts";

export type ExtState = "nonext" | "sealed" | "frozen";
export type PropFlags = {
  writable?: boolean;
  enumerable?: boolean;
  configurable?: boolean;
};

const extStateTable = new WeakMap<Abs, ExtState>();
const propFlagsTable = new WeakMap<Abs, Map<string, PropFlags>>();

export function markExtState(o: Abs, s: ExtState): Abs {
  extStateTable.set(o, s);
  return o;
}

export function extStateOf(o: Abs): ExtState | undefined {
  return extStateTable.get(o);
}

export function getPropFlags(o: Abs): Map<string, PropFlags> | undefined {
  return propFlagsTable.get(o);
}

/** 枚举视图键（for-in / Object.keys|values|entries / Object.assign）：
 *  剔除 defineProperty 记下的 enumerable:false 自有键与 internal 私有槽
 *  （Bug 84：私有字段是内部槽，枚举面不可见；$in/$get 不走此视图）。
 *  注："#" 键空间与公共字符串键共存——`"#x" in obj` 无法区分私有 in 与
 *  字符串 in（Bug 78 混淆键设计权衡），internal 标志只来自 transpile 期
 *  PrivateName 标记，公共 {"#x":1} 不受影响。
 *
 *  **含 symbol 投影槽**（Slot.symbolKey，Bug 73/117）——本视图是
 *  CopyDataProperties 视图（原生 spread / 对象 rest / Object.assign 复制
 *  可枚举 symbol 键）。只枚举字符串键的调用点（for-in / Object.keys 家族）
 *  须改用 `enumOwnStringKeys`。 */
export function enumOwnKeys(o: Abs, slots: Record<string, unknown>): string[] {
  const flags = getPropFlags(o);
  return Object.keys(slots).filter(
    (k) =>
      !isNonEnumerable(o, k, flags) &&
      (slots[k] as { internal?: boolean } | undefined)?.internal !== true,
  );
}

/**
 * 枚举视图的**字符串键**视图（Bug 295）：在 `enumOwnKeys` 口径上再剔除
 * **symbol 投影槽**（Slot.symbolKey）——原生 for-in / Object.keys|values|
 * entries / getOwnPropertyNames / JSON.stringify 只枚举**字符串**键。
 *
 * **不含** `Object.getOwnPropertyDescriptors`（Bug 1075）：原生 gOPDs 走
 * [[OwnPropertyKeys]]——**含** symbol 键（结果对象带真 symbol 键）。
 *
 * 与 `enumOwnKeys`（CopyDataProperties 视图，含 symbol 键）的分工见文件头
 * 不变量：把 symbol 键从 spread/assign/**对象 rest** 的拷贝链剔掉会折坏
 * @@iterator 协议槽（原生 `{...{[Symbol.iterator](){}}}` 仍可迭代；原生对象
 * rest 也拷 symbol 键——node v26 实测）。
 *
 * ⚠️ 只应切**枚举面**的调用点（for-in / keys 家族 / gOPD）；**不要**切
 * spread / 对象 rest / assign 的拷贝链（那些是 CopyDataProperties 视图）。
 */
export function enumOwnStringKeys(o: Abs, slots: Record<string, unknown>): string[] {
  const flags = getPropFlags(o);
  return Object.keys(slots).filter(
    (k) =>
      !isNonEnumerable(o, k, flags) &&
      (slots[k] as { internal?: boolean } | undefined)?.internal !== true &&
      (slots[k] as { symbolKey?: boolean } | undefined)?.symbolKey !== true,
  );
}

/**
 * 键是否被标为**不可枚举**。
 *
 * flags 表存在**两套载体**约定（必须并查，否则漏判）：
 * - brand 的**内层 obj**（boxed.ts / error-family.ts / binary.ts / promise.ts
 *   等：`setPropFlags(inner, …)`）——枚举面查的是内层 obj 的槽；
 * - brand **自身**（objectProtoBrand()：`setPropFlags(a, …)`）——枚举面查的
 *   是 brand 的槽。
 * 原型对象的 `constructor` 槽（原生 enumerable:false）正是走后者 ⇒ 只查
 * 一侧 ⇒ for-in 把 `constructor` 当可枚举键发布（wrong-exact）。
 */
function isNonEnumerable(
  o: Abs,
  key: string,
  flags: Map<string, PropFlags> | undefined,
): boolean {
  if (flags?.get(key)?.enumerable === false) return true;
  if (o.shape.k === "brand") {
    const inner = o.shape.shape;
    if (inner.shape.k === "obj") {
      const innerFlags = getPropFlags(inner);
      if (innerFlags?.get(key)?.enumerable === false) return true;
    }
  }
  return false;
}

/** 该键是否出现在枚举视图（无 flags 表 = 默认 enumerable） */
export function isEnumerableView(o: Abs, key: string): boolean {
  return !isNonEnumerable(o, key, getPropFlags(o));
}

export function setPropFlags(o: Abs, key: string, f: PropFlags): void {
  let m = propFlagsTable.get(o);
  if (!m) {
    m = new Map();
    propFlagsTable.set(o, m);
  }
  m.set(key, f);
}

/** 写路径产生新副本时迁移不变性侧表（同 migrateAccessors 模式）。
 *  propFlags 深拷贝：fork/switch 的 $copy 副本不得与源共享可变 Map
 *  （一臂 defineProperty 不得污染另一臂）。 */
export function migrateInvariants(from: Abs, to: Abs): void {
  if (to === from) return;
  const s = extStateTable.get(from);
  if (s !== undefined) extStateTable.set(to, s);
  const f = propFlagsTable.get(from);
  if (f) propFlagsTable.set(to, new Map(f));
}
