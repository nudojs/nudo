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
