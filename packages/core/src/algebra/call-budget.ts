/**
 * 调用预算 + 截断观测（求值引擎共享面）。
 * 抽象求值对递归做展开而非不动点：参数类型每层变形（fac(n-1)）时
 * cycle key 不重复，必须靠深度/总调用数封顶。超限结果 conf=opaque。
 */
import type { Abs } from "./abs.ts";
import { abs } from "./abs.ts";
import { termToString } from "./term.ts";
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

let _absCallDepth = 0;
let _absTotalCalls = 0;
let _activeCallKeys: string[] = [];
const _fnCallIds = new WeakMap<object, string>();
let _fnCallIdSeq = 0;
/** 本轮是否发生调用预算截断（A2 可观测） */
let _callTruncated = false;
/** 本轮 A 路径是否发生 cycle 截断（cycle ≠ 预算；与 B 探针结果 OR） */
let _cycleTruncated = false;
/** 本轮是否发生循环迭代预算截断（#loop-iterations；与调用预算不同轴） */
let _loopTruncated = false;
/** 调用截断原因集合（A+B 经 noteAbsTruncation 单点收集；宿主入口重置） */
let _truncReasons = new Set<AbsTruncationReason>();
/** A 路径（enterCall）本轮截断原因——与 B 探针 reasons 分流：上屏归因要指到具体预算 */
const _aTruncReasons = new Set<AbsTruncationReason>();
/** A 路径本轮最大进入深度 */
let _absMaxDepth = 0;
/** A 路径 depth 截断现场（首次触发时的深度与当时生效上限——@nudo:budget 覆盖期间
 *  触发时，快照上限必须取现场值，否则 depth 计数会与已恢复的全局上限错位） */
let _absDepthTruncDepth: number | null = null;
let _absDepthTruncLimit: number | null = null;

/**
 * 循环迭代预算截断（两段 maxIters 抽象 / MAX_CONCRETE_LOOP_ITERS 硬上限
 * 仍未终止）。与调用预算不同轴：`@nudo:budget calls=/depth=` 抬不动它，
 * 不进 reasons——但计入 truncated 可观测（诊断与 budget 块不得矛盾）。
 */
export function noteLoopTruncation(label: string): void {
  _loopTruncated = true;
  noteAbsTruncation(label);
}
/** 当前生效的调用预算（@nudo:budget 可逐函数抬高；默认 = 全局常量） */
let _callDepthLimit = MAX_CALL_DEPTH;
let _totalCallsLimit = MAX_TOTAL_CALLS;

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
 * B 命名调用预算可观测探针（issue #158）：exec/calls.ts 的计数/旗标住在
 * calls.ts（反向 import call-budget 破环不可静态引用），模块加载时注册，
 * `getAbsCallBudgetStats` 合并、`resetAbsCallBudget` 联动重置。
 */
export type EvalCallBudgetProbe = {
  stats(): {
    calls: number;
    maxCalls: number;
    callTruncated: boolean;
    cycleTruncated: boolean;
    /** B 路径最大进入深度；depth 截断时 = 触发时深度 */
    depth: number;
    /** B 路径 depth 上限；depth 截断时 = 触发时生效上限 */
    maxDepth: number;
    /** B 路径本轮截断原因（A/B 分流归因） */
    reasons: AbsTruncationReason[];
  };
  resetObservability(): void;
};

let _evalCallProbe: EvalCallBudgetProbe | null = null;

export function registerEvalCallBudgetProbe(probe: EvalCallBudgetProbe | null): void {
  _evalCallProbe = probe;
}

export function getAbsCallBudgetStats(): AbsBudgetStats {
  const b = _evalCallProbe?.stats();
  return {
    calls: _absTotalCalls,
    maxCalls: _totalCallsLimit,
    forks: _evalForkObsCount,
    maxForks: _evalForkBudgetLimit,
    callTruncated: _callTruncated,
    forkTruncated: _evalForkTruncNoted,
    truncated:
      _callTruncated || (b?.callTruncated ?? false) || _evalForkTruncNoted || _loopTruncated,
    evalCalls: b?.calls ?? 0,
    maxEvalCalls: b?.maxCalls ?? MAX_TOTAL_CALLS,
    evalCallTruncated: b?.callTruncated ?? false,
    cycleTruncated: _cycleTruncated || (b?.cycleTruncated ?? false),
    loopTruncated: _loopTruncated,
    reasons: [..._truncReasons].sort(),
    callReasons: [..._aTruncReasons].sort(),
    depth: _absDepthTruncDepth ?? _absMaxDepth,
    maxDepth: _absDepthTruncLimit ?? _callDepthLimit,
    evalReasons: [...(b?.reasons ?? [])].sort(),
    evalDepth: b?.depth ?? 0,
    maxEvalDepth: b?.maxDepth ?? MAX_CALL_DEPTH,
  };
}

/** 宿主入口（runTranspiled / callTranspiledExportFull / check）前重置 */
export function resetAbsCallBudget(): void {
  _absCallDepth = 0;
  _absTotalCalls = 0;
  _activeCallKeys = [];
  _callTruncated = false;
  _cycleTruncated = false;
  _loopTruncated = false;
  _truncReasons = new Set();
  _aTruncReasons.clear();
  _absMaxDepth = 0;
  _absDepthTruncDepth = null;
  _absDepthTruncLimit = null;
  _callDepthLimit = MAX_CALL_DEPTH;
  _totalCallsLimit = MAX_TOTAL_CALLS;
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
  const prevDepth = _callDepthLimit;
  const prevCalls = _totalCallsLimit;
  const prevForks = _evalForkBudgetLimit;
  if (typeof budget.depth === "number" && Number.isFinite(budget.depth) && budget.depth >= 1) {
    _callDepthLimit = Math.floor(budget.depth);
  }
  if (typeof budget.calls === "number" && Number.isFinite(budget.calls) && budget.calls >= 1) {
    _totalCallsLimit = Math.floor(budget.calls);
  }
  if (typeof budget.forks === "number" && Number.isFinite(budget.forks) && budget.forks >= 1) {
    setEvalForkBudgetLimit(Math.floor(budget.forks));
  }
  try {
    run();
  } finally {
    _callDepthLimit = prevDepth;
    _totalCallsLimit = prevCalls;
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

/** 调用指纹：命名函数用 name+arg shapes；一等函数用对象身份。
 *  实参可能是裸 JS 值（B run 里模块函数作实参）——不得裸读 shape。 */
export function callBudgetKey(kind: string, id: string, args: unknown[]): string {
  const parts = args.map((a) => {
    const sh = (a as { shape?: { k?: string }; term?: never } | null | undefined)?.shape;
    if (!sh) return `js:${typeof a}`;
    const t = (a as { term?: never }).term ? termToString((a as { term: never }).term) : "";
    return `${sh.k}:${t}`;
  });
  return `${kind}|${id}|${parts.join(",")}`;
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

export function noteAbsTruncation(label: string, reason?: AbsTruncationReason): void {
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
 *  归因顺序 = 守卫顺序（cycle 先于 depth 先于 calls）：同指纹调用已在栈上
 *  时无论预算多深都会立即截断——报 cycle 而不是预算（#158）。 */
export function enterCall(key: string, label: string): boolean {
  const reason: AbsTruncationReason | undefined = _activeCallKeys.includes(key)
    ? "cycle"
    : _absCallDepth >= _callDepthLimit
      ? "depth"
      : _absTotalCalls >= _totalCallsLimit
        ? "calls"
        : undefined;
  if (reason) {
    _callTruncated = true;
    _aTruncReasons.add(reason);
    if (reason === "cycle") _cycleTruncated = true;
    // depth 截断现场（首次）：depth 计数上屏必须用触发时的深度/上限对，
    // 否则 @nudo:budget 覆盖期间触发、恢复后快照会显示「未到顶」
    if (reason === "depth" && _absDepthTruncDepth === null) {
      _absDepthTruncDepth = _absCallDepth;
      _absDepthTruncLimit = _callDepthLimit;
    }
    noteAbsTruncation(label, reason);
    return false;
  }
  _activeCallKeys.push(key);
  _absCallDepth++;
  if (_absCallDepth > _absMaxDepth) _absMaxDepth = _absCallDepth;
  _absTotalCalls++;
  return true;
}

export function exitCall(): void {
  // 禁止负数：嵌套 reset 后 exit 会把 depth 打穿
  if (_absCallDepth > 0) _absCallDepth--;
  if (_activeCallKeys.length > 0) _activeCallKeys.pop();
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
 * 映射为 `nudo:fork-truncated`（warning）。
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
