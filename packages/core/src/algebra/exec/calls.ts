/**
 * 求值引擎调用点记录：transpile 把 `f(args)` 改成 $callNamed，
 * 分析时可收集 call@ 所需的 AbsCallRecord。
 * 成员缺失诊断见 member-diag.ts（共用，避免循环依赖）。
 */

import type { Abs } from "../abs.ts";
import { abs, unknown } from "../abs.ts";
import { evalGlobalFn, hostBuiltinCtorName } from "../builtins.ts";
import { $call } from "./call.ts";
import { callAtFunctionBoundary, $copy } from "./runtime.ts";
import { throwPayloadOf } from "./may-throw.ts";
import { pureFnNameOf } from "../abs-fn.ts";
import { noteAbsTruncation, callBudgetKey, resetEvalForkBudget, noteHostEffectBlocked } from "../call-budget.ts";
import {
  tagAbsOrigin,
  pushCallLoc,
  popCallLoc,
} from "./member-diag.ts";

export type EvalCallRecord = {
  fnName: string;
  args: Abs[];
  result: Abs;
  callLoc?: { line: number; column: number };
  threw?: boolean;
};

/** @nudo:pure 宿主调用结果缓存（fn 对象身份 → args key → result） */
const pureCallMemo = new WeakMap<object, Map<string, Abs>>();

let evalCallCollector: ((r: EvalCallRecord) => void) | null = null;

/** B 赋值记录（与 ast-records.ts AbsAssignRecord 同形；structuralAssignIssues 消费） */
export type EvalAbsAssignRecord = {
  name: string;
  prev: Abs | undefined;
  next: Abs;
  line?: number;
  column?: number;
  conditional?: boolean;
};

let evalAssignCollector: ((r: EvalAbsAssignRecord) => void) | null = null;

/** 返回先前 collector，便于嵌套调用 save/restore（禁止 finally 置 null 砸外层） */
export function setEvalAssignCollector(
  collector: ((r: EvalAbsAssignRecord) => void) | null,
): ((r: EvalAbsAssignRecord) => void) | null {
  const prev = evalAssignCollector;
  evalAssignCollector = collector;
  return prev;
}

/** 结构赋值记录（transpile 插桩调用；无收集器时 no-op） */
export function $assignRecord(
  name: string,
  prev: Abs | undefined,
  next: Abs,
  line: number,
  column: number,
  conditional: boolean,
): void {
  if (!evalAssignCollector) return;
  try {
    evalAssignCollector({
      name,
      prev,
      next,
      line: line || undefined,
      column: column || undefined,
      conditional,
    });
  } catch {
    /* collector 不得打断执行 */
  }
}

/** 顶层绑定表收集 sink（run.ts 每次执行时安装；真实 ESM 路径 no-op） */
let bindingSink: Map<string, unknown> | null = null;

export function setEvalBindingSink(sink: Map<string, unknown> | null): void {
  bindingSink = sink;
}

/** 顶层绑定记录（transpile 插桩调用） */
export function $recordBinding(name: string, value: unknown): void {
  if (bindingSink) bindingSink.set(name, value);
}

/** evalGlobalFn 覆盖的宿主全局函数名（身份校验后再派发） */
const GLOBAL_FNS = new Set([
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "Number",
  "String",
  "Boolean",
  "Object",
  "Array",
  "eval",
  "Symbol",
  // 原生构造器无 `new` 调用（BigInt / Error 家族 / Map·Set·Promise 等）：
  // 必须走 Abs 分发，禁止裸宿主调用（Abs 实参会炸 internal / 静默假精确）
  "BigInt",
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Promise",
]);

/**
 * 分析期禁止真实执行的宿主全局（网络 / 定时器 / 调度）：
 * 直接执行会把 Abs 实参喂给原生实现——真实网络 I/O、真实定时器。
 * `fetch(unknownAbs)` 会以 `[object Object]` 发起真请求：同步侧
 * ERR_INVALID_URL / 未处理 rejection 直接崩掉分析进程（nudo check 非零退出）。
 * `new WebSocket(abs)` 同理：构造器真执行会开真实 socket。
 * 命中即 fail-closed（unknown + 截断上报），不执行。$callNamed 与 $new 共用。
 */
const NEVER_EXEC_HOST_FN_NAMES = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
] as const;

/** 身份校验（含 `const f = fetch` 别名）：命中返回宿主名，否则 null */
export function neverExecHostName(fn: unknown): string | null {
  if (typeof fn !== "function") return null;
  const g = globalThis as Record<string, unknown>;
  for (const n of NEVER_EXEC_HOST_FN_NAMES) {
    if (fn === g[n]) return n;
  }
  return null;
}

/**
 * 守卫宿主副作用（调用与构造共用）：命中名单 → 上报 + 返回 opaque unknown；
 * 未命中 → null，调用方继续正常路径。
 */
export function blockHostSideEffect(fn: unknown): Abs | null {
  const hostName = neverExecHostName(fn);
  if (hostName === null) return null;
  noteHostEffectBlocked(hostName);
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

/** 返回先前 collector，便于嵌套调用 save/restore（禁止 finally 置 null 砸外层） */
/** 成员/方法调用点打点（$invoke 等；无收集器时 no-op）。不进 $callNamed 预算。 */
export function noteEvalCallRecord(r: EvalCallRecord): void {
  if (!evalCallCollector) return;
  try {
    evalCallCollector(r);
  } catch {
    /* collector 不得打断 */
  }
}

export function setEvalCallCollector(
  collector: ((r: EvalCallRecord) => void) | null,
): ((r: EvalCallRecord) => void) | null {
  const prev = evalCallCollector;
  evalCallCollector = collector;
  return prev;
}

export function getEvalCallCollector(): ((r: EvalCallRecord) => void) | null {
  return evalCallCollector;
}

/**
 * 按名调用并记录。
 * loc: [line, column]（1-based line，0-based column，与 Babel 一致）
 * argLocs: 与 args 对齐的实参字面量源位置（provenance；无 loc 用 null）
 */
// --- eval 调用预算 -----------------------------------------------------------
// 命名调用（transpile 的 $callNamed 是 B run 全部标识符调用的派发点）此前无
// 预算：直接自递归/互递归裸奔原生 JS 递归 → 栈溢出，RangeError 被
// callTranspiledExportFull 兜底静默吞成 unknown+partial（假结果）。预算：
// 深度 64 / 总调用 200k / cycle（同 name+arg 指纹）→ 截断 opaque。

export const MAX_EVAL_CALL_DEPTH = 64;
/** 总调用上限：与 call-budget.MAX_TOTAL_CALLS 同阀（递归×循环×分支展开的
 *  规模阀）。200k 在病态展开（lodash _baseFlatten）下 ~30s，20k 收口到
 *  ~3s——截断 → opaque（更保守，zero-FP 安全）。 */
export const MAX_EVAL_TOTAL_CALLS = 20_000;

let evalCallDepth = 0;
let evalTotalCalls = 0;
let evalActiveCallKeys: string[] = [];
/** 执行会话嵌套深度：导出桥 re-entry 是被调帧，不是宿主入口 */
let evalBudgetSessionDepth = 0;
/** 当前生效上限（@nudo:budget 可逐函数抬高） */
let evalCallDepthLimit = MAX_EVAL_CALL_DEPTH;
let evalTotalCallsLimit = MAX_EVAL_TOTAL_CALLS;
const evalFnCallIds = new WeakMap<object, string>();
let evalFnCallIdSeq = 0;

function evalStableId(obj: object): string {
  let id = evalFnCallIds.get(obj);
  if (id === undefined) {
    id = `#${++evalFnCallIdSeq}`;
    evalFnCallIds.set(obj, id);
  }
  return id;
}

/** 宿主入口前强制清零（测试 / 显式 API）。执行入口请用 enterEvalCallBudgetSession。 */
export function resetEvalCallBudget(): void {
  evalCallDepth = 0;
  evalTotalCalls = 0;
  evalActiveCallKeys = [];
  evalBudgetSessionDepth = 0;
  evalCallDepthLimit = MAX_EVAL_CALL_DEPTH;
  evalTotalCallsLimit = MAX_EVAL_TOTAL_CALLS;
  // fork 总次数与调用预算同轮生命周期（不跨宿主入口累积）
  resetEvalForkBudget();
}

/** @nudo:budget：在 run 期间抬高 B 路径 depth/calls 上限；finally 恢复 */
export function withEvalBudgetOverride(
  budget: { depth?: number; calls?: number },
  run: () => void,
): void {
  const prevDepth = evalCallDepthLimit;
  const prevCalls = evalTotalCallsLimit;
  if (typeof budget.depth === "number" && Number.isFinite(budget.depth) && budget.depth >= 1) {
    evalCallDepthLimit = Math.floor(budget.depth);
  }
  if (typeof budget.calls === "number" && Number.isFinite(budget.calls) && budget.calls >= 1) {
    evalTotalCallsLimit = Math.floor(budget.calls);
  }
  try {
    run();
  } finally {
    evalCallDepthLimit = prevDepth;
    evalTotalCallsLimit = prevCalls;
  }
}

/**
 * 进入执行会话。最外层才重置预算；嵌套（导出桥 $call → apply →
 * callTranspiledExportFull）必须继承外层深度/cycle 键/totalCalls，否则
 * 外层帧被抹掉，$callNamed 的 evalExitCall 再把 depth 打成负数。
 */
export function enterEvalCallBudgetSession(): void {
  if (evalBudgetSessionDepth === 0) {
    evalCallDepth = 0;
    evalTotalCalls = 0;
    evalActiveCallKeys = [];
    resetEvalForkBudget();
  }
  evalBudgetSessionDepth++;
}

/** 退出执行会话。禁止把 sessionDepth 留在负数。 */
export function exitEvalCallBudgetSession(): void {
  if (evalBudgetSessionDepth > 0) evalBudgetSessionDepth--;
}

/** 预算快照（测试/诊断：断言嵌套期间 depth/keys 不被清空、depth 不为负） */
export function getEvalCallBudgetState(): {
  depth: number;
  totalCalls: number;
  activeKeys: number;
  sessionDepth: number;
} {
  return {
    depth: evalCallDepth,
    totalCalls: evalTotalCalls,
    activeKeys: evalActiveCallKeys.length,
    sessionDepth: evalBudgetSessionDepth,
  };
}

/** 截断结果：unknown#opaque——预算截断，不触发 unknown-inference */
function evalTruncatedAbs(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

function evalCallBudgetKey(name: string, fn: unknown, args: Abs[]): string {
  // 实参可能是裸 JS 值（B run 里模块函数作实参传的就是 JS 函数）——统一走
  // call-budget 的防御化键（不得裸读 shape）
  const id = fn && typeof fn === "object" ? evalStableId(fn) : "prim";
  return callBudgetKey(name, id, args);
}

/** 进入命名调用：超限/cycle → 不执行，返回 opaque（并上报截断） */
function evalEnterCall(name: string, fn: unknown, args: Abs[]): { ok: boolean; key?: string } {
  const key = evalCallBudgetKey(name, fn, args);
  if (
    evalActiveCallKeys.includes(key) ||
    evalCallDepth >= evalCallDepthLimit ||
    evalTotalCalls >= evalTotalCallsLimit
  ) {
    noteAbsTruncation(name);
    return { ok: false };
  }
  evalActiveCallKeys.push(key);
  evalCallDepth++;
  evalTotalCalls++;
  return { ok: true, key };
}

function evalExitCall(): void {
  // 禁止负数：嵌套 reset 曾把 depth 清零后再 --，守卫从此失效
  if (evalCallDepth > 0) evalCallDepth--;
  if (evalActiveCallKeys.length > 0) evalActiveCallKeys.pop();
}

export function $callNamed(
  name: string,
  fn: unknown,
  args: Abs[],
  loc?: [number, number],
  argLocs?: Array<[number, number] | null | undefined>,
): Abs {
  // @nudo:pure：宿主 JS 函数 / Abs 上的 `_memoize` 标记 → 同实参命中缓存
  const pureName = pureFnNameOf(fn);
  const fnObj = fn && (typeof fn === "object" || typeof fn === "function")
    ? (fn as object)
    : undefined;
  const pk = pureName && fnObj ? callBudgetKey("pure", "", args) : undefined;
  if (fnObj && pk !== undefined) {
    const hit = pureCallMemo.get(fnObj)?.get(pk);
    if (hit !== undefined) return hit;
  }
  let result: Abs = unknown;
  let threw = false;
  if (argLocs) {
    for (let i = 0; i < args.length; i++) {
      const al = argLocs[i];
      if (al) tagAbsOrigin(args[i]!, { line: al[0], column: al[1] });
    }
  }
  // D1：调用前快照实参——mutator（pop/push）会就地改写，记录必须是入参态
  const argsSnapshot = args.map((a) =>
    a && typeof a === "object" && "shape" in (a as object) ? $copy(a) : (a as Abs),
  );
  if (loc) pushCallLoc({ line: loc[0], column: loc[1] });
  try {
    if (typeof fn === "function") {
      // 宿主全局函数（Number/String/parseInt…）：按身份识别，路由到 Abs builtin 表。
      // 直接调用会把 Abs 喂给真 JS 函数（Number(absObj) → NaN）——静默错误。
      // 原生构造器（BigInt/Error/Map…）同样禁止裸调：BigInt(absObj) 炸
      // "Cannot convert [object Object] to a BigInt"，AggregateError(absArr) 炸
      // "object is not iterable"。GLOBAL_FNS 按名匹配不够（别名 `const f = BigInt`），
      // 补 hostBuiltinCtorName 身份兜底。
      let g: Abs | undefined;
      if (GLOBAL_FNS.has(name) && fn === (globalThis as Record<string, unknown>)[name]) {
        g = evalGlobalFn(name, args);
      } else {
        const ctorName = hostBuiltinCtorName(fn);
        if (ctorName !== undefined) {
          g = evalGlobalFn(ctorName, args);
        }
      }
      const blockedHost = g === undefined ? blockHostSideEffect(fn) : null;
      if (g !== undefined) {
        result = g;
      } else if (blockedHost !== null) {
        result = blockedHost;
      } else {
        const entered = evalEnterCall(name, fn, args);
        if (!entered.ok) {
          result = evalTruncatedAbs();
        } else {
          try {
            // 嵌套 求值引擎函数：调用边界收 NudoReturn，不得污染 caller
            result = callAtFunctionBoundary(() => (fn as (...a: Abs[]) => Abs)(...args));
          } finally {
            evalExitCall();
          }
        }
      }
    } else if (fn && typeof fn === "object" && "shape" in (fn as object)) {
      // Abs fn 分支同口径预算（编译递归经 $call 会绕到此处——cycle/深度守卫）
      const entered = evalEnterCall(name, fn, args);
      if (!entered.ok) {
        result = evalTruncatedAbs();
      } else {
        try {
          result = $call(fn as Abs, args);
        } finally {
          evalExitCall();
        }
      }
    }
  } catch (e) {
    threw = true;
    // 抛出载荷进 record：与 class.ts 同约定——threw 时 result 位承载抛出 Abs
    //（桥 callRecordFromAbsCall 据此填 throwsAbs），不得留初值 unknown。
    result = throwPayloadOf(e);
    throw e;
  } finally {
    if (loc) popCallLoc();
    if (fnObj && pk !== undefined && !threw) {
      let m = pureCallMemo.get(fnObj);
      if (!m) {
        m = new Map();
        pureCallMemo.set(fnObj, m);
      }
      m.set(pk, result);
    }
    if (evalCallCollector) {
      try {
        evalCallCollector({
          fnName: name,
          args: argsSnapshot,
          result,
          callLoc: loc ? { line: loc[0], column: loc[1] } : undefined,
          threw,
        });
      } catch {
        /* collector 不得打断 */
      }
    }
  }
  return result;
}
