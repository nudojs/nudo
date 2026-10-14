/**
 * 对象不变性侧表（freeze/seal/preventExtensions/defineProperty）。
 * WeakMap 侧表：Abs 不可变，写路径读侧表复现 sloppy 静默失败。
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
 *  PrivateName 标记，公共 {"#x":1} 不受影响。 */
export function enumOwnKeys(o: Abs, slots: Record<string, unknown>): string[] {
  const flags = getPropFlags(o);
  return Object.keys(slots).filter(
    (k) =>
      flags?.get(k)?.enumerable !== false &&
      (slots[k] as { internal?: boolean } | undefined)?.internal !== true,
  );
}

/** 该键是否出现在枚举视图（无 flags 表 = 默认 enumerable） */
export function isEnumerableView(o: Abs, key: string): boolean {
  return getPropFlags(o)?.get(key)?.enumerable !== false;
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
