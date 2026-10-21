/**
 * 对象字面量访问器（get/set）侧表 —— 叶子模块。
 * 下沉原因：objects.ts 的 joinObjects 需感知访问器（join 不迁移侧表会丢
 * getter 读域），而 members.ts 依赖 objects.ts；表放无运行时依赖的叶子上
 * 才能被两层共用而不成环。in / instanceof / delete 路由仍在 members.ts。
 *
 * 不变量：
 * - 访问器**不住在 shape 槽里**：transpile 只落一个 `$lit(void 0)` 占位槽
 *   （保键存在性：'x' in o / keys / assign 拷贝目标），真 getter 住本侧表；
 * - 读通道（$get/$set）先查侧表再回落槽值 ⇒ `o.ab` 读得对；
 * - **投影通道**（formatShape / denoteGuard / absToConstraint / 契约证明）
 *   必须先经 accessorReadDomain 取读域，否则把占位槽渲染成 exact
 *   `undefined`——一个自信的错值（比真值更窄且自相矛盾，Bug 191）。
 */
import { unknown, type Abs } from "./abs.ts";

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

/**
 * 访问器键的读域（**投影面统一读法**，Bug 191）。
 *
 * 键有 getter → 以对象为接收者求值读域（与 $get 同口径：getter 闭包的
 * `this` 就是该对象）；getter 抛（读域不可静态刻画）→ unknown（sound 超
 * 近似，**不得**回落 definite undefined——那正是本函数要消灭的假精确）；
 * 无 getter（数据槽 / 仅 setter）→ undefined，调用方用槽值（仅 setter 的
 * 原生读值恒 undefined，占位槽本就正确）。
 *
 * brand（类实例）取内层 obj 身份：类访问器在 class 注册表，不在本侧表。
 */
export function accessorReadDomain(o: Abs, key: string): Abs | undefined {
  const target = o.shape.k === "brand" ? o.shape.shape : o;
  const acc = lookupObjAccessor(target, key);
  if (!acc?.get) return undefined;
  try {
    return acc.get(target);
  } catch {
    return unknown;
  }
}
