/**
 * B 路径调用点记录：transpile 把 `f(args)` 改成 $callNamed，
 * 分析时可收集 call@ 所需的 AbsCallRecord。
 */

import type { Abs } from "../abs.ts";
import { unknown } from "../abs.ts";
import { $call } from "./call.ts";

export type BCallRecord = {
  fnName: string;
  args: Abs[];
  result: Abs;
  callLoc?: { line: number; column: number };
  threw?: boolean;
};

let bCallCollector: ((r: BCallRecord) => void) | null = null;

export function setBCallCollector(
  collector: ((r: BCallRecord) => void) | null,
): void {
  bCallCollector = collector;
}

export function getBCallCollector(): ((r: BCallRecord) => void) | null {
  return bCallCollector;
}

export type BMemberDiag = {
  kind: "method" | "property";
  name: string;
  /** 接收者 prim 类型名 */
  receiver: string;
  line?: number;
  column?: number;
  /** 调用点来源（provenance）：最近一次 $callNamed loc */
  origin?: { line: number; column: number };
};

let memberDiagCollector: ((d: BMemberDiag) => void) | null = null;
const callLocStack: Array<{ line: number; column: number }> = [];

export function setMemberDiagCollector(
  c: ((d: BMemberDiag) => void) | null,
): void {
  memberDiagCollector = c;
}

export function recordMemberDiag(d: BMemberDiag): void {
  if (!memberDiagCollector) return;
  const origin = callLocStack[callLocStack.length - 1];
  try {
    memberDiagCollector(origin ? { ...d, origin } : d);
  } catch {
    /* ignore */
  }
}

/** string 上仍可能存在的方法（与 TypeValue completions 对齐） */
const STRING_METHODS = new Set([
  "toUpperCase", "toLowerCase", "trim", "split", "slice", "substring",
  "includes", "indexOf", "lastIndexOf", "startsWith", "endsWith", "charAt",
  "charCodeAt", "replace", "toString", "valueOf", "repeat", "padStart",
  "padEnd", "replaceAll", "concat", "match", "search", "at",
]);

/**
 * prim 接收者上的未知成员 → 诊断。
 * 返回 true 表示确定缺失（number 上任意方法；string 上表外方法）。
 */
export function notePrimMemberMissing(
  recv: Abs | undefined,
  name: string,
  kind: "method" | "property",
  loc?: [number, number],
): boolean {
  const shape = recv?.shape;
  if (!shape || shape.k !== "prim") return false;
  const t = shape.type;
  if (t === "number" || t === "boolean" || t === "bigint" || t === "symbol") {
    recordMemberDiag({
      kind,
      name,
      receiver: t,
      line: loc?.[0],
      column: loc?.[1],
    });
    return true;
  }
  if (t === "string" && kind === "method" && !STRING_METHODS.has(name)) {
    recordMemberDiag({
      kind,
      name,
      receiver: t,
      line: loc?.[0],
      column: loc?.[1],
    });
    return true;
  }
  return false;
}

/**
 * 按名调用并记录。
 * loc: [line, column]（1-based line，0-based column，与 Babel 一致）
 */
export function $callNamed(
  name: string,
  fn: unknown,
  args: Abs[],
  loc?: [number, number],
): Abs {
  let result: Abs = unknown;
  let threw = false;
  if (loc) callLocStack.push({ line: loc[0], column: loc[1] });
  try {
    if (typeof fn === "function") {
      result = (fn as (...a: Abs[]) => Abs)(...args);
    } else if (fn && typeof fn === "object" && "shape" in (fn as object)) {
      result = $call(fn as Abs, args);
    }
  } catch (e) {
    threw = true;
    throw e;
  } finally {
    if (loc) callLocStack.pop();
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
