/**
 * 调用预算 + 截断观测（ast-eval 执行器删除后保留的共享面）。
 * 抽象求值对递归做展开而非不动点：参数类型每层变形（fac(n-1)）时
 * cycle key 不重复，必须靠深度/总调用数封顶。超限结果 conf=opaque。
 */
import type { Abs } from "./abs.ts";
import { abs } from "./abs.ts";
import { termToString } from "./term.ts";

export const MAX_CALL_DEPTH = 64;
/** 与 B 命名调用（calls.ts MAX_B_TOTAL_CALLS）同阀：病态展开下 200k 级不可接受 */
export const MAX_TOTAL_CALLS = 20_000;

let _absCallDepth = 0;
let _absTotalCalls = 0;
let _activeCallKeys: string[] = [];
const _fnCallIds = new WeakMap<object, string>();
let _fnCallIdSeq = 0;
/** 本轮是否发生调用预算截断（A2 可观测） */
let _callTruncated = false;

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
};

export function getAbsCallBudgetStats(): AbsBudgetStats {
  return {
    calls: _absTotalCalls,
    maxCalls: MAX_TOTAL_CALLS,
    forks: _bForkCount,
    maxForks: _bForkBudgetLimit,
    callTruncated: _callTruncated,
    forkTruncated: _bForkTruncNoted,
    truncated: _callTruncated || _bForkTruncNoted,
  };
}

/** 宿主入口（runTranspiled / callTranspiledExportFull / check）前重置 */
export function resetAbsCallBudget(): void {
  _absCallDepth = 0;
  _absTotalCalls = 0;
  _activeCallKeys = [];
  _callTruncated = false;
  resetBForkBudget();
}

export function stableCallId(obj: object): string {
  let id = _fnCallIds.get(obj);
  if (id === undefined) {
    id = `#${++_fnCallIdSeq}`;
    _fnCallIds.set(obj, id);
  }
  return id;
}

/** 截断结果：分析无信息，conf=opaque（不是 any） */
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

let absTruncCollector: ((fnLabel: string) => void) | null = null;

/** 记录被截断的递归（service 可映射为 nudo:recursion-truncated）。
 *  返回先前 collector，便于嵌套 save/restore。 */
export function setAbsTruncationCollector(
  collector: ((fnLabel: string) => void) | null,
): ((fnLabel: string) => void) | null {
  const prev = absTruncCollector;
  absTruncCollector = collector;
  return prev;
}

export function noteAbsTruncation(label: string): void {
  if (!absTruncCollector) return;
  try {
    absTruncCollector(label);
  } catch {
    /* collector 不得打断求值 */
  }
}

/** 进入调用：超限/cycle 则不执行 body，返回 opaque */
export function enterCall(key: string, label: string): boolean {
  if (
    _activeCallKeys.includes(key) ||
    _absCallDepth >= MAX_CALL_DEPTH ||
    _absTotalCalls >= MAX_TOTAL_CALLS
  ) {
    _callTruncated = true;
    noteAbsTruncation(label);
    return false;
  }
  _activeCallKeys.push(key);
  _absCallDepth++;
  _absTotalCalls++;
  return true;
}

export function exitCall(): void {
  _absCallDepth--;
  _activeCallKeys.pop();
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
 * 正常函数远低于此；病态递归×循环能在秒级内兜住（对照 MAX_B_TOTAL_CALLS
 * 从 200k 收到 20k 的先例）。可经 setBForkBudgetLimit / env NUDO_MAX_FORKS /
 * package.json#nudo.analysis.maxForks 调节。
 */
export const MAX_B_TOTAL_FORKS = 5000;

let _bForkBudgetLimit = MAX_B_TOTAL_FORKS;
let _bForkCount = 0;
/** 本轮是否已上报过 fork 截断（避免 collector 被同一轮刷屏） */
let _bForkTruncNoted = false;

/**
 * 专用标签：fork 截断不是「某个递归函数被截断」，不能复用函数名 label
 * （否则 check 会误报 nudo:recursion-truncated）。service/check 按此标签
 * 映射为 `nudo:fork-truncated`（warning）。
 */
export const FORK_TRUNCATION_LABEL = "#fork-budget";

/** fork 超限观测（service/LSP 映射 nudo:fork-truncated；与调用截断同 collector 管道） */
export function noteBForkTruncation(): void {
  noteAbsTruncation(FORK_TRUNCATION_LABEL);
}

/**
 * 调整 fork 总次数上限。约定：n ≥ 1 的有限整数才生效（向下取整）；
 * 非法值（0 / 负数 / NaN / Infinity / 非数）回默认 MAX_B_TOTAL_FORKS。
 * 返回实际生效值。core 无 IO——env/package.json 由 service 读取后 set 进来。
 */
export function setBForkBudgetLimit(n: number): number {
  if (typeof n === "number" && Number.isFinite(n) && n >= 1) {
    _bForkBudgetLimit = Math.floor(n);
  } else {
    _bForkBudgetLimit = MAX_B_TOTAL_FORKS;
  }
  return _bForkBudgetLimit;
}

export function getBForkBudgetLimit(): number {
  return _bForkBudgetLimit;
}

export function getBForkCount(): number {
  return _bForkCount;
}

/** 宿主入口前重置 fork 计数（与 resetAbsCallBudget / resetBCallBudget 同口径） */
export function resetBForkBudget(): void {
  _bForkCount = 0;
  _bForkTruncNoted = false;
}

/** $fork 入口：超限放弃该分支（调用方返回 unknown = 最保守，安全）。 */
export function bumpBForkBudget(): boolean {
  if (++_bForkCount <= _bForkBudgetLimit) return true;
  if (!_bForkTruncNoted) {
    _bForkTruncNoted = true;
    noteBForkTruncation();
  }
  return false;
}
