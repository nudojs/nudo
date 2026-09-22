/**
 * 调用 Abs 一等函数（absFunction impl）或 mock apply。
 * 供 B 路径 import 绑定包装：`(...args) => $call(absFn, args)`。
 *
 * 统一顺序：apply → body → relation → isRelFn（委托 applyAbsFn）。
 * 行为对齐说明（与旧 $call 的差异，均属刻意）：
 * 1. 带 body 的函数也进 call-budget（与 ast-eval 同轨；递归会 truncated 而非爆栈）
 * 2. body 抛错 → never（applyAbsFn 内恢复，不返回中间值）
 * 3. 无 impl 时 isRelFn 可走 E 路径（旧版恒 unknown）
 */

import type { Abs } from "../abs.ts";
import { never, unknown } from "../abs.ts";
import { getFnImpl } from "../abs-fn.ts";
import { compiledBodyOf } from "./body-fn.ts";
import { joinAbs } from "../objects.ts";
import { termToString } from "../term.ts";
import { instantiateReturn, isRelFn, setApplyCallbackHost } from "../hof.ts";
import { absFunction } from "../abs-fn.ts";
import type { AstEnv } from "../ast-env.ts";
import { isNudoThrow } from "./runtime.ts";
import {
  enterCall,
  exitCall,
  truncatedAbs,
} from "../call-budget.ts";

export function $call(fn: Abs, args: Abs[], thisVal?: Abs): Abs {
  // 函数 union：对每个 member 同序求值后 join
  if (fn?.shape?.k === "sum") {
    const results = fn.shape.members.map((m) => $call(m, args, thisVal));
    if (results.every((r) => r.shape.k === "unknown")) return unknown;
    return results.reduce((a, b) => joinAbs(a, b));
  }
  const impl = getFnImpl(fn);
  // 关系面（relation/isRelFn）：无 body 无 apply → 实例化返回位
  if (!impl?.body && !impl?.apply) {
    if (impl?.relation || isRelFn(fn)) return instantiateReturn(fn, args);
    return unknown;
  }
  // apply 钩子（mock withArgs / $fnVal / 桥接导出）：按实参派发
  if (impl?.apply) {
    const key = callBudgetKey("absfn", impl.fingerprint ?? `anon#${impl.params.length}`, args);
    const label = (fn.shape as { name?: string }).name ?? "anonymous";
    if (!enterCall(key, label)) return truncatedAbs();
    try {
      try {
        return impl.apply(args, thisVal);
      } catch (e) {
        if (e && typeof e === "object" && (e as { name?: string }).name === "NudoReturn") {
          return (e as { absValue: Abs }).absValue;
        }
        throw e;
      }
    } finally {
      exitCall();
    }
  }
  // body（无 apply）：编译执行；失败回落非 body 面（budget 已含编译调用点）
  const compiled = compiledBodyOf(impl);
  if (compiled) {
    try {
      return compiled(args);
    } catch (e) {
      // body 抛错 → never（不把中间值当返回值）
      if (isNudoThrow(e)) {
        return never;
      }
      throw e;
    }
  }
  return unknown;
}

/** 预算键（与 ast-eval callBudgetKey 同口径） */
function callBudgetKey(kind: string, id: string, args: Abs[]): string {
  const parts = args.map((a) => `${a.shape.k}:${a.term ? termToString(a.term) : ""}`);
  return `${kind}|${id}|${parts.join(",")}`;
}

// 注册到 hof.applyCallbackAbs（原 ast-eval 模块级副作用的 B 等价迁移）：
// Abs 回调 → $call（编译/apply/关系面）；Identifier 节点（解释面残留）→
// env.vars/env.fns 解析后 $call；inline Node 解释面已删 → unknown（fail-closed）。
setApplyCallbackHost((cb, args, env) => {
  if (cb && typeof cb === "object" && "shape" in (cb as object)) {
    return $call(cb as Abs, args);
  }
  const node = cb as { type?: string; name?: string } | null | undefined;
  if (node && node.type === "Identifier" && node.name) {
    const e = env as AstEnv | undefined;
    const bound = e?.vars?.get(node.name);
    if (bound) return $call(bound, args);
    const f = e?.fns?.get(node.name);
    if (f) {
      return $call(absFunction(f.params, { body: f.body, async: f.async, env: e }), args);
    }
    return unknown;
  }
  return unknown;
});
