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
  /** 调用点来源（provenance）：实参字面量 loc 优先，否则最近 $callNamed loc */
  origin?: { line: number; column: number };
};

let memberDiagCollector: ((d: BMemberDiag) => void) | null = null;
const callLocStack: Array<{ line: number; column: number }> = [];
/** 实参 Abs → 字面量源位置（$callNamed 按 argLocs 打标） */
const absOrigins = new WeakMap<object, { line: number; column: number }>();

/** 给实参 Abs 打 provenance（调用点参数字面量） */
export function tagAbsOrigin(a: Abs, loc: { line: number; column: number }): void {
  if (a && typeof a === "object") absOrigins.set(a, loc);
}

export function getAbsOrigin(a: Abs | undefined): { line: number; column: number } | undefined {
  if (!a || typeof a !== "object") return undefined;
  return absOrigins.get(a);
}

export function setMemberDiagCollector(
  c: ((d: BMemberDiag) => void) | null,
): void {
  memberDiagCollector = c;
}

export function recordMemberDiag(d: BMemberDiag): void {
  if (!memberDiagCollector) return;
  // 参数字面量 origin 优先；否则最近调用点
  const origin = d.origin ?? callLocStack[callLocStack.length - 1];
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
  const argOrigin = getAbsOrigin(recv);
  const origin = argOrigin
    ? { line: argOrigin.line, column: argOrigin.column }
    : undefined;
  if (t === "number" || t === "boolean" || t === "bigint" || t === "symbol") {
    recordMemberDiag({
      kind,
      name,
      receiver: t,
      line: loc?.[0],
      column: loc?.[1],
      ...(origin ? { origin } : {}),
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
      ...(origin ? { origin } : {}),
    });
    return true;
  }
  return false;
}

/**
 * unknown 接收者上的成员访问 → unknown-recv（与 TypeValue 口径对齐：
 * object/instance/refined/promise 静默；其余记一条）。
 */
export function noteUnknownMemberMissing(
  recv: Abs | undefined,
  name: string,
  kind: "method" | "property",
  loc?: [number, number],
): boolean {
  const k = recv?.shape?.k;
  if (k !== "unknown") return false;
  const origin = getAbsOrigin(recv);
  recordMemberDiag({
    kind,
    name,
    receiver: "unknown",
    line: loc?.[0],
    column: loc?.[1],
    ...(origin ? { origin: { line: origin.line, column: origin.column } } : {}),
  });
  return true;
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
