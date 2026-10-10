/**
 * 求值引擎调用点记录：transpile 把 `f(args)` 改成 $callNamed，
 * 分析时可收集 call@ 所需的 AbsCallRecord。
 * 成员缺失诊断见 member-diag.ts（共用，避免循环依赖）。
 */

import type { Abs } from "../abs.ts";
import { abs, litValue, never as neverAbs, unknown } from "../abs.ts";
import { evalGlobalFn, hostBuiltinCtorName } from "../builtins.ts";
import { mayCoerceThrowOperand } from "../builtins/shared.ts";
import { isSymbolAbs } from "../builtins/symbol.ts";
import { $call, routeApplyThrows, clearPureMemo } from "./call.ts";
import { callAtFunctionBoundary, $copy, asAbsVal } from "./runtime.ts";
import { setHostGlobalFnCall } from "./runtime/state.ts";
import { setHostGlobalCallBridge, validateCallableArg } from "../hof.ts";
import { throwPayloadOf, recordMayThrow, errorTypeAbs } from "./may-throw.ts";
import { NudoThrow } from "./nudo-throw.ts";
import { pureFnNameOf, makeAbsApplyResult, type AbsApplyResult } from "../abs-fn.ts";
import { noteAbsTruncation, callBudgetKey, resetEvalForkBudget, noteHostEffectBlocked } from "../call-budget.ts";
import {
  tagAbsOrigin,
  pushCallLoc,
  popCallLoc,
} from "./member-diag.ts";
import { peekThrowExitsSince, throwExitsMark } from "./runtime/state.ts";
import { joinAbs } from "../objects.ts";
import { BoundedLruMap } from "../lru-map.ts";
import {
  createScopedSlot,
  registerCollectorScopeParticipant,
} from "../collector-scope.ts";
import {
  adoptCallArgsToFaces,
  attachContractFaces,
  contractFacesOf,
  presentCallResultFace,
  resolveContractFacesByName,
} from "../contract-face.ts";

export type EvalCallRecord = {
  fnName: string;
  args: Abs[];
  result: Abs;
  callLoc?: { line: number; column: number };
  /** BUG-028：必填——漏设时异常 payload 会被当成功结果
   * （resultAbs=payload、throwsAbs=never，isLeakedCallRecord
   * 的 never+never 拦不住）。5 处 emitter 均已显式设置。 */
  threw: boolean;
};

/** pureCallMemo 内层 Map 上界（与 pureMemo 同口径） */
const PURE_CALL_MEMO_MAX = 256;

/** @nudo:pure 宿主调用结果缓存（fn 对象身份 → args key → {abs, throws}） */
let pureCallMemo = new WeakMap<object, BoundedLruMap<AbsApplyResult>>();

/** 清空 pureCallMemo（宿主入口 / 会话缓存失效） */
export function clearPureCallMemo(): void {
  pureCallMemo = new WeakMap();
}

/** 把 mark 之后的 throwExits 合成 throws 面（pure memo 捕获） */
function joinThrowsSince(mark: number): Abs {
  const items = peekThrowExitsSince(mark);
  if (items.length === 0) return neverAbs;
  if (items.length === 1) return items[0]!;
  return items.reduce((a, b) => joinAbs(a, b));
}

/** 调用点 collector（作用域化：runWithCollectorScope 内各分析互不串台；
 *  无作用域 = fallback 模块级单变量，行为同今日） */
const evalCallCollectorSlot = createScopedSlot<
  ((r: EvalCallRecord) => void) | null
>(() => null);
registerCollectorScopeParticipant((body) => evalCallCollectorSlot.runScoped(body));

/** B 赋值记录（与 ast-records.ts AbsAssignRecord 同形；structuralAssignIssues 消费） */
export type EvalAbsAssignRecord = {
  name: string;
  prev: Abs | undefined;
  next: Abs;
  line?: number;
  column?: number;
  conditional?: boolean;
};

/** 赋值记录 collector（作用域化，同 evalCallCollectorSlot） */
const evalAssignCollectorSlot = createScopedSlot<
  ((r: EvalAbsAssignRecord) => void) | null
>(() => null);
registerCollectorScopeParticipant((body) => evalAssignCollectorSlot.runScoped(body));

/** 返回先前 collector，便于嵌套调用 save/restore（禁止 finally 置 null 砸外层） */
export function setEvalAssignCollector(
  collector: ((r: EvalAbsAssignRecord) => void) | null,
): ((r: EvalAbsAssignRecord) => void) | null {
  const prev = evalAssignCollectorSlot.get();
  evalAssignCollectorSlot.set(collector);
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
  const evalAssignCollector = evalAssignCollectorSlot.get();
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

/** 顶层绑定表收集 sink（run.ts 每次执行时安装；真实 ESM 路径 no-op；
 *  作用域化，同 evalCallCollectorSlot） */
const bindingSinkSlot = createScopedSlot<Map<string, unknown> | null>(() => null);
registerCollectorScopeParticipant((body) => bindingSinkSlot.runScoped(body));

export function setEvalBindingSink(sink: Map<string, unknown> | null): void {
  bindingSinkSlot.set(sink);
}

/** 顶层绑定记录（transpile 插桩调用） */
export function $recordBinding(name: string, value: unknown): void {
  const bindingSink = bindingSinkSlot.get();
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
  // Bug 5：URI/escape 族——env 声明 prim.str()→prim.str() 此前被
  // callHostGlobalLiteralOnly 的「抽象实参一律 unknown」兜底遮蔽；登记后
  // evalGlobalFn 折叠字面量、抽象 prim 按 str + may-throw 面分派
  "encodeURI",
  "decodeURI",
  "encodeURIComponent",
  "decodeURIComponent",
  "btoa",
  "atob",
  "escape",
  "unescape",
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
 * Bug 30（强转三连）：queueMicrotask 原生同步校验 IsCallable——fail-closed
 * 仍不执行回调，但校验是纯静态的，与原生同口径（setTimeout/fetch 等名单
 * 其余成员原生接受任意首实参，无校验可言，维持纯拦截）。
 */
export function blockHostSideEffect(fn: unknown, args?: Abs[]): Abs | null {
  const hostName = neverExecHostName(fn);
  if (hostName === null) return null;
  if (hostName === "queueMicrotask" && args) {
    validateCallableArg(args[0], "queueMicrotask callback must be callable");
  }
  noteHostEffectBlocked(hostName);
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

/** 返回先前 collector，便于嵌套调用 save/restore（禁止 finally 置 null 砸外层） */
/** 成员/方法调用点打点（$invoke 等；无收集器时 no-op）。不进 $callNamed 预算。 */
export function noteEvalCallRecord(r: EvalCallRecord): void {
  const evalCallCollector = evalCallCollectorSlot.get();
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
  const prev = evalCallCollectorSlot.get();
  evalCallCollectorSlot.set(collector);
  return prev;
}

export function getEvalCallCollector(): ((r: EvalCallRecord) => void) | null {
  return evalCallCollectorSlot.get();
}

/**
 * Bug 20：宿主全局函数身份集（globalThis 自有属性中的函数值，惰性构建）。
 * 未进 GLOBAL_FNS / hostBuiltinCtorName / NEVER_EXEC 名单的宿主全局
 * （decodeURIComponent / btoa / escape / …）此前落入真调用兜底——Abs 对象
 * 被 String(absObj) 静默折 "[object Object]"，原生 URIError/TypeError 丢失
 * （decodeURIComponent("%") 应抛 URIError 却静默返 unknown）。
 * 按值身份识别（覆盖 `const d = decodeURIComponent` 别名）；模块转译函数
 * 是全新对象，绝不与宿主全局同一 → 不误伤。
 */
let hostGlobalFnIds: Set<unknown> | undefined;

/** 宿主全局函数身份判定（$new 宿主构造器分支共用，Bug 16）：模块转译
 *  函数是全新对象，绝不与宿主全局同一 → 不误伤。 */
export function isHostGlobalFn(fn: unknown): boolean {
  if (typeof fn !== "function") return false;
  if (!hostGlobalFnIds) {
    hostGlobalFnIds = new Set<unknown>();
    const g = globalThis as Record<string, unknown>;
    for (const k of Object.getOwnPropertyNames(g)) {
      const v = g[k];
      if (typeof v === "function") hostGlobalFnIds.add(v);
    }
  }
  return hostGlobalFnIds.has(fn);
}

/**
 * Bug 20：宿主全局的字面量实参守卫执行——
 * - 全部实参均为 prim 字面量（含 null/undefined/bigint）→ 转真值执行，
 *   宿主异常（URIError/DOMException/…）折 NudoThrow(throwPayloadOf(e))
 *   进 throws 域；返回值经 litAbsFromJs 诚实转 Abs
 * - 任一抽象/对象实参 → 不喂宿主（禁反模式：Abs 直接进真 JS 函数），
 *   保守 unknown + may TypeError（实参可能是抛异常形态——symbol 载体的
 *   ToString 定抛；与 parseInt/Number 的抽象臂同口径）
 * GLOBAL_FNS 的既有折算（evalGlobalFn）不受影响。
 */
function callHostGlobalLiteralOnly(
  name: string,
  fn: (...a: unknown[]) => unknown,
  args: Abs[],
): Abs {
  const jsArgs: unknown[] = [];
  for (const a of args) {
    if (a && typeof a === "object" && "shape" in (a as object)) {
      // symbol prim（Symbol() 产物，无 lit 项）：一切 ToString/ToNumber 面
      // 定抛（node 实测 encodeURIComponent/decodeURIComponent/btoa/
      // escape(Symbol()) → TypeError）→ 硬抛，不落保守 may
      if (isSymbolAbs(a as Abs)) throw new NudoThrow(errorTypeAbs("TypeError"));
      const lv = litValue(a as Abs);
      if (!lv.ok) {
        // symbol 载体（any/unknown/obj/fn/brand/sum）→ may TypeError；
        // 抽象 prim（refined string/number）无 symbol 可能 → 不记
        if (mayCoerceThrowOperand(a as Abs)) {
          recordMayThrow({
            kind: "TypeError",
            cause: `${name}(...) host call with abstract argument may throw (Symbol coercion)`,
          });
        }
        return unknown;
      }
      jsArgs.push(lv.value);
    } else {
      jsArgs.push(a); // 裸 JS 值（B run 模块函数实参）——真值直传
    }
  }
  try {
    return asAbsVal(fn(...jsArgs));
  } catch (e) {
    // 宿主异常折进 throws 域（不裸冒泡——payload 与 class.ts 同约定）
    throw new NudoThrow(throwPayloadOf(e));
  }
}

/**
 * Bug 26：宿主全局函数**值**的一等公民调用桥——被调用位（$callNamed 内层
 * 分派）同款路由，供回调位（callFn / applyCallbackValue）、.call/.apply
 * 接收者位（$invokeInner）、asAbsVal 的 apply 钩子共用：
 * GLOBAL_FNS 名字+身份 → evalGlobalFn；宿主内建构造器身份 → evalGlobalFn；
 * 副作用名单 → fail-closed；其余宿主全局 → callHostGlobalLiteralOnly。
 * 非宿主全局（模块转译函数等）返回 undefined，调用方走原路径。
 */
export function callHostGlobalFn(fn: unknown, args: Abs[]): Abs | undefined {
  if (typeof fn !== "function" || !isHostGlobalFn(fn)) return undefined;
  const name = fn.name || "hostGlobal";
  let g: Abs | undefined;
  if (GLOBAL_FNS.has(name) && fn === (globalThis as Record<string, unknown>)[name]) {
    g = evalGlobalFn(name, args);
  } else {
    const ctorName = hostBuiltinCtorName(fn);
    if (ctorName !== undefined) {
      g = evalGlobalFn(ctorName, args);
    }
  }
  if (g !== undefined) return g;
  const blocked = blockHostSideEffect(fn, args);
  if (blocked !== null) return blocked;
  return callHostGlobalLiteralOnly(name, fn as (...a: unknown[]) => unknown, args);
}

// Bug 26：把桥注入 hof.ts（applyCallbackValue 回调位）与 state.ts
// （asAbsVal 的 apply 钩子）——两文件均为被依赖方，注册式避免反向 import
setHostGlobalCallBridge(callHostGlobalFn);
setHostGlobalFnCall(callHostGlobalFn);

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
  // pure memo 同轮生命周期（宿主入口清零，防长驻进程无界膨胀）
  clearPureMemo();
  clearPureCallMemo();
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

/** 截断结果：unknown#opaque——预算截断，不触发 unknown-inference
 *  （$new 宿主函数 [[Construct]] 共用，Bug 16） */
export function evalTruncatedAbs(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

function evalCallBudgetKey(name: string, fn: unknown, args: Abs[]): string {
  // 实参可能是裸 JS 值（B run 里模块函数作实参传的就是 JS 函数）——统一走
  // call-budget 的防御化键（不得裸读 shape）
  const id = fn && typeof fn === "object" ? evalStableId(fn) : "prim";
  return callBudgetKey(name, id, args);
}

/** 进入命名调用：超限/cycle → 不执行，返回 opaque（并上报截断）。
 *  $new 的宿主函数 [[Construct]] 体执行共用（Bug 16，递归构造深度守卫）。 */
export function evalEnterCall(name: string, fn: unknown, args: Abs[]): { ok: boolean; key?: string } {
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

export function evalExitCall(): void {
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
  // #123 fix B：同文件 callee 的契约面——按名 resolver（checkSource 安装，
  // 对被分析文件自身的同名契约）优先（每次分析现解析，不滞留），对象注册
  // 兜底；命中后回写对象注册，同对象别名调用点（`const g = f`）后续直接命中。
  // 跨模块桥接走 bindImport wrapper → $call（wrapper 无面，桥接 Abs 在 $call 消费）。
  const faces = resolveContractFacesByName(name) ?? contractFacesOf(fn);
  const fnObj = fn && (typeof fn === "object" || typeof fn === "function")
    ? (fn as object)
    : undefined;
  if (faces && fnObj) attachContractFaces(fnObj, faces);
  const execArgs = faces ? adoptCallArgsToFaces(args, faces) : args;
  // @nudo:pure：宿主 JS 函数 / Abs 上的 `_memoize` 标记 → 同实参命中缓存
  const pureName = pureFnNameOf(fn);
  // 键取采用后实参（与执行一致）：面存在与否改变执行世界，键随之区分
  const pk = pureName && fnObj ? callBudgetKey("pure", "", execArgs) : undefined;
  if (fnObj && pk !== undefined) {
    const hit = pureCallMemo.get(fnObj)?.get(pk);
    if (hit !== undefined) {
      const routed = routeApplyThrows(hit.abs, hit.throws);
      return faces ? presentCallResultFace(routed, faces) : routed;
    }
  }
  let result: Abs = unknown;
  let threw = false;
  // pure memo 捕获 mark：本帧新增 throwExits 即本调用的 throws 面
  const throwMark = throwExitsMark();
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
      const blockedHost = g === undefined ? blockHostSideEffect(fn, args) : null;
      if (g !== undefined) {
        result = g;
      } else if (blockedHost !== null) {
        result = blockedHost;
      } else if (isHostGlobalFn(fn)) {
        // Bug 20：未进 Abs 表的宿主全局——字面量实参守卫执行（宿主异常折
        // NudoThrow）；抽象实参保守 unknown + may。见 callHostGlobalLiteralOnly。
        result = callHostGlobalLiteralOnly(name, fn as (...a: unknown[]) => unknown, args);
      } else {
        const entered = evalEnterCall(name, fn, execArgs);
        if (!entered.ok) {
          result = evalTruncatedAbs();
        } else {
          try {
            // 嵌套 求值引擎函数：调用边界收 NudoReturn，不得污染 caller。
            // #123：执行实参 = 契约面采用后（仅无信息位被声明面替换）。
            result = callAtFunctionBoundary(() => (fn as (...a: Abs[]) => Abs)(...execArgs));
          } finally {
            evalExitCall();
          }
        }
      }
    } else if (fn && typeof fn === "object" && "shape" in (fn as object)) {
      // Abs fn 分支同口径预算（编译递归经 $call 会绕到此处——cycle/深度守卫）
      const entered = evalEnterCall(name, fn, execArgs);
      if (!entered.ok) {
        result = evalTruncatedAbs();
      } else {
        try {
          // #123：execArgs 已按名 resolver 采用；$call 内对象面路径幂等
          result = $call(fn as Abs, execArgs);
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
        m = new BoundedLruMap<AbsApplyResult>(PURE_CALL_MEMO_MAX);
        pureCallMemo.set(fnObj, m);
      }
      // 捕获本帧新增 throws 面（body/apply 路径的 pushThrowExit 已入帧）；
      // 命中时 routeApplyThrows 重放（只缓存 abs 会在命中时假「不抛」）。
      m.set(pk, makeAbsApplyResult(result, joinThrowsSince(throwMark)));
    }
    const evalCallCollector = evalCallCollectorSlot.get();
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
  // #123：返回位呈现声明面（字面量等已满足契约的推断面保留；threw 路径
  // 在上方 catch re-throw，不经过此处）
  return faces ? presentCallResultFace(result, faces) : result;
}
