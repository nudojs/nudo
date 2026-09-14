/**
 * B 路径调用点记录：transpile 把 `f(args)` 改成 $callNamed，
 * 分析时可收集 call@ 所需的 AbsCallRecord。
 * 成员缺失诊断见 member-diag.ts（与 ast-eval 共用，避免循环依赖）。
 */

import type { Abs } from "../abs.ts";
import { unknown } from "../abs.ts";
import { evalGlobalFn } from "../builtins.ts";
import { $call } from "./call.ts";
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
  noteUnknownMemberMissing,
  noteMemberDispatchMiss,
  tagAbsOrigin,
  getAbsOrigin,
} from "./member-diag.ts";

export type BCallRecord = {
  fnName: string;
  args: Abs[];
  result: Abs;
  callLoc?: { line: number; column: number };
  threw?: boolean;
};

let bCallCollector: ((r: BCallRecord) => void) | null = null;

/** evalGlobalFn 覆盖的宿主全局函数名（身份校验后再派发） */
const GLOBAL_FNS = new Set([
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "Number",
  "String",
  "Boolean",
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
      result = g ?? (fn as (...a: Abs[]) => Abs)(...args);
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
