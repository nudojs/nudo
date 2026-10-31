/**
 * 求值引擎调用点记录：transpile 把 `f(args)` 改成 $callNamed，
 * 分析时可收集 call@ 所需的 AbsCallRecord。
 * 成员缺失诊断见 member-diag.ts（共用，避免循环依赖）。
 */

import type { Abs } from "../abs.ts";
import { abs, litValue, unknown } from "../abs.ts";
import { evalGlobalFn, hostBuiltinCtorName } from "../builtins.ts";
import { mayCoerceThrowOperand } from "../builtins/shared.ts";
import { isSymbolAbs } from "../builtins/symbol.ts";
import { $call, routeApplyThrows, clearPureMemo, joinThrowsSince } from "./call.ts";
import { callAtFunctionBoundary, $copy, asAbsVal } from "./runtime.ts";
import { setHostGlobalFnCall } from "./runtime/state.ts";
import { setHostGlobalCallBridge, validateCallableArg } from "../hof.ts";
import { throwPayloadOf, recordMayThrow, errorTypeAbs } from "./may-throw.ts";
import { NudoThrow } from "./nudo-throw.ts";
import { pureFnNameOf, makeAbsApplyResult } from "../abs-fn.ts";
import {
  MAX_CALL_DEPTH,
  MAX_TOTAL_CALLS,
  callBudgetKey,
  createCallBudget,
  resetEvalForkBudget,
  resetEvalForkCount,
  noteHostEffectBlocked,
  registerEvalCallBudgetProbe,
  withSpeculativeEvalObservability,
} from "../call-budget.ts";
import {
  tagAbsOrigin,
  pushCallLoc,
  popCallLoc,
} from "./member-diag.ts";
import { throwExitsMark } from "./runtime/state.ts";
import { clearAllPureMemos, createPureMemo } from "./pure-memo.ts";
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
  /** 调用方帧深度（0 = 最外层求值帧；递归内层帧 ≥1）。
   *  局部量投影按帧过滤重入记录（与 $nodoPos 同口径）。 */
  depth?: number;
};

/** @nudo:pure 宿主调用结果缓存（$callNamed 路径实例；值基键见 pure-memo.ts） */
const pureCallMemo = createPureMemo();

/** 清空 pure memo（宿主入口 / 会话缓存失效；清**全部**实例——两条调用路径） */
export function clearPureCallMemo(): void {
  clearAllPureMemos();
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
  /** 写目标是函数形参（AbsAssignRecord.paramBinding） */
  paramBinding?: boolean;
  /** 调用方帧深度（0 = 最外层求值帧；与 EvalCallRecord.depth 同口径） */
  depth?: number;
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
  /** 写目标是函数形参（可选；缺省 false ⇒ 产物逐字不变） */
  paramBinding?: boolean,
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
      ...(paramBinding === true ? { paramBinding: true } : {}),
      // 调用方帧深度（与 EvalCallRecord.depth 同口径——局部量投影按帧过滤）
      depth: evalBudget.depth,
    });
  } catch {
    /* collector 不得打断执行 */
  }
}

/** 顶层绑定表收集 sink（run.ts 每次执行时安装；真实 ESM 路径 no-op；
 *  作用域化，同 evalCallCollectorSlot） */
const bindingSinkSlot = createScopedSlot<Map<string, unknown> | null>(() => null);
registerCollectorScopeParticipant((body) => bindingSinkSlot.runScoped(body));

/** 位置级 Abs 记录（hover 重放插桩 `$nodoPos` 消费）：
 * (1-based 行, 0-based 列) → 该位置表达式求值态 Abs */
export type EvalPosRecord = {
  line: number;
  column: number;
  abs: Abs;
};

/** 位置 collector（作用域化，同 evalCallCollectorSlot） */
const evalPosCollectorSlot = createScopedSlot<
  ((r: EvalPosRecord) => void) | null
>(() => null);
registerCollectorScopeParticipant((body) => evalPosCollectorSlot.runScoped(body));

/** 返回先前 collector，便于嵌套调用 save/restore（禁止 finally 置 null 砸外层） */
export function setPosCollector(
  collector: ((r: EvalPosRecord) => void) | null,
): ((r: EvalPosRecord) => void) | null {
  const prev = evalPosCollectorSlot.get();
  evalPosCollectorSlot.set(collector);
  return prev;
}

export function getPosCollector(): ((r: EvalPosRecord) => void) | null {
  return evalPosCollectorSlot.get();
}

/**
 * 位置级 Abs 记录（transpile 插桩调用——`recordPositions` 时
 * Identifier 值读 / 静态成员读包此调用）：把 (行, 列) → Abs
 * 记入活跃 collector 并**原样返回**（语义恒等）；无收集器时
 * 直通（热路径零开销——仅重放开插桩）。
 *
 * 仅记最外层求值帧（evalBudget.depth === 0）：递归函数的内层帧
 * （$callNamed/$new 预算帧）会以重入态重执行同一源码位置——
 * 自递归类型（lazy 自引用契约）下内层帧携带 cycle 截断的
 * opaque unknown，first-wins 记录会以外层正确值被污染为序；
 * 编辑器位置的语义以最外层调用帧（hover 重放的单次入口）为准。
 */
export function $nodoPos(v: Abs, line: number, column: number): Abs {
  const collector = evalPosCollectorSlot.get();
  if (collector && evalBudget.depth === 0) {
    try {
      collector({ line, column, abs: v });
    } catch {
      /* collector 不得打断执行 */
    }
  }
  return v;
}

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
// 导出面=漂移探针（__tests__/host-global-drift.test.ts）比对已审计拦截面；
// 拦截行为仍经 neverExecHostName / blockHostSideEffect 消费，不直接遍历。
export const NEVER_EXEC_HOST_FN_NAMES = [
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

/** 函数值 accessor 白名单：GET 无警告、值 typeof function、身份被消费的宿主全局。
 *  node 26 实测（descriptor + typeof 全量探测）：Buffer（TypedArray 构造器）、
 *  assert / events / stream / node:test（legacy builtin 模块，module.exports 即
 *  函数）——读齐这五个后收集集与旧「全量 GET」实现逐元素一致（其余 accessor：
 *  process/crypto/navigator/punycode/sys/wasi/ffi/模块 namespace，读出均非函数）。
 *  未来新增非 accessor 宿主函数不受影响（value 属性照常收集）；新增 accessor
 *  宿主函数若不在列，只会回落保守路径（无假精度），不泄漏警告。 */
const HOST_FN_ACCESSOR_ALLOWLIST: ReadonlySet<string> = new Set([
  "Buffer",
  "assert",
  "events",
  "stream",
  "node:test",
]);

/** 宿主全局函数值收集（isHostGlobalFn 惰性身份集与 collectHostGlobalFnEntryNames
 *  探针枚举共用同套判定，零漂移）：Object.getOwnPropertyNames(globalThis) 逐名
 *  过滤，返回 [名字, 函数值] 对。 */
function collectHostGlobalFnEntries(): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  const g = globalThis as Record<string, unknown>;
  for (const k of Object.getOwnPropertyNames(g)) {
    const d = Object.getOwnPropertyDescriptor(g, k);
    if (
      d &&
      (d.get !== undefined || d.set !== undefined) &&
      !HOST_FN_ACCESSOR_ALLOWLIST.has(k)
    ) {
      // accessor 属性：GET 会执行宿主 lazy getter。Node ≥ 23 的 builtin
      // alias getter（wasi / node:ffi / punycode / sys / …）GET 即发
      // Experimental / Deprecation 警告，名单随版本只增不减
      // （node:test / node:sea 已在列）→ 追「跳名清单」不可维护，按
      // descriptor 形态跳过全部 accessor（白名单除外）。try/catch 无效
      // （警告非异常）、`in` 预检无效（accessor 存在，GET 仍警告）。
      continue;
    }
    const v = g[k];
    if (typeof v === "function") entries.push([k, v]);
  }
  return entries;
}

/** 宿主全局函数身份判定（$new 宿主构造器分支共用，Bug 16）：模块转译
 *  函数是全新对象，绝不与宿主全局同一 → 不误伤。 */
export function isHostGlobalFn(fn: unknown): boolean {
  if (typeof fn !== "function") return false;
  if (!hostGlobalFnIds) {
    hostGlobalFnIds = new Set<unknown>();
    for (const [, v] of collectHostGlobalFnEntries()) hostGlobalFnIds.add(v);
  }
  return hostGlobalFnIds.has(fn);
}

/** 宿主全局函数值名字枚举（当下 globalThis 快照，不落 hostGlobalFnIds 缓存）：
 *  漂移审计探针（__tests__/host-global-drift.test.ts）消费。isHostGlobalFn 的
 *  真调用兜底按**值身份**吸收 Node 未来新增的全局函数——副作用全局（调度 /
 *  网络 / IO 族）默认会落进兜底真执行，因此本枚举出的**新名字必须审计**：
 *  进 NEVER_EXEC_HOST_FN_NAMES 拦截或确认纯函数后并入探针基线 fixture。 */
export function collectHostGlobalFnEntryNames(): string[] {
  return collectHostGlobalFnEntries()
    .map(([k]) => k)
    .sort();
}

/**
 * Bug 288：`structuredClone` 的实参**可克隆性**分档。
 *
 * `structuredClone` 是宿主全局里唯一走**结构化克隆算法**（而非 ToString /
 * ToNumber 强转）的纯函数 ⇒「抽象实参 ⇒ 保守 unknown + may TypeError
 * （Symbol coercion）」那条通用兜底对它**不成立**（那条推理只对「对实参
 * 做 ToString / ToNumber」的宿主函数成立：parseInt / Number /
 * decodeURIComponent / btoa …）：
 * - **可克隆形态**（普通对象 / 数组 / Date / Map / Set / RegExp /
 *   ArrayBuffer / TypedArray / 原始值）⇒ 原生**不抛** ⇒ 记抛 = **假红**
 *   （L1/L2 门禁红，而 native 不抛）；
 * - **不可克隆形态**（函数 / Symbol / WeakMap / WeakSet / WeakRef /
 *   Promise / generator）⇒ 原生抛 **DOMException(DataCloneError)** ⇒
 *   记 `TypeError` = **抛错类型错**（用户写不出 `@nudo:throws
 *   DataCloneError`，契约面无法申报）。
 *
 * 分档只看**实参形态**（禁反模式：Abs 直接进真 JS 函数），不看具体值。
 */
type Cloneability = "cloneable" | "not-cloneable" | "unknown";

/** 不可克隆的品牌（宿主内建：Weak 家族 / Promise / Proxy） */
const NON_CLONEABLE_BRANDS: ReadonlySet<string> = new Set([
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "Promise",
  "Proxy",
]);

/** 可克隆性递归深度阀（自引用结构 ⇒ 判 unknown，不无限递归） */
const CLONEABILITY_MAX_DEPTH = 8;

/**
 * 合档（**必然存在**的槽位 / 元素）：不可克隆 > 未知 > 可克隆。
 * 用于 obj 的自有槽、tuple 的定长元素、brand 的实例槽 —— 这些位置在运行时
 * 必然存在 ⇒ 该位不可克隆 ⇒ 整体**确定**不可克隆。
 */
function mergeCloneability(a: Cloneability, b: Cloneability): Cloneability {
  if (a === "not-cloneable" || b === "not-cloneable") return "not-cloneable";
  if (a === "unknown" || b === "unknown") return "unknown";
  return "cloneable";
}

/**
 * 合档（**可能不存在**的位）：不可克隆降级为「未知」。
 * 用于 sum 的臂、arr 的元素域、obj 的索引槽 —— 这些位在运行时可能不出现
 * （空数组 / 未命中的分支 / 无该键）⇒ 该位不可克隆只是「**可能**抛」。
 */
function mergeMaybeCloneability(a: Cloneability, b: Cloneability): Cloneability {
  if (a === "not-cloneable" || b === "not-cloneable") return "unknown";
  if (a === "unknown" || b === "unknown") return "unknown";
  return "cloneable";
}

/**
 * Abs 实参 ⇒ 结构化克隆可克隆性。
 * - prim（非 symbol）⇒ 可克隆（原始值皆可克隆）
 * - symbol prim / fn / eff（promise·generator）⇒ **不可克隆**（宿主定抛
 *   DataCloneError）
 * - brand ⇒ Weak 家族 / Promise / Proxy 不可克隆；其余（Date / Map / Set /
 *   RegExp / ArrayBuffer / TypedArray / Error 家族 / 用户类）按实例槽分档
 *   （用户类的函数属性不可克隆 ⇒ 记 DataCloneError）
 * - obj / arr / tuple ⇒ 按槽与元素分档（私有字段槽 / symbol 键槽不参与
 *   结构化克隆 ⇒ 不参与分档）
 * - any / unknown ⇒ **未知**（实参本身可能是函数）
 */
function cloneabilityOf(a: Abs, depth = 0): Cloneability {
  if (depth > CLONEABILITY_MAX_DEPTH) return "unknown";
  const s = a.shape;
  switch (s.k) {
    case "never":
      return "cloneable";
    case "prim":
      return s.type === "symbol" ? "not-cloneable" : "cloneable";
    case "fn":
      return "not-cloneable";
    case "eff":
      return "not-cloneable";
    case "any":
    case "unknown":
      return "unknown";
    case "arr":
      // 数组可能为空 ⇒ 元素域不可克隆只是「可能」抛
      return mergeMaybeCloneability(
        "cloneable",
        cloneabilityOf(s.element, depth + 1),
      );
    case "tuple": {
      let v: Cloneability = "cloneable";
      for (const e of s.elements) {
        v = mergeCloneability(v, cloneabilityOf(e, depth + 1));
      }
      if (s.rest) {
        v = mergeMaybeCloneability(v, cloneabilityOf(s.rest, depth + 1));
      }
      return v;
    }
    case "obj": {
      let v: Cloneability = "cloneable";
      for (const slot of Object.values(s.slots ?? {})) {
        // 引擎内部槽（私有字段）/ symbol 键槽不是克隆面 ⇒ 不参与分档
        if (slot.internal || slot.symbolKey) continue;
        v = mergeCloneability(v, cloneabilityOf(slot.value, depth + 1));
      }
      if (s.index) {
        // 索引槽可能不存在 ⇒ 只算「可能」
        v = mergeMaybeCloneability(v, cloneabilityOf(s.index.value, depth + 1));
      }
      return v;
    }
    case "brand": {
      if (NON_CLONEABLE_BRANDS.has(s.name)) return "not-cloneable";
      return cloneabilityOf(s.shape, depth + 1);
    }
    case "sum": {
      // 运行时只命中一个臂 ⇒ 臂不可克隆只是「可能」抛
      let v: Cloneability = "cloneable";
      for (const m of s.members) {
        v = mergeMaybeCloneability(v, cloneabilityOf(m, depth + 1));
      }
      return v;
    }
    default:
      // 新形态兜底：判未知（可能不可克隆）⇒ 记 DataCloneError
      return "unknown";
  }
}

/** 宿主 structuredClone 身份判定（别名 `const f = structuredClone` 也命中） */
function isStructuredCloneHost(fn: unknown): boolean {
  if (typeof fn !== "function") return false;
  return fn === (globalThis as Record<string, unknown>)["structuredClone"];
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
 *
 * Bug 288：`structuredClone` 走结构化克隆算法（**不对实参做 ToString**）⇒
 * 上面那条「symbol 载体 ⇒ may TypeError」的推理对它不成立 ⇒ 单独分档：
 * 可克隆形态**不记抛**（native 也不抛 ⇒ 原口径是假红）；不可克隆形态记
 * **DataCloneError**（宿主 DOMException 的 name，**不是 TypeError**）。
 */
function callHostGlobalLiteralOnly(
  name: string,
  fn: (...a: unknown[]) => unknown,
  args: Abs[],
): Abs {
  const jsArgs: unknown[] = [];
  // Bug 288：structuredClone 身份命中 ⇒ 实参按「可克隆性」分档
  const structured = isStructuredCloneHost(fn);
  let cloneVerdict: Cloneability = "cloneable";
  let abstractArg = false;
  for (const a of args) {
    if (a && typeof a === "object" && "shape" in (a as object)) {
      if (structured) {
        // 字面量原始值（string/number/boolean/null/undefined/bigint）⇒ 可克隆
        // ⇒ 照常真执行（宿主返回精确值）
        const lv = litValue(a as Abs);
        if (lv.ok) {
          jsArgs.push(lv.value);
          continue;
        }
        // 抽象实参：Abs 不可喂宿主 ⇒ 保守 unknown；throws 面按可克隆性分档
        abstractArg = true;
        const v = cloneabilityOf(a as Abs);
        cloneVerdict = mergeCloneability(cloneVerdict, v);
        if (v === "not-cloneable") {
          // 宿主确定抛 DOMException(DataCloneError)——**不是 TypeError**
          throw new NudoThrow(errorTypeAbs("DataCloneError"));
        }
        continue;
      }
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
  if (structured && abstractArg) {
    // 可克隆形态 ⇒ **不记抛**（native 也不抛）；可克隆性未知 ⇒ 记
    // DataCloneError（实参本身可能是函数等不可克隆形态）
    if (cloneVerdict === "unknown") {
      recordMayThrow({
        kind: "DataCloneError",
        cause: `${name}(...) host call may throw DataCloneError (argument may not be cloneable)`,
      });
    }
    return unknown;
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
// 深度 64 / 总调用 20k / cycle（同 name+arg 指纹）→ 截断 opaque。
// 状态机住在 call-budget.ts（与 A 路径同一实现），本模块只是第二个实例；
// 会话/观测两轴语义见 createCallBudget 注释。

/** B 命名调用深度上限——与 A 路径同值（@nudo:budget 可逐函数抬高） */
export const MAX_EVAL_CALL_DEPTH = MAX_CALL_DEPTH;
/** B 命名调用总调用上限——与 A 路径同值（递归×循环×分支展开的规模阀） */
export const MAX_EVAL_TOTAL_CALLS = MAX_TOTAL_CALLS;

/** B 路径预算实例（session 重置/观测累计由状态机区分）。
 *  `let` 而非 `const`：{@link runEvalCallBudgetTrial} 的试算期换成一次性实例。 */
let evalBudget = createCallBudget({
  maxDepth: MAX_EVAL_CALL_DEPTH,
  maxCalls: MAX_EVAL_TOTAL_CALLS,
});

/** 执行会话嵌套深度：导出桥 re-entry 是被调帧，不是宿主入口 */
let evalBudgetSessionDepth = 0;
const evalFnCallIds = new WeakMap<object, string>();
let evalFnCallIdSeq = 0;

// 探针注册（call-budget 反向 import 破环 → 注册式；本模块加载即生效）。
// 观测累计跨执行会话（check --json 的 budget 块要反映整个宿主入口）。
registerEvalCallBudgetProbe({
  stats: () => evalBudget.stats(),
  resetObservability: () => evalBudget.resetObservability(),
});

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
  evalBudget.reset();
  evalBudgetSessionDepth = 0;
  // fork 总次数与调用预算同轮生命周期（不跨宿主入口累积）
  resetEvalForkBudget();
  // pure memo 同轮生命周期（宿主入口清零，防长驻进程无界膨胀；
  // clearPureMemo 已清全部实例——两个 clear API 共享同一清理面）
  clearPureMemo();
}

/** @nudo:budget：在 run 期间抬高 B 路径 depth/calls 上限；finally 恢复 */
export function withEvalBudgetOverride(
  budget: { depth?: number; calls?: number },
  run: () => void,
): void {
  const prev = evalBudget.getLimits();
  if (typeof budget.depth === "number" && Number.isFinite(budget.depth) && budget.depth >= 1) {
    evalBudget.setLimits({ maxDepth: Math.floor(budget.depth) });
  }
  if (typeof budget.calls === "number" && Number.isFinite(budget.calls) && budget.calls >= 1) {
    evalBudget.setLimits({ maxCalls: Math.floor(budget.calls) });
  }
  try {
    run();
  } finally {
    evalBudget.setLimits(prev);
  }
}

/**
 * BUG-248：自递归函数在 B（求值）路径上的**有界试算**。
 *
 * 自递归的风险不是「递归」本身：结构投影递归（`staticName(node.object)`）
 * 在 lazy 模板深度处被环检测收住，几层即收敛，产物远精确于解释面。风险在
 * 抽象实参的 term 逐层**变形**（`bin(n-1)`）⇒ 环检测键永不重复 ⇒ 展开只
 * 受 depth/calls 封顶，而每层分支的 term 成员数随层数**指数**增长
 * （`bin(n-1)+bin(n-2)` 第 d 层 ~2^d 成员）⇒ 预算生效之前堆先爆。
 *
 * 判据因此是**动态**的：换一次性预算实例（depth/calls 收紧）跑一遍，只有
 * 「没撞预算」的试算才算收敛；撞 depth/calls ⇒ `budgetTruncated`，调用方
 * 回落到「不评估」（即 BUG-248 的 fail-closed，签名仍是 unknown + L2 证据）。
 *
 * 试算可能被丢弃 ⇒ 观测必须可回滚：截断观测与 fork 计数由
 * withSpeculativeEvalObservability 隔离；一次性预算实例天然不污染共享
 * 预算状态机；被丢弃时连 pure memo 一并清账（低预算下写入的记忆化结果
 * 比真实求值更宽，留着就是陈旧值）。
 *
 * 但「这次求值被预算截断」这个**事实**必须回到宿主预算面（否则宿主面
 * 只看到旁证的 cycle ⇒ health 与 check 对同一文件给出不同归因，见函数体
 * 末的重新记账）：回滚的是试算的**内部阈值与计数**，不是「撞了预算」这件事。
 */
export function runEvalCallBudgetTrial<R>(
  limits: { depth: number; calls: number },
  body: () => R,
): { result: R; budgetTruncated: boolean } {
  const outerBudget = evalBudget;
  const outerSessionDepth = evalBudgetSessionDepth;
  const trial = createCallBudget({ maxDepth: limits.depth, maxCalls: limits.calls });
  evalBudget = trial;
  evalBudgetSessionDepth = 0;
  let result!: R;
  let budgetTruncated = false;
  let budgetReason: "depth" | "calls" | undefined;
  try {
    result = withSpeculativeEvalObservability(body);
    const reasons = trial.stats().reasons;
    budgetTruncated = reasons.includes("depth") || reasons.includes("calls");
    // 守卫顺序 = cycle → depth → calls ⇒ depth 先于 calls ⇒ 两者同报时取 depth
    budgetReason = reasons.includes("depth")
      ? "depth"
      : reasons.includes("calls")
        ? "calls"
        : undefined;
  } finally {
    evalBudget = outerBudget;
    evalBudgetSessionDepth = outerSessionDepth;
  }
  if (budgetTruncated) {
    // **重新记账**（根因修复）：试算是**探针**——结果被丢弃 ⇒ 调用方回落
    // fail-closed ⇒「这次求值被预算截断」正是结果变 unknown 的原因，必须
    // 回到宿主**预算面**（budget 块 / 上屏归因）。
    //
    // 不做这一步的后果（#health-budget 单一实现）：宿主面只看到旁证的
    // cycle（探针把 depth 吞了）⇒ health 报「call cycle — not a budget
    // limit」，而同一文件 check 面报「eval depth 64/64」⇒ 两面口径分裂，
    // 且把「抬 @nudo:budget 有效」误报成「抬预算也解不开的环」。
    //
    // 计数口径：**宿主实例的生效上限**（试算的内部阈值不上屏——它既不是
    // 宿主预算，也不是用户能调的旋钮；@nudo:budget 覆盖期间取覆盖值）。
    // 诊断面（cycle vs 预算，#158）**不**动：归因由真正跑那条求值的路径
    // 上报，探针撞的是探针阈值、不是用户的预算。
    if (budgetReason) outerBudget.noteTruncation(budgetReason);
    clearPureMemo();
  }
  return { result, budgetTruncated };
}

/**
 * 进入执行会话。最外层才重置预算；嵌套（导出桥 $call → apply →
 * callTranspiledExportFull）必须继承外层深度/cycle 键/totalCalls，否则
 * 外层帧被抹掉，$callNamed 的 evalExitCall 再把 depth 打成负数。
 */
export function enterEvalCallBudgetSession(): void {
  if (evalBudgetSessionDepth === 0) {
    evalBudget.resetSession();
    // 只清 fork 预算计数（新会话拿满额度）；截断旗标/观测累计 latch 到
    // 宿主入口（#158：stats 不得与已上报诊断矛盾）
    resetEvalForkCount();
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
    ...evalBudget.getState(),
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

/** 进入命名调用：cycle/超限 → 不执行，返回 opaque（并上报截断）。
 *  $new 的宿主函数 [[Construct]] 体执行共用（Bug 16，递归构造深度守卫）。
 *  归因（#158）：cycle=同 name+arg 指纹已在栈上（预算抬不动），先于
 *  depth/calls 判定——与守卫的短路顺序一致。 */
export function evalEnterCall(name: string, fn: unknown, args: Abs[]): { ok: boolean; key?: string } {
  const key = evalCallBudgetKey(name, fn, args);
  if (evalBudget.enter(key, name) !== undefined) return { ok: false };
  return { ok: true, key };
}

export function evalExitCall(): void {
  evalBudget.exit();
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
  // @nudo:pure：宿主 JS 函数 / Abs 上的 `_memoize` 标记 → 同实参命中缓存。
  // 键取采用后实参（与执行一致）：面存在与否改变执行世界，键随之区分。
  const pureName = pureFnNameOf(fn);
  const memoEntry = pureName ? pureCallMemo.keyOf(fn, execArgs) : undefined;
  if (memoEntry) {
    const hit = pureCallMemo.get(memoEntry);
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
  // D1：调用前快照实参——mutator（pop/push）会就地改写，记录必须是入参态。
  // 同一次调用共享身份图 memo：`f(obj, obj)` 的两个实参保持别名。
  const snapshotMemo = new WeakMap<object, Abs>();
  const argsSnapshot = args.map((a) =>
    a && typeof a === "object" && "shape" in (a as object)
      ? $copy(a, snapshotMemo)
      : (a as Abs),
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
    if (memoEntry && !threw) {
      // 捕获本帧新增 throws 面（body/apply 路径的 pushThrowExit 已入帧）；
      // 命中时 routeApplyThrows 重放（只缓存 abs 会在命中时假「不抛」）。
      pureCallMemo.set(memoEntry, makeAbsApplyResult(result, joinThrowsSince(throwMark)));
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
          // 调用方帧深度（evalEnterCall 已弹栈后记录）：0 = 最外层
          // 求值帧。递归内层帧的重入记录与顶层帧同 callLoc——局部量
          // 投影（collectEnclosingFnLocals）按帧过滤，与 $nodoPos 同口径
          depth: evalBudget.depth,
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
