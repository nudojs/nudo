/**
 * 类方法桥的**实例构造**（值域 `generalize.ts` 与证据域
 * `check-may-throw.ts` 共用）。
 *
 * 类方法签名/throws 推断要先造实例再 `$invoke`，而构造实参一律补 any ⇒
 * 构造器体内的强制转换必产 TypeError。**构造器的行为不得污染方法体**：
 *
 * - 值域（Bug 1093）：构造器抛 ⇒ 异常逃出 ⇒ 方法签名退 unknown + 误导的
 *   info 级 `nudo:opaque-result`（把「构造器必抛」谎报成「推断失败」）。
 * - 证据域（Bug 1070）：构造器软效果/硬抛被归因给方法 ⇒ error 级
 *   `nudo:entry-may-throw` 假红。
 *
 * 口径：构造器**仍要跑**（方法体读 `this.<字段>` 需要构造器写入的槽值；
 * 跳过构造器会把字段读退成 unknown ⇒ 方法体自己的证据也丢），但证据域在
 * **独立 may-throw 会话**里跑（`isolate` 参数 = `runWithMayThrowSession`，
 * 值域不传）。硬抛 ⇒ 退到**裸实例**（跳过构造器）继续求值方法体 ⇒ 方法体
 * 自身的推断/证据照常产出（闸门不整体关掉）。
 */

import type { Abs } from "./abs.ts";
import { abs } from "./abs.ts";
import { $new } from "./exec/class.ts";

/**
 * 裸实例（跳过构造器）：brand 名取**类值**的 brand 名（类值即 brand ⇒
 * 导出槽兜底 / `export default class` 同口径）。
 *
 * **内层是 unknown，不是空 obj**（Bug 1096）：构造器抛 ⇒ 构造器写过的字段
 * **不可知**（不是「确定不存在」）⇒ 空 obj 会把 `this.v` 折成**确定的
 * undefined**（自信的错值：真实是构造器写入的值）⇒ 连带 `this.v.toFixed()`
 * 在**虚构实例**上抛 TypeError ⇒ 方法签名被折成 `never`（谎称「该方法必
 * 抛、恒返回 never」）+ error 级 `nudo:entry-may-throw`（假红，直接卡 CI）。
 * 内层 unknown ⇒ 字段读 = unknown（不可知）⇒ 成员调用不产 may-throw ⇒
 * 签名不折 never（兜底实例的 TypeError 不得决定方法签名）。
 */
export function bareInstanceOf(clsAbs: Abs, clsName: string): Abs {
  const name =
    clsAbs.shape.k === "brand" && clsAbs.shape.name.length > 0
      ? clsAbs.shape.name
      : clsName;
  return abs(
    {
      k: "brand",
      name,
      shape: abs({ k: "unknown" }, undefined, undefined, "partial"),
    },
    undefined,
    undefined,
    "path",
  );
}

/**
 * 构造实例；构造器抛 ⇒ 裸实例兜底（方法体仍被求值）。
 *
 * @param isolate 证据域传 `runWithMayThrowSession`（构造器的软效果/帧栈不进
 *   外层收集域）；值域不传（无会话语义）。
 */
export function instanceForMethodBridge(
  clsAbs: Abs,
  clsName: string,
  ctorArgs: Abs[],
  isolate?: <T>(body: () => T) => T,
): Abs {
  try {
    return isolate ? isolate(() => $new(clsAbs, ctorArgs)) : $new(clsAbs, ctorArgs);
  } catch {
    return bareInstanceOf(clsAbs, clsName);
  }
}
