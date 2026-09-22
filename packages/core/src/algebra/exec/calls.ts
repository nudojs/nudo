/**
 * B 路径调用点记录：transpile 把 `f(args)` 改成 $callNamed，
 * 分析时可收集 call@ 所需的 AbsCallRecord。
 * 成员缺失诊断见 member-diag.ts（与 ast-eval 共用，避免循环依赖）。
 */

import type { Abs } from "../abs.ts";
import { unknown } from "../abs.ts";
import { evalGlobalFn } from "../builtins.ts";
import { $call } from "./call.ts";
import { callAtFunctionBoundary } from "./runtime.ts";
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
      // 嵌套 B 路径函数：调用边界收 NudoReturn，不得污染 caller
      result = g ?? callAtFunctionBoundary(() => (fn as (...a: Abs[]) => Abs)(...args));
    } else if (fn && typeof fn === "object" && "shape" in (fn as object)) {
      result = $call(fn as Abs, args);
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
