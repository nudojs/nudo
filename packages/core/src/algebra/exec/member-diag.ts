// IMPLEMENTED:cli-semantics — any 成员访问记 may-throw；unknown-recv 仅引擎债。
/**
 * 成员缺失诊断（B 路径 $invoke / 成员访问共用）。
 * 无 $call / transpile 依赖，避免与 calls 循环。
 *
 * any vs unknown（design-cli-semantics §2–3）：
 * - any：无约束接收者 → 成员访问记入 throws 域（may-throw TypeError），结果保持 any
 * - unknown：推导失败 → nudo:unknown-recv（引擎债），不得替代 L2 throws 建模
 * - null/undefined：成员访问 hard-throw TypeError（§3.3 / design.md §4.5）
 */

import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";
import { recordMayThrow } from "./may-throw.ts";
import { isNullProtoObj } from "../objects.ts";

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

/** 返回先前 collector，便于嵌套调用 save/restore */
export function setMemberDiagCollector(
  c: ((d: BMemberDiag) => void) | null,
): ((d: BMemberDiag) => void) | null {
  const prev = memberDiagCollector;
  memberDiagCollector = c;
  return prev;
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

/** null / undefined（term lit null/undefined；shape unknown 兜底） */
export function isNullishAbs(a: Abs | undefined): boolean {
  if (!a) return false;
  if (a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined)) return true;
  return false;
}

/**
 * any（无约束）接收者上的成员访问 → may-throw TypeError。
 * 结果保持 any（JS 语义：属性值仍无约束），不是 unknown（分析失败）。
 */
export function noteAnyMemberMayThrow(
  recv: Abs | undefined,
  name: string,
  kind: "method" | "property",
  loc?: [number, number],
): boolean {
  if (recv?.shape?.k !== "any") return false;
  const origin = getAbsOrigin(recv);
  recordMayThrow({
    kind: "TypeError",
    cause: `${kind} '${name}' on any (unconstrained value)`,
    recv: "any",
    name,
    line: loc?.[0] ?? origin?.line,
    column: loc?.[1] ?? origin?.column,
  });
  return true;
}

/**
 * nullish 接收者上的成员访问 → hard may-throw TypeError（设计 §3.3）。
 * 返回 true 表示已记入 throws 域；调用方可据此抛 NudoThrow。
 */
export function noteNullishMemberThrows(
  recv: Abs | undefined,
  name: string,
  kind: "method" | "property",
  loc?: [number, number],
): boolean {
  if (!isNullishAbs(recv)) return false;
  const recvName =
    recv?.term?.op === "lit"
      ? recv.term.value === null
        ? "null"
        : "undefined"
      : "nullish";
  recordMayThrow({
    kind: "TypeError",
    cause: `${kind} '${name}' on ${recvName}`,
    recv: recvName,
    name,
    line: loc?.[0],
    column: loc?.[1],
  });
  return true;
}

/**
 * unknown 接收者上的成员访问 → unknown-recv（引擎债；与 any 的 throws 域分离）。
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

/** any 接收者成员访问的默认结果：any（不是 unknown） */
export function anyMemberResult(): Abs {
  return abs({ k: "any" }, undefined, undefined, "path");
}

/** 方法分派失败时的统一记账（prim / any / nullish / unknown） */
export function noteMemberDispatchMiss(
  recv: Abs | undefined,
  name: string,
  kind: "method" | "property",
  loc?: [number, number],
): void {
  if (notePrimMemberMissing(recv, name, kind, loc)) return;
  if (noteAnyMemberMayThrow(recv, name, kind, loc)) return;
  if (noteNullishMemberThrows(recv, name, kind, loc)) return;
  if (noteUnknownMemberMissing(recv, name, kind, loc)) return;
  noteObjSlotMissing(recv, name, loc);
}

// ---------------------------------------------------------------------------
// 结构上确定不可调用的成员调用 → 原生 TypeError
// ---------------------------------------------------------------------------

/** Object.prototype 上的恒有成员（`in` 判定 / 不可调用判定共用） */
export const OBJECT_PROTO_NAMES = new Set([
  "constructor",
  "toString",
  "valueOf",
  "toLocaleString",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__proto__",
]);

/**
 * 结构上确定不可调用的成员调用（B-path $invoke）：
 * - null-proto 对象：无 Object.prototype 可回退，缺失自有槽即确定缺失
 * - 闭 exact 对象：slots 是精确键集，非 OP 名缺失即确定缺失（OP 名经
 *   Object.prototype 存在，未建模 → 保守不抛）
 * - 槽存在但值是字面量（prim/null/undefined 非函数）→ 确定抛
 * 保守边界：open 对象（spread/assign 产物）、非 exact conf（create(proto)
 * 的 path 产物）、OP 原型名一律不判抛——避免假抛 false positive。
 */
export function definitelyUncallableMember(recv: Abs, name: string): boolean {
  const s = recv.shape;
  if (s.k !== "obj") return false;
  const slots = s.slots as Record<string, { value: Abs }>;
  const hasOwn = Object.prototype.hasOwnProperty.call(slots, name);
  if (hasOwn) {
    // 槽存在：值确定非可调用（字面量 prim/null/undefined）→ 抛；
    // fn Abs/抽象值 → 调用链已处理或保守
    const sv = slots[name]!.value;
    return !!sv.term && sv.term.op === "lit";
  }
  if (isNullProtoObj(recv)) return true;
  if (!s.open && !s.index && recv.conf === "exact" && !OBJECT_PROTO_NAMES.has(name)) {
    return true;
  }
  return false;
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
  if (obj.slots && Object.prototype.hasOwnProperty.call(obj.slots, name)) return false;
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
