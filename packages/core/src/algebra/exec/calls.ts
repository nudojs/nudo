/**
 * B 路径调用点记录：transpile 把 `f(args)` 改成 $callNamed，
 * 分析时可收集 call@ 所需的 AbsCallRecord。
 * 成员缺失诊断见 member-diag.ts（与 ast-eval 共用，避免循环依赖）。
 */

import type { Abs } from "../abs.ts";
import { abs, unknown } from "../abs.ts";
import { evalGlobalFn } from "../builtins.ts";
import { $call } from "./call.ts";
import { callAtFunctionBoundary } from "./runtime.ts";
import { noteAbsTruncation, callBudgetKey } from "../call-budget.ts";
import {
  tagAbsOrigin,
  pushCallLoc,
  popCallLoc,
} from "./member-diag.ts";

export type {
  BMemberDiag,
} from "./member-diag.ts";
export {
  setMemberDiagCollector,
  recordMemberDiag,
  notePrimMemberMissing,
  noteAnyMemberMayThrow,
  noteNullishMemberThrows,
  noteUnknownMemberMissing,
  noteMemberDispatchMiss,
  noteObjSlotMissing,
  isNullishAbs,
  anyMemberResult,
  setEvalMissingSlotEnabled,
  isEvalMissingSlotEnabled,
  runWithEvalMissingSlot,
  tagAbsOrigin,
  getAbsOrigin,
  OBJECT_PROTO_NAMES,
  definitelyUncallableMember,
} from "./member-diag.ts";
export {
  setMayThrowCollector,
  getMayThrowCollector,
  runWithMayThrowSession,
  recordMayThrow,
  pushMayThrowFrame,
  popMayThrowFrame,
  flushMayThrowEffects,
  errorTypeAbs,
  mayThrowEffectsToAbs,
  formatThrowsAbs,
  isThrowsIgnored,
  filterIgnoredThrows,
  $tryMarkSoft,
  $tryDigestSoft,
  $tryReleaseSoft,
  type MayThrowEffect,
} from "./may-throw.ts";

export type BCallRecord = {
  fnName: string;
  args: Abs[];
  result: Abs;
  callLoc?: { line: number; column: number };
  threw?: boolean;
};

let bCallCollector: ((r: BCallRecord) => void) | null = null;

/** B 赋值记录（与 ast-eval AbsAssignRecord 同形；structuralAssignIssues 消费） */
export type BAbsAssignRecord = {
  name: string;
  prev: Abs | undefined;
  next: Abs;
  line?: number;
  column?: number;
  conditional?: boolean;
};

let bAssignCollector: ((r: BAbsAssignRecord) => void) | null = null;

export function setBAssignCollector(
  collector: ((r: BAbsAssignRecord) => void) | null,
): void {
  bAssignCollector = collector;
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
  if (!bAssignCollector) return;
  try {
    bAssignCollector({
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

export function setBBindingSink(sink: Map<string, unknown> | null): void {
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
]);

export function setBCallCollector(
  collector: ((r: BCallRecord) => void) | null,
): void {
  bCallCollector = collector;
}

export function getBCallCollector(): ((r: BCallRecord) => void) | null {
  return bCallCollector;
}

/**
 * 按名调用并记录。
 * loc: [line, column]（1-based line，0-based column，与 Babel 一致）
 * argLocs: 与 args 对齐的实参字面量源位置（provenance；无 loc 用 null）
 */
// --- B 调用预算（与 ast-eval enterCall 同口径）--------------------------------
// 命名调用（transpile 的 $callNamed 是 B run 全部标识符调用的派发点）此前无
// 预算：直接自递归/互递归裸奔原生 JS 递归 → 栈溢出，RangeError 被
// callTranspiledExportFull 兜底静默吞成 unknown+partial（假结果）。此处对齐
// ast-eval：深度 64 / 总调用 200k / cycle（同 name+arg 指纹）→ 截断 opaque。

export const MAX_B_CALL_DEPTH = 64;
/** 总调用上限：递归×循环×分支展开的规模阀。200k 在病态展开（lodash
 *  _baseFlatten：8 迭代 × 2 臂 fork × 64 深）下 ~30s（每次 fork ~150µs），
 *  20k 收口到 ~3s——截断 → opaque（更保守，zero-FP 安全）；真实包典型
 *  文件调用数远低于此。 */
export const MAX_B_TOTAL_CALLS = 20_000;

let bCallDepth = 0;
let bTotalCalls = 0;
let bActiveCallKeys: string[] = [];
const bFnCallIds = new WeakMap<object, string>();
let bFnCallIdSeq = 0;

function bStableId(obj: object): string {
  let id = bFnCallIds.get(obj);
  if (id === undefined) {
    id = `#${++bFnCallIdSeq}`;
    bFnCallIds.set(obj, id);
  }
  return id;
}

/** 宿主入口（runTranspiled / callTranspiledExportFull）前重置 */
export function resetBCallBudget(): void {
  bCallDepth = 0;
  bTotalCalls = 0;
  bActiveCallKeys = [];
}

/** 截断结果：分析无信息，conf=opaque（与 ast-eval truncatedAbs 同） */
function bTruncatedAbs(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

function bCallBudgetKey(name: string, fn: unknown, args: Abs[]): string {
  // 实参可能是裸 JS 值（B run 里模块函数作实参传的就是 JS 函数）——统一走
  // call-budget 的防御化键（不得裸读 shape）
  const id = fn && typeof fn === "object" ? bStableId(fn) : "prim";
  return callBudgetKey(name, id, args);
}

/** 进入命名调用：超限/cycle → 不执行，返回 opaque（并上报截断） */
function bEnterCall(name: string, fn: unknown, args: Abs[]): { ok: boolean; key?: string } {
  const key = bCallBudgetKey(name, fn, args);
  if (
    bActiveCallKeys.includes(key) ||
    bCallDepth >= MAX_B_CALL_DEPTH ||
    bTotalCalls >= MAX_B_TOTAL_CALLS
  ) {
    noteAbsTruncation(name);
    return { ok: false };
  }
  bActiveCallKeys.push(key);
  bCallDepth++;
  bTotalCalls++;
  return { ok: true, key };
}

function bExitCall(): void {
  bCallDepth--;
  bActiveCallKeys.pop();
}

export function $callNamed(
  name: string,
  fn: unknown,
  args: Abs[],
  loc?: [number, number],
  argLocs?: Array<[number, number] | null | undefined>,
): Abs {
  let result: Abs = unknown;
  let threw = false;
  if (argLocs) {
    for (let i = 0; i < args.length; i++) {
      const al = argLocs[i];
      if (al) tagAbsOrigin(args[i]!, { line: al[0], column: al[1] });
    }
  }
  if (loc) pushCallLoc({ line: loc[0], column: loc[1] });
  try {
    if (typeof fn === "function") {
      // 宿主全局函数（Number/String/parseInt…）：按身份识别，路由到 Abs builtin 表。
      // 直接调用会把 Abs 喂给真 JS 函数（Number(absObj) → NaN）——静默错误。
      const g = GLOBAL_FNS.has(name) && fn === (globalThis as Record<string, unknown>)[name]
        ? evalGlobalFn(name, args)
        : undefined;
      if (g !== undefined) {
        result = g;
      } else {
        const entered = bEnterCall(name, fn, args);
        if (!entered.ok) {
          result = bTruncatedAbs();
        } else {
          try {
            // 嵌套 B 路径函数：调用边界收 NudoReturn，不得污染 caller
            result = callAtFunctionBoundary(() => (fn as (...a: Abs[]) => Abs)(...args));
          } finally {
            bExitCall();
          }
        }
      }
    } else if (fn && typeof fn === "object" && "shape" in (fn as object)) {
      // Abs fn 分支同口径预算（编译递归经 $call 会绕到此处——cycle/深度守卫）
      const entered = bEnterCall(name, fn, args);
      if (!entered.ok) {
        result = bTruncatedAbs();
      } else {
        try {
          result = $call(fn as Abs, args);
        } finally {
          bExitCall();
        }
      }
    }
  } catch (e) {
    threw = true;
    throw e;
  } finally {
    if (loc) popCallLoc();
    if (bCallCollector) {
      try {
        bCallCollector({
          fnName: name,
          args,
          result: threw ? unknown : result,
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
