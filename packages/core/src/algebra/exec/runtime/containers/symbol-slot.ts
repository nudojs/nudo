/**
 * 族 57 · 外-02 ①：符号键的**槽寻址键**（普通对象面）。
 *
 * 引擎内部的槽表用**字符串**键寻址（Bug 73 的 "@@X" 投影是符号键的既有
 * 表示）。但 `propertyKeyOf` 对 symbol 返 undefined（symbol 不是字符串
 * PropertyKey）⇒ 普通对象的符号键读写此前**没有槽寻址通道**：写被丢弃
 * （`$idxSet` 落抽象键 ⇒ 对象标 open）、读落抽象下标投影（`$idx` 折
 * unknown）。本模块给出符号键 → 内部槽键的**唯一**映射：
 *
 * - **宿主 well-known 符号**（Symbol.iterator 等）→ "@@X"——与转译侧静态
 *   投影同源（`runtime/symbol-key.ts` 的 `slotKeyOfSymbolAbs`）；
 * - **用户符号**（Symbol("x") / Symbol.for("x")）→ "@@sym#N"——N 取符号的
 *   身份 id（`symbolIdOf`，见下）；**不按 description**——description 可撞：
 *   Symbol("Symbol.iterator") 的 description 恰是 "Symbol.iterator"；
 * - **无身份**的符号 → undefined（键不可判，不得凭空捏）。
 *
 * 不变量：
 * - 符号槽带 `symbolKey` 标记（Bug 73）⇒ JSON / 字符串枚举面不可见；
 *   字面量串键 "@@sym#1" 与真符号键**不是**同一个 PropertyKey（既有
 *   "@@X" 同款约定）。
 * - 只服务**普通对象**面；Proxy 面按规范把**真 symbol** 传给陷阱
 *   （Bug 149），不走本通道。
 */
import type { Abs } from "../../../abs.ts";
import { isSymbolAbs, symbolIdOf } from "../../../symbol-id.ts";
import { slotKeyOfSymbolAbs } from "../symbol-key.ts";

/**
 * 符号 Abs → 内部槽键（普通对象面的符号槽寻址用）。
 *
 * - **宿主 well-known 符号**（Symbol.iterator 等）→ "@@X"——按**宿主身份**
 *   反查（同一宿主符号跨读恒同槽键；不同 Abs 也同键）。
 * - **用户符号**（Symbol("x") / Symbol.for("x")）→ "@@sym#N"——N 取符号的
 *   **身份 id**（symbolIdOf）：`Symbol("x")` 每次调用是**新**符号（原生同款）
 *   ⇒ 每次新 id；`Symbol.for("x")` 是**驻留**符号（同一 Abs ⇒ 同一 id ⇒
 *   同一槽键，与原生「同注册表键同符号」一致）。
 * - 非符号 / 无身份 id 的符号 → undefined（键不可判，不得凭空捏）。
 */
export function symbolSlotKeyOf(a: Abs | undefined): string | undefined {
  // 非 Abs 实参（部分调用点传**裸 JS 值**——如 $del 的键：可选链 delete 发射
  // `$del(obj, "a")` 的裸字符串）→ 键不可判 ⇒ undefined（**不得**取 .shape：
  // 宿主 TypeError ⇒ 整模块 fail-closed）。
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return undefined;
  if (!isSymbolAbs(a)) return undefined;
  const sym = a as Abs;
  const wellKnown = slotKeyOfSymbolAbs(sym);
  if (wellKnown !== undefined) return wellKnown;
  const id = symbolIdOf(sym);
  return id === undefined ? undefined : `@@sym#${id}`;
}
