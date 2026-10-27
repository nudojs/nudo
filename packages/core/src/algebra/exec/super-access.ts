/**
 * 派生类构造器的「super() 已调 / 构造中」状态侧表（模块级 WeakMap）。
 *
 * 原生语义（ES2023 15.7.1 / 15.7.6）：
 * - 派生类构造器**必须**在访问 `this` / 返回前调用一次 `super()`；
 *   一次都不调用 ⇒ ReferenceError（"Must call super constructor in derived
 *   class before accessing 'this' or returning from derived constructor"）。
 * - 第二次调用 `super()` ⇒ ReferenceError（"Super constructor may only be
 *   called once"）。
 *
 * 状态键 = 实例 Abs 身份；值 = **已调过 super 的子类名集合**——同一实例
 * 沿继承链逐层传递（`class D extends B extends A`：B 层的 super() 不得
 *   被误判成 D 层的「已调」）。`$super` 每次返回**新** brand Abs（内层 obj
 *   共享），故标记同时落在入参与出参上。
 *
 * 选型理由（AGENT-CONTEXT §4 允许「Shape 可选字段」或「模块级 WeakMap」）：
 * 选**模块级 WeakMap**——该状态是「一次构造过程」的瞬时事实，不是值的
 * 形状；写进 Shape 会把构造期状态混进类型系统（brand 的 leq / 指纹 /
 *   展示面都会带上瞬时状态）。WeakMap 随实例 Abs 回收，无泄漏。
 *
 * BUG-173：另有「构造中（尚未调 super）」侧表——`constructClass` 在跑派生
 * 类构造器体前登记实例，`$get` / `$set` / `$idx` / `$idxSet` / `$invoke`
 * 的 `this` 访问路径据此硬抛 ReferenceError（与原生 GetThisBinding 一致）。
 * 本模块是叶子（不 import exec 运行时），避免 declare ↔ containers 的环。
 */

import type { Abs } from "../abs.ts";
import { abs, str, strLit } from "../abs.ts";
import { setPropFlags } from "../builtins/invariants.ts";
import { NudoThrow } from "./nudo-throw.ts";

const superCalledMarks = new WeakMap<object, Set<string>>();

/** 标记「本实例在 childName 这一层已调用过 super()」 */
export function markSuperCalled(inst: Abs, childName: string): void {
  if (!inst || typeof inst !== "object") return;
  let s = superCalledMarks.get(inst as object);
  if (!s) {
    s = new Set<string>();
    superCalledMarks.set(inst as object, s);
  }
  s.add(childName);
}

/** 读「本实例在 childName 这一层是否已调用过 super()」 */
export function superCalledFor(inst: Abs, childName: string): boolean {
  if (!inst || typeof inst !== "object") return false;
  return superCalledMarks.get(inst as object)?.has(childName) ?? false;
}

/** 实例 → 正在执行构造器体、尚未调用 super() 的类名集合 */
const pendingSuperMarks = new WeakMap<object, Set<string>>();

/** 构造器体入口登记（派生类）：`this` 访问在此之前定抛 ReferenceError。 */
export function notePendingSuper(inst: Abs, className: string): void {
  if (!inst || typeof inst !== "object") return;
  let s = pendingSuperMarks.get(inst as object);
  if (!s) {
    s = new Set<string>();
    pendingSuperMarks.set(inst as object, s);
  }
  s.add(className);
}

/** 构造器体出口清除本层登记（异常出口同样清除——由 finally 保证）。 */
export function clearPendingSuper(inst: Abs, className: string): void {
  if (!inst || typeof inst !== "object") return;
  const s = pendingSuperMarks.get(inst as object);
  if (!s) return;
  s.delete(className);
  if (s.size === 0) pendingSuperMarks.delete(inst as object);
}

/** BUG-173：ReferenceError 载荷（与 may-throw.ts 的 errorTypeAbs 同形；
 *  本模块不可反向 import may-throw——它会 import 本模块所在的 class 面）。 */
function referenceErrorAbs(): Abs {
  const inner = abs(
    {
      k: "obj",
      slots: {
        stack: { value: str() },
        name: { value: strLit("ReferenceError"), inherited: true },
        message: { value: str() },
      },
    },
    undefined,
    undefined,
    "exact",
  );
  setPropFlags(inner, "stack", { enumerable: false });
  setPropFlags(inner, "message", { enumerable: false });
  setPropFlags(inner, "name", { enumerable: false });
  return abs(
    { k: "brand", name: "ReferenceError", shape: inner },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * BUG-173：`this` 访问门（派生构造器体，super() 之前访问 ⇒ 原生定抛）。
 *
 * 只在实例有「构造中」登记且该层尚未 `markSuperCalled` 时抛：
 * - `super()` 返回**同一** Abs 身份（applyInstanceFields 后的既有实例）⇒
 *   标记落在同一对象上 ⇒ 此门放行；
 * - `super()` 返回**新** brand ⇒ 构造器体内的 `__this` 已重绑到新对象，
 *   新对象没有 pending 登记 ⇒ 放行。
 */
export function assertThisAccessible(inst: Abs): void {
  if (!inst || typeof inst !== "object") return;
  const pending = pendingSuperMarks.get(inst as object);
  if (!pending) return;
  for (const className of pending) {
    if (!superCalledFor(inst, className)) throw new NudoThrow(referenceErrorAbs());
  }
}
