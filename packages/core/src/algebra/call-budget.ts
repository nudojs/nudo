/**
 * 调用预算 + 截断观测（ast-eval 执行器删除后保留的共享面）。
 * 抽象求值对递归做展开而非不动点：参数类型每层变形（fac(n-1)）时
 * cycle key 不重复，必须靠深度/总调用数封顶。超限结果 conf=opaque。
 */
import type { Abs } from "./abs.ts";
import { abs } from "./abs.ts";
import { termToString } from "./term.ts";

export const MAX_CALL_DEPTH = 64;
export const MAX_TOTAL_CALLS = 200_000;

let _absCallDepth = 0;
let _absTotalCalls = 0;
let _activeCallKeys: string[] = [];
const _fnCallIds = new WeakMap<object, string>();
let _fnCallIdSeq = 0;

export function stableCallId(obj: object): string {
  let id = _fnCallIds.get(obj);
  if (id === undefined) {
    id = `#${++_fnCallIdSeq}`;
    _fnCallIds.set(obj, id);
  }
  return id;
}

/** 宿主入口（runTranspiled / callTranspiledExportFull / check）前重置 */
export function resetAbsCallBudget(): void {
  _absCallDepth = 0;
  _absTotalCalls = 0;
  _activeCallKeys = [];
  _bForkCount = 0;
}

/** 截断结果：分析无信息，conf=opaque（不是 any） */
export function truncatedAbs(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

/** 调用指纹：命名函数用 name+arg shapes；一等函数用对象身份 */
export function callBudgetKey(kind: string, id: string, args: Abs[]): string {
  const parts = args.map((a) => {
    const t = a.term ? termToString(a.term) : "";
    return `${a.shape.k}:${t}`;
  });
  return `${kind}|${id}|${parts.join(",")}`;
}

let absTruncCollector: ((fnLabel: string) => void) | null = null;

/** 记录被截断的递归（service 可映射为 nudo:recursion-truncated） */
export function setAbsTruncationCollector(
  collector: ((fnLabel: string) => void) | null,
): void {
  absTruncCollector = collector;
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

/** 分支展开上限：递归×循环下 $fork 数爆炸（lodash _baseFlatten 实测每次
 *  fork ~150µs——集合 overlay/Φ 臂包裹成本；调用预算管不到 fork 数）。
 *  超限返回 unknown（放弃该分支 = 最保守，安全）。 */
export const MAX_B_TOTAL_FORKS = 5000;
let _bForkCount = 0;
export function bumpBForkBudget(): boolean {
  return ++_bForkCount <= MAX_B_TOTAL_FORKS;
}
