/**
 * 调用预算 + 截断观测（求值引擎共享面）。
 * 抽象求值对递归做展开而非不动点：参数类型每层变形（fac(n-1)）时
 * cycle key 不重复，必须靠深度/总调用数封顶。超限结果 conf=opaque。
 */
import type { Abs } from "./abs.ts";
import { abs } from "./abs.ts";
import { litKeyString, termToString } from "./term.ts";
import { predToString } from "./pred.ts";
import {
  createScopedSlot,
  registerCollectorScopeParticipant,
} from "./collector-scope.ts";

export const MAX_CALL_DEPTH = 64;
/** 与 B 命名调用（calls.ts MAX_EVAL_TOTAL_CALLS）同阀：病态展开下 200k 级不可接受 */
export const MAX_TOTAL_CALLS = 20_000;

/**
 * 调用截断归因（issue #158）：
 * - `cycle`：同 name+arg 指纹的调用已在栈上——**不是预算**，抬高
 *   `@nudo:budget` 永远解不开（数据依赖自递归在抽象层就是不动点）；
 * - `depth` / `calls`：真预算超限，`@nudo:budget` 可抬。
 */
export type AbsTruncationReason = "cycle" | "depth" | "calls";

const _fnCallIds = new WeakMap<object, string>();
let _fnCallIdSeq = 0;
/** 本轮是否发生循环迭代预算截断（#loop-iterations；与调用预算不同轴） */
let _loopTruncated = false;
/** 调用截断原因集合（A+B 经 noteAbsTruncation 单点收集；宿主入口重置） */
let _truncReasons = new Set<AbsTruncationReason>();

/**
 * 试算期截断观测静默开关：**可能被整体丢弃**的试算（见
 * {@link withSpeculativeEvalObservability}）不得在观测面留账。
 */
const truncNoteQuietSlot = createScopedSlot<boolean>(() => false);

/**
 * 循环迭代预算截断（两段 maxIters 抽象 / MAX_CONCRETE_LOOP_ITERS 硬上限
 * 仍未终止）。与调用预算不同轴：`@nudo:budget calls=/depth=` 抬不动它，
 * 不进 reasons——但计入 truncated 可观测（诊断与 budget 块不得矛盾）。
 */
export function noteLoopTruncation(label: string): void {
  if (truncNoteQuietSlot.get()) return;
  _loopTruncated = true;
  noteAbsTruncation(label);
}

/**
 * 试算期（speculative eval）观测隔离：把一次**可能被调用方丢弃**的试算
 * 对共享观测面的写入整体回滚——截断观测（collector + 原因集 + 循环/fork
 * 截断旗标）静默，fork 计数（会话计数与观测累计）恢复原值。
 *
 * 为什么必须回滚（#158）：试算被丢弃时调用方回落成「不评估」，于是签名
 * 说没算过、budget/诊断却说算到被截断——这正是 #158 禁止的自相矛盾
 * （`truncated:false` 与 `nudo:recursion-truncated` 不得共存，反之亦然）。
 * 调用预算实例由调用方自带（exec/calls.ts 的 runEvalCallBudgetTrial 换
 * 一次性实例），故本函数只管**共享**面。
 */
export function withSpeculativeEvalObservability<R>(body: () => R): R {
  const prevQuiet = truncNoteQuietSlot.get();
  const loopTruncated = _loopTruncated;
  const forkCount = _evalForkCount;
  const forkObs = _evalForkObsCount;
  const forkNoted = _evalForkTruncNoted;
  truncNoteQuietSlot.set(true);
  try {
    return body();
  } finally {
    truncNoteQuietSlot.set(prevQuiet);
    _loopTruncated = loopTruncated;
    _evalForkCount = forkCount;
    _evalForkObsCount = forkObs;
    _evalForkTruncNoted = forkNoted;
  }
}

/** 调用预算上限（@nudo:budget 可逐函数抬高；默认 = 全局常量） */
export type CallBudgetLimits = {
  maxDepth: number;
  maxCalls: number;
};

/** 预算状态机快照（A/B 两实例同形；A 上屏 callReasons，B 上屏 evalReasons） */
export type CallBudgetStats = {
  /** 进入次数（观测累计；宿主入口内跨执行会话累计）；calls 截断时 = 触发时计数（== 触发时生效上限） */
  calls: number;
  /** 当前生效上限；calls 截断时 = 触发时生效上限 */
  maxCalls: number;
  callTruncated: boolean;
  cycleTruncated: boolean;
  /** 最大进入深度；depth 截断时 = 触发时深度（== 触发时生效上限） */
  depth: number;
  /** 当前生效 depth 上限；depth 截断时 = 触发时生效上限 */
  maxDepth: number;
  /** 本实例截断原因（稳定排序） */
  reasons: AbsTruncationReason[];
};

export type CallBudget = {
  /** 当前进入深度（只读；resetSession 后归零） */
  readonly depth: number;
  /** 进入调用：cycle/超限 → 返回原因（并上报截断）；未命中 → undefined */
  enter(key: string, label: string): AbsTruncationReason | undefined;
  exit(): void;
  /** 新执行会话：只清 depth/totalCalls/activeKeys（观测累计与上限保留） */
  resetSession(): void;
  /** 观测累计清零（宿主入口） */
  resetObservability(): void;
  /** 全清：会话计数 + 观测累计 + 上限回默认 */
  reset(): void;
  getLimits(): CallBudgetLimits;
  setLimits(limits: Partial<CallBudgetLimits>): void;
  getState(): { depth: number; totalCalls: number; activeKeys: number };
  stats(): CallBudgetStats;
  /**
   * 记账一次**外部判定**的预算截断（试算探针撞 depth/calls ⇒ 调用方
   * 回落 fail-closed ⇒ 该截断就是本次求值被放弃的原因，必须回到宿主
   * 观测面）。
   *
   * 与 {@link CallBudget.enter} 的区别：enter 是**本实例自己**撞守卫时
   * 顺带记账；本方法把别处（一次性试算实例）判定的截断记到**本实例**
   * 的生效上限上——试算的内部阈值是实现细节，不得上屏（否则上屏的
   * 「depth 5/5」既不是宿主预算、也不是用户能调的旋钮）。
   *
   * 计数口径与 enter 一致：depth ⇒ 计数/上限取**本实例生效上限**
   * （`@nudo:budget` 覆盖亦如实），calls ⇒ 同理取生效 calls 上限。
   *
   * 只进**预算面**（本实例 reasons + 共享原因集），**不**触发诊断
   * collector：诊断归因（cycle vs 预算，#158）必须由真正跑那条求值的
   * 路径上报。
   */
  noteTruncation(reason: "depth" | "calls"): void;
};

/**
 * 调用预算状态机（A 抽象调用 / B 命名调用各一实例）。
 *
 * 归因顺序 = 守卫顺序（cycle 先于 depth 先于 calls）：同指纹调用已在栈上
 * 时无论预算多深都会立即截断——报 cycle 而不是预算（#158）。
 *
 * 两个计数轴：
 * - 会话计数（depth/totalCalls/activeKeys）——B 在 enterEvalCallBudgetSession
 *   最外层清零（新会话拿满额度）；
 * - 观测累计（observedCalls/截断旗标/reasons/最大深度/depth 截断现场）——
 *   会话切换**不**清，宿主入口（resetAbsCallBudget / resetEvalCallBudget）
 *   才清：stats 必须反映整个宿主入口，而不是最后一个会话。
 */
export function createCallBudget(config: CallBudgetLimits): CallBudget {
  const defaultMaxDepth = config.maxDepth;
  const defaultMaxCalls = config.maxCalls;
  let depth = 0;
  let totalCalls = 0;
  let activeKeys: string[] = [];
  let maxDepthLimit = defaultMaxDepth;
  let maxCallsLimit = defaultMaxCalls;
  // 观测累计（跨执行会话；宿主入口才清）
  let observedCalls = 0;
  let callTruncated = false;
  let cycleTruncated = false;
  const reasons = new Set<AbsTruncationReason>();
  let maxDepthSeen = 0;
  let depthTruncDepth: number | null = null;
  let depthTruncLimit: number | null = null;
  let callsTruncCalls: number | null = null;
  let callsTruncLimit: number | null = null;

  const resetSession = (): void => {
    depth = 0;
    totalCalls = 0;
    activeKeys = [];
  };
  const resetObservability = (): void => {
    observedCalls = 0;
    callTruncated = false;
    cycleTruncated = false;
    reasons.clear();
    maxDepthSeen = 0;
    depthTruncDepth = null;
    depthTruncLimit = null;
    callsTruncCalls = null;
    callsTruncLimit = null;
  };

  return {
    get depth(): number {
      return depth;
    },
    enter(key: string, label: string): AbsTruncationReason | undefined {
      const reason: AbsTruncationReason | undefined = activeKeys.includes(key)
        ? "cycle"
        : depth >= maxDepthLimit
          ? "depth"
          : totalCalls >= maxCallsLimit
            ? "calls"
            : undefined;
      if (reason) {
        callTruncated = true;
        reasons.add(reason);
        if (reason === "cycle") cycleTruncated = true;
        // depth 截断现场（首次）：depth 计数上屏必须用触发时的深度/上限对，
        // 否则 @nudo:budget 覆盖期间触发、恢复后快照会显示「未到顶」
        if (reason === "depth" && depthTruncDepth === null) {
          depthTruncDepth = depth;
          depthTruncLimit = maxDepthLimit;
        }
        // calls 截断现场（首次）：同上——calls 计数上屏必须用触发时的
        // 计数/上限对（未到顶却标 truncated 是自相矛盾）
        if (reason === "calls" && callsTruncCalls === null) {
          callsTruncCalls = totalCalls;
          callsTruncLimit = maxCallsLimit;
        }
        noteAbsTruncation(label, reason);
        return reason;
      }
      activeKeys.push(key);
      depth++;
      if (depth > maxDepthSeen) maxDepthSeen = depth;
      totalCalls++;
      observedCalls++;
      return undefined;
    },
    exit(): void {
      // 禁止负数：嵌套 reset 后 exit 会把 depth 打穿
      if (depth > 0) depth--;
      if (activeKeys.length > 0) activeKeys.pop();
    },
    resetSession,
    resetObservability,
    reset(): void {
      resetSession();
      resetObservability();
      maxDepthLimit = defaultMaxDepth;
      maxCallsLimit = defaultMaxCalls;
    },
    getLimits: () => ({ maxDepth: maxDepthLimit, maxCalls: maxCallsLimit }),
    setLimits(limits: Partial<CallBudgetLimits>): void {
      if (typeof limits.maxDepth === "number") maxDepthLimit = limits.maxDepth;
      if (typeof limits.maxCalls === "number") maxCallsLimit = limits.maxCalls;
    },
    getState: () => ({ depth, totalCalls, activeKeys: activeKeys.length }),
    noteTruncation: (reason: "depth" | "calls"): void => {
      // 外部判定（试算探针）的截断记到**本实例的生效上限**上：试算的内部
      // 阈值（探针深度/调用上限）是实现细节，不是宿主预算，也不是用户能
      // 调的旋钮——上屏必须是「宿主预算被撞满」这一事实（@nudo:budget
      // 覆盖期间亦取覆盖后的生效上限）。
      //
      // 只进**预算面**（本实例的 reasons + 共享原因集）：诊断归因（cycle vs
      // 预算，#158）由真正跑那条求值的路径上报——探针撞的是**探针阈值**，
      // 把它说成「用户的预算被撞满」会把 cycle 归因误报成「抬预算可解」。
      callTruncated = true;
      reasons.add(reason);
      if (reason === "depth" && depthTruncDepth === null) {
        depthTruncDepth = maxDepthLimit;
        depthTruncLimit = maxDepthLimit;
      }
      if (reason === "calls" && callsTruncCalls === null) {
        callsTruncCalls = maxCallsLimit;
        callsTruncLimit = maxCallsLimit;
      }
      recordTruncReason(reason);
    },
    stats: () => ({
      calls: callsTruncCalls ?? observedCalls,
      maxCalls: callsTruncLimit ?? maxCallsLimit,
      callTruncated,
      cycleTruncated,
      depth: depthTruncDepth ?? maxDepthSeen,
      maxDepth: depthTruncLimit ?? maxDepthLimit,
      reasons: [...reasons].sort(),
    }),
  };
}

/** A 路径（抽象调用 enterCall）预算实例 */
const _aBudget = createCallBudget({
  maxDepth: MAX_CALL_DEPTH,
  maxCalls: MAX_TOTAL_CALLS,
});

/** A2：预算/截断快照（check --json / health 上屏） */
export type AbsBudgetStats = {
  calls: number;
  maxCalls: number;
  forks: number;
  maxForks: number;
  callTruncated: boolean;
  forkTruncated: boolean;
  /** 任一预算截断 → true（结果可能已 widen 成 unknown） */
  truncated: boolean;
  /** B 命名调用（exec $callNamed）累计进入次数——宿主入口内跨执行会话累计 */
  evalCalls: number;
  /** B 命名调用当前生效上限 */
  maxEvalCalls: number;
  /** B 命名调用发生截断（cycle/depth/calls 任一） */
  evalCallTruncated: boolean;
  /** 任一路径的 cycle 截断（预算抬不动的那类；issue #158） */
  cycleTruncated: boolean;
  /** 循环迭代预算截断（#loop-iterations；maxIters/硬上限，非调用预算） */
  loopTruncated: boolean;
  /** 调用截断原因集合（A+B；稳定排序，进 JSON） */
  reasons: AbsTruncationReason[];
  /** A 路径（enterCall 抽象调用）本轮截断原因——上屏归因用（与合并集 reasons 分流） */
  callReasons: AbsTruncationReason[];
  /** A 路径最大进入深度；depth 截断时 = 触发时深度（== 触发时生效上限） */
  depth: number;
  /** A 路径 depth 上限；depth 截断时 = 触发时生效上限（@nudo:budget 覆盖亦如实） */
  maxDepth: number;
  /** B 路径（$callNamed 求值调用）本轮截断原因 */
  evalReasons: AbsTruncationReason[];
  /** B 路径最大进入深度；depth 截断时 = 触发时深度（== 触发时生效上限） */
  evalDepth: number;
  /** B 路径 depth 上限；depth 截断时 = 触发时生效上限（@nudo:budget 覆盖亦如实） */
  maxEvalDepth: number;
};

/**
 * B 命名调用预算可观测探针（issue #158）：B 路径的预算实例住在 exec/calls.ts
 * （call-budget 不能反向 import exec 模块 → 注册式），模块加载时注册；
 * `getAbsCallBudgetStats` 合并、`resetAbsCallBudget` 联动重置。
 */
export type EvalCallBudgetProbe = {
  stats(): CallBudgetStats;
  resetObservability(): void;
};

let _evalCallProbe: EvalCallBudgetProbe | null = null;

export function registerEvalCallBudgetProbe(probe: EvalCallBudgetProbe | null): void {
  _evalCallProbe = probe;
}

export function getAbsCallBudgetStats(): AbsBudgetStats {
  const b = _evalCallProbe?.stats();
  const a = _aBudget.stats();
  return {
    calls: a.calls,
    maxCalls: a.maxCalls,
    forks: _evalForkObsCount,
    maxForks: _evalForkBudgetLimit,
    callTruncated: a.callTruncated,
    forkTruncated: _evalForkTruncNoted,
    truncated: a.callTruncated || (b?.callTruncated ?? false) || _evalForkTruncNoted || _loopTruncated,
    evalCalls: b?.calls ?? 0,
    maxEvalCalls: b?.maxCalls ?? MAX_TOTAL_CALLS,
    evalCallTruncated: b?.callTruncated ?? false,
    cycleTruncated: a.cycleTruncated || (b?.cycleTruncated ?? false),
    loopTruncated: _loopTruncated,
    reasons: [..._truncReasons].sort(),
    callReasons: a.reasons,
    depth: a.depth,
    maxDepth: a.maxDepth,
    evalReasons: b?.reasons ?? [],
    evalDepth: b?.depth ?? 0,
    maxEvalDepth: b?.maxDepth ?? MAX_CALL_DEPTH,
  };
}

/** 宿主入口（runTranspiled / callTranspiledExportFull / check）前重置 */
export function resetAbsCallBudget(): void {
  _aBudget.reset();
  _loopTruncated = false;
  _truncReasons = new Set();
  // B 观测累计同轮生命周期（截断旗标跨执行会话 latch，宿主入口统一清）
  _evalCallProbe?.resetObservability();
  resetEvalForkBudget();
}

/**
 * 函数级预算覆盖（`@nudo:budget`）：在 fn 期间抬高 depth/calls/forks 上限。
 * 返回 restore 回调（恢复先前值）。非法值忽略对应维。
 */
export function withFnBudgetOverride(
  budget: { depth?: number; calls?: number; forks?: number },
  run: () => void,
): void {
  const prev = _aBudget.getLimits();
  const prevForks = _evalForkBudgetLimit;
  if (typeof budget.depth === "number" && Number.isFinite(budget.depth) && budget.depth >= 1) {
    _aBudget.setLimits({ maxDepth: Math.floor(budget.depth) });
  }
  if (typeof budget.calls === "number" && Number.isFinite(budget.calls) && budget.calls >= 1) {
    _aBudget.setLimits({ maxCalls: Math.floor(budget.calls) });
  }
  if (typeof budget.forks === "number" && Number.isFinite(budget.forks) && budget.forks >= 1) {
    setEvalForkBudgetLimit(Math.floor(budget.forks));
  }
  try {
    run();
  } finally {
    _aBudget.setLimits(prev);
    setEvalForkBudgetLimit(prevForks);
  }
}

export function stableCallId(obj: object): string {
  let id = _fnCallIds.get(obj);
  if (id === undefined) {
    id = `#${++_fnCallIdSeq}`;
    _fnCallIds.set(obj, id);
  }
  return id;
}

/**
 * 截断结果：分析无信息，conf=opaque。
 * shape=unknown 表示「没有可计算面」，但 **不是** nudo:unknown-inference
 * （那是真推导失败）——截断走 nudo:recursion-truncated / fork-truncated。
 */
export function truncatedAbs(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

/** @nudo:pure 记忆化通道的 kind（callBudgetKey 的分流标记） */
const PURE_MEMO_KEY_KIND = "pure";

/** 调用指纹：命名函数用 name+arg shapes；一等函数用对象身份。
 *  实参可能是裸 JS 值（B run 里模块函数作实参）——不得裸读 shape。
 *
 * ⚠ **两种口径**（勿混用，勿互相替代）：
 * - 本函数 = **调用身份**键（shape 种类 + term 的**变量身份**）⇒ 服务
 *   **调用预算 / 环检测**：同一递归点必须撞出同键（term 相同 ⇒ 同键）。
 * - pureValueKey = **值**键（形状内容 + 字面量值）⇒ 服务 **@nudo:pure
 *   记忆化**：按**值**承诺 ⇒ 同值必须同键（变量身份不同但值相同 ⇒ 同键）。
 *
 * @nudo:pure 记忆化通道（kind = "pure" 且 id 为空）在此**分流**到值
 * 基键：记忆化键若带**变量身份**，同一变量重绑定为不同值后仍命中旧缓存
 * ⇒ **陈旧结果**（Bug 281）。预算/环检测通道（kind = absfn / absbody /
 * coerce-hook / 命名调用名，且 id 非空）**口径不变**。
 * pure memo 本体（exec/pure-memo.ts）直接调用 pureValueKey；本分支保留为
 * callBudgetKey 的既有对外语义（同一值基承诺），不改调用方行为。
 */
export function callBudgetKey(kind: string, id: string, args: unknown[]): string {
  if (kind === PURE_MEMO_KEY_KIND && id === "") {
    // 不可比较的实参 ⇒ 每次调用一个**新**键 ⇒ 永不命中（宁可不算命中，
    // 也不能算出错误的命中——错误的命中 = 陈旧值 = Bug 281 的根因）
    return pureValueKey(args) ?? `${PURE_MEMO_KEY_KIND}v|uncomparable|${++_pureValueOpaqueSeq}`;
  }
  const parts = args.map((a) => {
    const sh = (a as { shape?: { k?: string }; term?: never } | null | undefined)?.shape;
    if (!sh) return `js:${typeof a}`;
    const t = (a as { term?: never }).term ? termToString((a as { term: never }).term) : "";
    return `${sh.k}:${t}`;
  });
  return `${kind}|${id}|${parts.join(",")}`;
}

/** 值基键的展开上限（防病态对象图无限展开：内存 / 超时） */
const PURE_VALUE_MAX_DEPTH = 8;
const PURE_VALUE_MAX_NODES = 256;

/** 不可比较实参的序号（每次调用一个新键 ⇒ 永不命中） */
let _pureValueOpaqueSeq = 0;

/**
 * @nudo:pure 记忆化的**值基**键（Bug 281）。
 *
 * 与 callBudgetKey 的口径**不同**（见 callBudgetKey 的注释）：
 * - callBudgetKey = **调用身份**（term 的变量身份）⇒ 预算 / 环检测；
 * - 本函数 = **值**（形状内容 + 字面量值）⇒ 记忆化（按值承诺）。
 *
 * 旧实现（pureMemoKey = callBudgetKey("pure", "", args)）把**变量身份**
 * 当记忆化键 ⇒ 同一变量重绑定为不同值后仍命中旧缓存 ⇒ 陈旧结果。
 *
 * 返回 `undefined` = **实参不可比较** ⇒ 调用方**不得缓存**：宁可不算
 * 命中，也不能算出**错误的命中**（错误的命中 = 陈旧值 = 本条 bug 根因）。
 */
export function pureValueKey(args: unknown[]): string | undefined {
  const ctx: PureValueCtx = { path: new Set<object>(), nodes: 0 };
  const parts: string[] = [];
  for (const a of args) {
    if (!a || typeof a !== "object" || !("shape" in (a as object))) {
      // 裸 JS 实参（宿主值）：不可比较
      return undefined;
    }
    const vk = pureValueKeyOf(a as Abs, 0, ctx);
    if (vk === undefined) return undefined;
    parts.push(vk);
  }
  return `purev|${parts.join(";")}`;
}

type PureValueCtx = {
  /** 当前路径上的 Abs（环检测：同一 Abs 出现在路径上 ⇒ 值不可判） */
  path: Set<object>;
  /** 已展开节点数（预算） */
  nodes: number;
};

/**
 * 项身份片段（只给**值不可判**的形状用：unknown / any / never）。
 *
 * 这三个形状的 denotation 是「全体」⇒ 值本身不可判 ⇒ 只能按**项身份**
 * 区分（保守：只有同一项才可能同结果）。无项时（引擎的 unknown 令牌）
 * ⇒ 空片段 ⇒ 同一抽象值 ⇒ 可命中（既有语义不变）。
 */
function termPart(t: Abs["term"]): string {
  if (!t) return "";
  return `:V:${termToString(t)}`;
}

/**
 * Abs ⇒ 值基键片段；**不可比较**时返回 undefined（不猜）。
 *
 * 判据（保守优先）：只有**值可判**的 Abs 才进键；不可判的一律退路
 * （不命中）——宁可不算命中，也不能算出错误的命中。
 */
function pureValueKeyOf(a: Abs, depth: number, ctx: PureValueCtx): string | undefined {
  if (depth > PURE_VALUE_MAX_DEPTH) return undefined;
  if (++ctx.nodes > PURE_VALUE_MAX_NODES) return undefined;
  const id = a as unknown as object;
  if (ctx.path.has(id)) return undefined; // 环：值不可判
  ctx.path.add(id);
  try {
    return pureValueKeyInner(a, depth, ctx);
  } finally {
    ctx.path.delete(id);
  }
}

function pureValueKeyInner(a: Abs, depth: number, ctx: PureValueCtx): string | undefined {
  const conf = a.conf;
  const pred = a.pred ? predToString(a.pred) : "";
  const t = a.term;
  // ① 字面量项：值就是字面量本身（-0 与 0 分开、bigint 带 n、NaN 天然区分）
  if (t && t.op === "lit") {
    const v = t.value;
    const ty = typeof v;
    // symbol / 对象 / 函数不是可比较的字面量：两个不同的 Symbol("a") 的
    // String() 相同 ⇒ 按内容比会撞出**错误的命中** ⇒ 退路（不缓存）
    if (ty === "symbol" || ty === "function" || (ty === "object" && v !== null)) return undefined;
    return `lit:${ty}:${litKeyString(v)}|${pred}|${conf}`;
  }
  switch (a.shape.k) {
    case "never":
      return `never${termPart(t)}|${pred}|${conf}`;
    case "any":
      return `any${termPart(t)}|${pred}|${conf}`;
    case "unknown":
      // unknown / any 的**值**不可判（denotation = 全体）⇒ 只能按项身份
      // 区分（保守：同项才可能同结果）。无项时（引擎的 unknown 令牌）⇒
      // 同一抽象值 ⇒ 可命中（既有语义不变）。
      return `unknown${termPart(t)}|${pred}|${conf}`;
    case "prim":
      // 非字面量项的 prim：值不可判（var 项只是**变量身份**，且结果会带
      // 该项 ⇒ 跨 id 命中会把**项**串到别的变量上）
      return undefined;
    case "obj": {
      const s = a.shape;
      // 开放对象：额外属性不可判 ⇒ 值不可判
      if (s.open) return undefined;
      const parts: string[] = [];
      for (const k of Object.keys(s.slots).sort()) {
        const slot = s.slots[k]!;
        const vk = pureValueKeyOf(slot.value, depth + 1, ctx);
        if (vk === undefined) return undefined;
        const flags = `${slot.optional ? "?" : ""}${slot.readonly ? "r" : ""}${slot.internal ? "i" : ""}${slot.symbolKey ? "s" : ""}${slot.inherited ? "h" : ""}`;
        parts.push(`${k}${flags}=${vk}`);
      }
      if (s.index) {
        const kk = pureValueKeyOf(s.index.key, depth + 1, ctx);
        const vv = pureValueKeyOf(s.index.value, depth + 1, ctx);
        if (kk === undefined || vv === undefined) return undefined;
        parts.push(`idx=${kk}=>${vv}`);
      }
      // **不含 a.term**：对象的值在槽里，term 是**变量身份**（Bug 281 根因）
      return `obj{${parts.join(",")}}|${pred}|${conf}`;
    }
    case "tuple": {
      const s = a.shape;
      const parts: string[] = [];
      for (const el of s.elements) {
        const vk = pureValueKeyOf(el, depth + 1, ctx);
        if (vk === undefined) return undefined;
        parts.push(vk);
      }
      let rest = "";
      if (s.rest) {
        const vk = pureValueKeyOf(s.rest, depth + 1, ctx);
        if (vk === undefined) return undefined;
        rest = `...${vk}`;
      }
      const holes =
        s.holes && s.holes.length > 0 ? `holes=${[...s.holes].sort((x, y) => x - y).join(".")}` : "";
      return `tup[${parts.join(",")}]${rest}${holes}|${pred}|${conf}`;
    }
    case "sum": {
      const parts: string[] = [];
      for (const m of a.shape.members) {
        const vk = pureValueKeyOf(m, depth + 1, ctx);
        if (vk === undefined) return undefined;
        parts.push(vk);
      }
      return `sum[${parts.join("|")}]|${pred}|${conf}`;
    }
    case "arr":
      // 长度未知 ⇒ 两个同元素域的数组值仍可能不同（元素个数不同）
      return undefined;
    case "fn":
      // 函数值 = 身份 ⇒ 不可比
      return undefined;
    case "brand":
      // 类实例：可变态 + 身份语义 ⇒ 不按内容比
      return undefined;
    case "eff":
      // promise / generator：有状态 ⇒ 不可比
      return undefined;
  }
}

/** 截断观测 collector（作用域化：runWithCollectorScope 内各分析互不串台；
 *  无作用域 = fallback 模块级单变量，行为同今日）。
 *  reason 只对调用截断（A enterCall / B evalEnterCall）非空——cycle 与
 *  depth/calls 分流是 #158 的观测面。 */
const absTruncCollectorSlot = createScopedSlot<
  ((fnLabel: string, reason?: AbsTruncationReason) => void) | null
>(() => null);
registerCollectorScopeParticipant((body) => absTruncCollectorSlot.runScoped(body));

/** 记录被截断的递归（service 可映射为 nudo:recursion-truncated）。
 *  返回先前 collector，便于嵌套 save/restore。 */
export function setAbsTruncationCollector(
  collector: ((fnLabel: string, reason?: AbsTruncationReason) => void) | null,
): ((fnLabel: string, reason?: AbsTruncationReason) => void) | null {
  const prev = absTruncCollectorSlot.get();
  absTruncCollectorSlot.set(collector);
  return prev;
}

/**
 * 记录截断原因到**共享原因集**（A+B 合并；上屏 JSON 的 `reasons`）。
 *
 * 与 {@link noteAbsTruncation} 的区别：**不**触发诊断 collector——诊断通道
 * 回答的是「这个函数的求值为什么被放弃」（cycle=抬预算解不开，#158），
 * 归因必须由**真正跑那条求值的路径**上报；外部判定（例如试算探针撞了
 * 探针阈值）只进**预算面**，不得改写诊断归因。
 */
function recordTruncReason(reason: AbsTruncationReason): void {
  // 试算期静默：结果可能被丢弃，不得在观测面留账（见 withSpeculativeEvalObservability）
  if (truncNoteQuietSlot.get()) return;
  _truncReasons.add(reason);
}

export function noteAbsTruncation(label: string, reason?: AbsTruncationReason): void {
  // 试算期静默：结果可能被丢弃，不得在观测面留账（见 withSpeculativeEvalObservability）
  if (truncNoteQuietSlot.get()) return;
  if (reason) _truncReasons.add(reason);
  const absTruncCollector = absTruncCollectorSlot.get();
  if (!absTruncCollector) return;
  try {
    absTruncCollector(label, reason);
  } catch {
    /* collector 不得打断求值 */
  }
}

/** 进入调用：cycle/超限则不执行 body，返回 opaque。
 *  归因顺序 = 守卫顺序（本状态机内）：同指纹调用已在栈上时无论预算多深
 *  都会立即截断——报 cycle 而不是预算（#158）。 */
export function enterCall(key: string, label: string): boolean {
  return _aBudget.enter(key, label) === undefined;
}

export function exitCall(): void {
  _aBudget.exit();
}

// --- B $fork 总次数预算 -------------------------------------------------------
/**
 * 为什么是「总次数」而不是「深度」：
 * - 415d3ea 惰性化后单次 fork（集合 overlay / Φ 臂包裹）零堆分配、~0.15µs，
 *   **单次已经便宜**；病态输入（lodash `_baseFlatten`：递归×循环）炸的是
 *   **fork 次数本身**，不是嵌套深度——浅而宽的展开同样失控。
 * - 与 MAX_TOTAL_CALLS 的分工：调用预算管「函数进入次数」（命名调用 /
 *   递归展开），管不到 if/?:/&& 语义在 $fork 上的分支展开；两者独立计数、
 *   独立封顶，任一超限都 fail-closed 成 unknown。
 *
 * 默认 5000：monorepo 语料（含 core/service 全量测试与 check 金门）下
 * 正常函数远低于此；病态递归×循环能在秒级内兜住（对照 MAX_EVAL_TOTAL_CALLS
 * 从 200k 收到 20k 的先例）。可经 setEvalForkBudgetLimit / env NUDO_MAX_FORKS /
 * package.json#nudo.analysis.maxForks 调节。
 */
export const MAX_EVAL_TOTAL_FORKS = 5000;

let _evalForkBudgetLimit = MAX_EVAL_TOTAL_FORKS;
let _evalForkCount = 0;
/** 宿主入口内跨 B 执行会话累计的 fork 次数（观测口径；会话预算计数 _evalForkCount
 *  每会话清零，stats 上屏必须反映整轮宿主入口而不是最后一个会话） */
let _evalForkObsCount = 0;
/** 本轮是否已上报过 fork 截断（避免 collector 被同一轮刷屏） */
let _evalForkTruncNoted = false;

/**
 * 专用标签：fork 截断不是「某个递归函数被截断」，不能复用函数名 label
 * （否则 check 会误报 nudo:recursion-truncated）。service/check 按此标签
 * 映射为 `nudo:fork-truncated`（info —— 预算观测，非质量失败）。
 */
export const FORK_TRUNCATION_LABEL = "#fork-budget";

/**
 * 宿主副作用未执行标签前缀：网络/定时器全局（fetch/setTimeout…）在分析期
 * 不真实执行（Abs 实参喂原生实现会真发请求/真排定时器，且可能崩进程），
 * fail-closed 为 unknown#opaque。专用前缀让 check 映射为
 * `nudo:host-effect-blocked`，不复用「某函数被截断」文案。
 */
export const HOST_EFFECT_LABEL_PREFIX = "#host-effect:";

/** promise 微队列溢出标签（队列硬上限丢弃；check 映射，避免误报 recursion-truncated） */
export const PROMISE_MICRO_OVERFLOW_LABEL = "#promise-micro-overflow";
/** promise 微任务 drain 抛错标签（不得静默吞掉） */
export const PROMISE_MICRO_ERROR_LABEL = "#promise-micro-error";
/** Math 原生折叠抛错标签（宿主篡改/环境分叉的 Math.*；结果拓宽为 number 不得无观测） */
export const MATH_FOLD_ERROR_LABEL = "#math-fold-error";

/** 宿主副作用未执行观测（service/LSP 映射 nudo:host-effect-blocked；与调用截断同 collector 管道） */
export function noteHostEffectBlocked(name: string): void {
  noteAbsTruncation(`${HOST_EFFECT_LABEL_PREFIX}${name}`);
}

/** fork 超限观测（service/LSP 映射 nudo:fork-truncated；与调用截断同 collector 管道） */
export function noteEvalForkTruncation(): void {
  noteAbsTruncation(FORK_TRUNCATION_LABEL);
}

/**
 * 调整 fork 总次数上限。约定：n ≥ 1 的有限整数才生效（向下取整）；
 * 非法值（0 / 负数 / NaN / Infinity / 非数）回默认 MAX_EVAL_TOTAL_FORKS。
 * 返回实际生效值。core 无 IO——env/package.json 由 service 读取后 set 进来。
 */
export function setEvalForkBudgetLimit(n: number): number {
  if (typeof n === "number" && Number.isFinite(n) && n >= 1) {
    _evalForkBudgetLimit = Math.floor(n);
  } else {
    _evalForkBudgetLimit = MAX_EVAL_TOTAL_FORKS;
  }
  return _evalForkBudgetLimit;
}

export function getEvalForkBudgetLimit(): number {
  return _evalForkBudgetLimit;
}

export function getEvalForkCount(): number {
  return _evalForkCount;
}

/** 会话边界（enterEvalCallBudgetSession）只清预算计数：新执行会话拿满额度；
 *  截断旗标 latch 到宿主入口（resetEvalForkBudget），否则 stats 会与已上报的
 *  nudo:fork-truncated 自相矛盾（#158 同族）。 */
export function resetEvalForkCount(): void {
  _evalForkCount = 0;
}

/** 宿主入口前重置 fork 计数（与 resetAbsCallBudget / resetEvalCallBudget 同口径） */
export function resetEvalForkBudget(): void {
  resetEvalForkCount();
  _evalForkTruncNoted = false;
  _evalForkObsCount = 0;
}

/** $fork 入口：超限放弃该分支（调用方返回 unknown = 最保守，安全）。 */
export function bumpEvalForkBudget(): boolean {
  // 观测口径 = 尝试次数（与预算计数同 ++，可超 maxForks——超限量本身就是信号）
  _evalForkObsCount++;
  if (++_evalForkCount <= _evalForkBudgetLimit) return true;
  if (!_evalForkTruncNoted) {
    _evalForkTruncNoted = true;
    noteEvalForkTruncation();
  }
  return false;
}
