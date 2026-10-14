/**
 * 对象字面量访问器（get/set）侧表 —— 叶子模块。
 * 下沉原因：objects.ts 的 joinObjects 需感知访问器（join 不迁移侧表会丢
 * getter 读域），而 members.ts 依赖 objects.ts；表放无运行时依赖的叶子上
 * 才能被两层共用而不成环。in / instanceof / delete 路由仍在 members.ts。
 */
import type { Abs } from "./abs.ts";

/** 对象字面量访问器侧表（Abs 不可存裸 JS 闭包；键为对象 Abs 身份） */
export const accessorTable = new WeakMap<
  object,
  Map<string, { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs }>
>();

/** 注册对象字面量访问器（transpile 调用；返回原 obj 以便链式包裹） */
export function $objAccessor(
  o: Abs,
  key: string,
  get: ((t: Abs) => Abs) | null,
  set: ((t: Abs, v: Abs) => Abs) | null,
): Abs {
  if (!get && !set) return o;
  let m = accessorTable.get(o);
  if (!m) {
    m = new Map();
    accessorTable.set(o, m);
  }
  const def = m.get(key) ?? {};
  if (get) def.get = get;
  if (set) def.set = set;
  m.set(key, def);
  return o;
}

/** 对象字面量访问器查询（供 $get/$set/$spread/Object.assign 共用） */
export function lookupObjAccessor(
  o: Abs,
  key: string,
): { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs } | undefined {
  return accessorTable.get(o)?.get(key);
}

/** 不可变更新产生新 Abs 时迁移侧表；omitKey=delete 目标键（对象字面量自有访问器随键删除） */
export function migrateAccessors(from: Abs, to: Abs, omitKey?: string): void {
  if (to === from) return;
  const m = accessorTable.get(from);
  if (!m) return;
  if (omitKey === undefined) {
    accessorTable.set(to, m);
    return;
  }
  const copy = new Map(m);
  copy.delete(omitKey);
  if (copy.size === 0) accessorTable.delete(to);
  else accessorTable.set(to, copy);
}
