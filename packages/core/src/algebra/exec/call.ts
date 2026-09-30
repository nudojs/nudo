/**
 * 调用 Abs 一等函数（absFunction impl）或 mock apply。
 * 供 求值引擎 import 绑定包装：`(...args) => $call(absFn, args)`。
 *
 * 统一顺序：apply → body → relation → isRelFn（委托 applyAbsFn）。
 * 行为对齐说明（与旧 $call 的差异，均属刻意）：
 * 1. 带 body 的函数也进 call-budget（递归会 truncated 而非爆栈）
 * 2. body 抛错与 apply 同径 rethrow（不吞成 never 返回，调用边界决定吸收）
 * 3. 无 impl 时 isRelFn 可走 E 路径（旧版恒 unknown）
 */

import type { Abs } from "../abs.ts";
import { never as neverAbs, unknown } from "../abs.ts";
import {
  getFnImpl,
  absFunction,
  pureFnNameOf,
  isAbsApplyResult,
  makeAbsApplyResult,
  type AbsApplyResult,
} from "../abs-fn.ts";
import { compiledBodyOf } from "./body-fn.ts";
import { joinAbs } from "../objects.ts";
import { instantiateReturn, isRelFn, setApplyCallbackHost } from "../hof.ts";
import type { AstEnv } from "../ast-env.ts";
import { NudoThrow } from "./nudo-throw.ts";
import { pushThrowExit, peekThrowExitsSince, throwExitsMark } from "./runtime/state.ts";
import {
  callBudgetKey,
  enterCall,
  exitCall,
  truncatedAbs,
  stableCallId,
} from "../call-budget.ts";
import { BoundedLruMap } from "../lru-map.ts";

/** pure memo 内层 Map 上界（防 LSP 长会话无界膨胀；与 session-cache-limits 口径对齐） */
const PURE_MEMO_MAX = 256;

/** @nudo:pure 调用结果缓存（fn 对象身份 → args key → {abs, throws}） */
let pureMemo = new WeakMap<object, BoundedLruMap<AbsApplyResult>>();

/** 清空 pure memo（宿主入口 / 会话缓存失效） */
export function clearPureMemo(): void {
  pureMemo = new WeakMap();
}

function pureMemoKey(args: Abs[]): string {
  return callBudgetKey("pure", "", args);
}

/**
 * apply 返回的 throws 面 → 调用方控制流通道（H1 单点路由）。
 * always-throw（abs=never）→ NudoThrow，由调用边界收成 throws；
 * may-throw → pushThrowExit 记入调用方 throwExits（try/catch 可吸收）。
 */
export function routeApplyThrows(r: Abs, throws: Abs | undefined): Abs {
  if (throws && throws.shape.k !== "never") {
    if (r.shape.k === "never") throw new NudoThrow(throws);
    pushThrowExit(throws);
  }
  return r;
}

function normalizeApplyReturn(raw: Abs | AbsApplyResult): AbsApplyResult {
  return isAbsApplyResult(raw) ? raw : makeAbsApplyResult(raw, neverAbs);
}

/** 把 mark 之后的 throwExits 合成 throws 面（pure memo 捕获） */
function joinThrowsSince(mark: number): Abs {
  const items = peekThrowExitsSince(mark);
  if (items.length === 0) return neverAbs;
  if (items.length === 1) return items[0]!;
  return items.reduce((a, b) => joinAbs(a, b));
}

export function $call(fn: Abs, args: Abs[], thisVal?: Abs): Abs {
  // 函数 union：对每个 member 同序求值后 join
  if (fn?.shape?.k === "sum") {
    const results = fn.shape.members.map((m) => $call(m, args, thisVal));
    if (results.every((r) => r.shape.k === "unknown")) return unknown;
    return results.reduce((a, b) => joinAbs(a, b));
  }
  // @nudo:pure：同实参直接命中缓存（无副作用契约）。缓存 {abs, throws} 双面——
  // 只缓存 abs 会在命中时丢掉 throws 通道（may-throw 假「不抛」）。
  const pureName = pureFnNameOf(fn);
  const fnObj = fn && typeof fn === "object" ? (fn as object) : undefined;
  const pk = pureName && fnObj ? pureMemoKey(args) : undefined;
  if (fnObj && pk !== undefined) {
    const hit = pureMemo.get(fnObj)?.get(pk);
    if (hit !== undefined) return routeApplyThrows(hit.abs, hit.throws);
  }
  const impl = getFnImpl(fn);
  // 关系面（relation/isRelFn）：无 body 无 apply → 实例化返回位
  if (!impl?.body && !impl?.apply) {
    if (impl?.relation || isRelFn(fn)) return instantiateReturn(fn, args);
    return unknown;
  }
  // apply 钩子（mock withArgs / $fnVal / 桥接导出）：按实参派发。
  // 预算键用 fn 对象身份（anon#N 会把不同同元函数误判 cycle）。
  if (impl?.apply) {
    const key = callBudgetKey("absfn", impl.fingerprint ?? stableCallId(fn as object), args);
    const label = (fn.shape as { name?: string }).name ?? "anonymous";
    if (!enterCall(key, label)) return truncatedAbs();
    try {
      try {
        const full = normalizeApplyReturn(impl.apply(args, thisVal));
        if (fnObj && pk !== undefined) {
          let m = pureMemo.get(fnObj);
          if (!m) {
            m = new BoundedLruMap<AbsApplyResult>(PURE_MEMO_MAX);
            pureMemo.set(fnObj, m);
          }
          m.set(pk, full);
        }
        // H1：throws 面经返回值通道统一路由（不再由各桥自行 re-throw / pushThrowExit）
        return routeApplyThrows(full.abs, full.throws);
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
  // body（无 apply）：编译执行；失败回落非 body 面。编译路径与 apply 同口径
  // 进预算（$invoke→$call 递归、回调 $call 递归不得裸奔栈溢出）。
  const compiled = compiledBodyOf(impl);
  if (compiled) {
    const key = callBudgetKey("absbody", impl.fingerprint ?? stableCallId(fn as object), args);
    const label = (fn.shape as { name?: string }).name ?? "anonymous";
    if (!enterCall(key, label)) return truncatedAbs();
    // body 抛错与 apply 路径对齐：NudoThrow 原样 rethrow，由调用边界
    // （callAtFunctionBoundary / callTranspiledExportFull / 用户 try/catch）
    // 决定吸收。此前吞成 pushThrowExit+return never，调用点 record 落成
    // never+never 被 isLeakedCallRecord 判「泄漏」丢弃，抛出 case 从 call@ 消失。
    try {
      // body may-throw 走 pushThrowExit 侧信道（runForkArm catch NudoThrow →
      // pushThrowExit）。缓存前捕获本帧新增 throws 面——命中时 routeApplyThrows
      // 重放（只缓存 abs 会在命中时假「不抛」）。
      const throwMark = throwExitsMark();
      const r = compiled(args);
      if (fnObj && pk !== undefined) {
        let m = pureMemo.get(fnObj);
        if (!m) {
          m = new BoundedLruMap<AbsApplyResult>(PURE_MEMO_MAX);
          pureMemo.set(fnObj, m);
        }
        // always-throw 在异常前不缓存；may-throw 捕获 throws 面入缓存。
        m.set(pk, makeAbsApplyResult(r, joinThrowsSince(throwMark)));
      }
      return r;
    } finally {
      exitCall();
    }
  }
  return unknown;
}

// 注册到 hof.applyCallbackAbs（数组回调解释宿主）：
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
