/**
 * 杂项小构造器：动态 Function / WeakRef / FinalizationRegistry。
 *
 * Invariants:
 * - new Function(p0,…,body) 实参逐个 ToString（Symbol 字面量定抛
 *   TypeError；抽象 → may）；动态体不静态求值（同 eval 口径）→ path 级
 *   抽象 fn，调用面保守 unknown。
 * - WeakRef target / FCR register·unregister token 过 CanBeHeldWeakly
 *  （error-family enforceCanBeHeldWeakly 单一分类：prim/nullish 字面量与
 *   缺省 → 确定 TypeError；symbol/对象形态合法；抽象 → may）。
 * - FCR cleanupCallback IsCallable 前置校验无 undefinedOk 豁免（缺省同抛）。
 * - 合法 → 空 brand（弱持有条目表/回调身份不建模，与 WeakMap/WeakSet
 *   makeWeakCollectionAbs 同口径）。
 */

import type { Abs } from "../../abs.ts";
import { abs, unknown } from "../../abs.ts";
import { objOf } from "../../objects.ts";
import { validateCallableArg } from "../../hof.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { isSymbolAbs } from "../symbol.ts";
import { mayCoerceThrowOperand } from "../shared.ts";

import { enforceCanBeHeldWeakly } from "./error-family.ts";

/**
 * Bug 29（强转三连）：`new Function(p0, …, body)` / `Function(…)` 动态代码
 * 构造器。实参**逐个** ToString（ES FunctionConstructor：每个参数
 * ToString 后拼接 body）——Symbol 字面量定抛（node 实测
 * `new Function("a", Symbol())` 抛 "Cannot convert a Symbol value
 * to a string"）；抽象 any/obj/… → may。动态体不静态求值（同 eval
 * 口径）：返回 path 级抽象 fn，调用面保守 unknown。$new 宿主分支与
 * evalBuiltinNew（Abs 面）共用本 builder。
 */
export function makeDynamicFunctionAbs(args: Abs[]): Abs {
  for (const a of args) {
    if (a && isSymbolAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (a && a.term?.op !== "lit" && mayCoerceThrowOperand(a)) {
      recordMayThrow({
        kind: "TypeError",
        cause: "new Function(args) ToString may throw (Symbol)",
      });
    }
  }
  return abs({ k: "fn", params: [] }, undefined, undefined, "path");
}

/**
 * Bug 25：`new WeakRef(target)` —— target 过 CanBeHeldWeakly（与
 * FinalizationRegistry.register 同口径，enforceCanBeHeldWeakly 单一分类）：
 * prim/nullish 字面量与缺省 → 确定 TypeError（node 实测 "WeakRef:
 * invalid target"）；symbol/对象形态合法；抽象 → recordMayThrow。
 * 合法 → 空 brand（与原兜底同款；deref 值域走 BUILTIN_BRAND_METHODS 现状，
 * 弱目标身份不在分析域）。$new 宿主分支与 evalBuiltinNew（Abs 面）共用。
 */
export function makeWeakRefAbs(target: Abs | undefined): Abs {
  enforceCanBeHeldWeakly(target, "new WeakRef(target) target");
  return abs({ k: "brand", name: "WeakRef", shape: objOf({}) }, undefined, undefined, "path");
}

/**
 * Bug 25：`new FinalizationRegistry(cleanupCallback)` —— IsCallable 前置
 * 校验（validateCallableArg，无 undefinedOk 豁免——缺省/undefined 原生同抛
 * "cleanup must be callable"）：非 callable（prim/nullish 字面量/闭 obj/
 * 缺省）→ 确定 TypeError；any/open obj/含不可调用臂 union → may。
 * 合法 → 空 brand（实例方法面 register/unregister Bug 43 已落）。
 */
export function makeFinalizationRegistryAbs(cb: Abs | undefined): Abs {
  validateCallableArg(cb, "new FinalizationRegistry(cleanupCallback) callback may not be callable");
  return abs(
    { k: "brand", name: "FinalizationRegistry", shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
}
