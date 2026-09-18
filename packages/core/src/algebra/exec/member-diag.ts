/**
 * 成员缺失诊断（B 路径 + Abs ast-eval 共用）。
 * 无 $call / transpile 依赖，避免 ast-eval ↔ calls 循环。
 */

import type { Abs } from "../abs.ts";

export type BMemberDiag = {
  kind: "method" | "property";
  name: string;
  /** 接收者 prim 类型名，或 "unknown" / "object"（C0.5 闭 shape 缺槽） */
  receiver: string;
  line?: number;
  column?: number;
  /** 调用点来源（provenance）：实参字面量 loc 优先，否则最近 $callNamed loc */
  origin?: { line: number; column: number };
  /** 覆盖默认 no-method 码；C0.5 用 nudo:missing-slot */
  code?: string;
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

export function pushCallLoc(loc: { line: number; column: number }): void {
  callLocStack.push(loc);
}

export function popCallLoc(): void {
  callLocStack.pop();
}

export function recordMemberDiag(d: BMemberDiag): void {
  if (!memberDiagCollector) return;
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

/** 方法分派失败时的统一记账（prim / unknown；obj/brand/promise 静默） */
export function noteMemberDispatchMiss(
  recv: Abs | undefined,
  name: string,
  kind: "method" | "property",
  loc?: [number, number],
): void {
  if (notePrimMemberMissing(recv, name, kind, loc)) return;
  if (noteUnknownMemberMissing(recv, name, kind, loc)) return;
  noteObjSlotMissing(recv, name, loc);
}

// ---------------------------------------------------------------------------
// C0.5 — evaluation-driven missing-slot（默认 off）
// ---------------------------------------------------------------------------
// 进程级 fallback 仅兼容旧 set API；真正开关走 AsyncLocalStorage，
// 每次分析 runWithEvalMissingSlot 包一层，避免 LSP 多项目 / 并发串档。

import { AsyncLocalStorage } from "node:async_hooks";

const evalMissingSlotAls = new AsyncLocalStorage<boolean>();
let evalMissingSlotFallback = false;

/** host（service analysisConfig）在 B-path 前设置；默认 false */
export function setEvalMissingSlotEnabled(enabled: boolean): void {
  evalMissingSlotFallback = enabled;
  evalMissingSlotAls.enterWith(enabled);
}

export function isEvalMissingSlotEnabled(): boolean {
  return evalMissingSlotAls.getStore() ?? evalMissingSlotFallback;
}

/** per-analysis 作用域：body 内 flag 隔离，结束后自动恢复外层值 */
export function runWithEvalMissingSlot<T>(enabled: boolean, body: () => T): T {
  return evalMissingSlotAls.run(enabled, body);
}

/**
 * 闭对象 shape 上缺失字段且**求值真实走到**该读取 → `nudo:missing-slot`。
 * 仅展示/草稿提示；不参与 handwritten check 义务（C0：禁止 body AST 预扫）。
 */
export function noteObjSlotMissing(
  recv: Abs | undefined,
  name: string,
  loc?: [number, number],
): boolean {
  if (!isEvalMissingSlotEnabled()) return false;
  const shape = recv?.shape;
  if (!shape || shape.k !== "obj") return false;
  const obj = shape as { open?: boolean; slots?: Record<string, unknown> };
  if (obj.open) return false;
  if (obj.slots && name in obj.slots) return false;
  // opaque / widened conf：成员可能被藏住，不报
  const conf = recv?.conf;
  if (conf === "opaque" || conf === "widened") return false;
  const origin = getAbsOrigin(recv);
  recordMemberDiag({
    kind: "property",
    name,
    receiver: "object",
    code: "nudo:missing-slot",
    line: loc?.[0],
    column: loc?.[1],
    ...(origin ? { origin } : {}),
  });
  return true;
}
