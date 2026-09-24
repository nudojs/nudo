/**
 * may-throw 效果收集（design-cli-semantics §3.3）。
 * any/nullish 成员访问等危险操作记录 throws 域，不立刻 hard-fail 求值。
 * Collector/tryFrames 经 AsyncLocalStorage 会话隔离，避免 LSP 并发串档。
 */
import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";
import { AsyncLocalStorage } from "node:async_hooks";

export type MayThrowEffect = {
  /** throws 类型名，如 TypeError */
  kind: string;
  /** 人类可读成因 */
  cause: string;
  /** 接收者展示：any / null / undefined / number… */
  recv?: string;
  /** 成员名 */
  name?: string;
  line?: number;
  column?: number;
};

type MayThrowCtx = {
  collector: ((e: MayThrowEffect) => void) | null;
  tryFrames: MayThrowEffect[][];
};

const mayThrowAls = new AsyncLocalStorage<MayThrowCtx>();
/** 同步 fallback：未 enter ALS 时的进程级上下文 */
let syncCtx: MayThrowCtx = { collector: null, tryFrames: [] };

function ctx(): MayThrowCtx {
  return mayThrowAls.getStore() ?? syncCtx;
}

/** 隔离一次分析的 may-throw 收集（check / analyzer 入口包一层） */
export function runWithMayThrowSession<T>(body: () => T): T {
  const session: MayThrowCtx = { collector: null, tryFrames: [] };
  return mayThrowAls.run(session, () => {
    const prev = syncCtx;
    syncCtx = session;
    try {
      return body();
    } finally {
      syncCtx = prev;
    }
  });
}

export function setMayThrowCollector(
  c: ((e: MayThrowEffect) => void) | null,
): void {
  ctx().collector = c;
}

export function getMayThrowCollector(): ((e: MayThrowEffect) => void) | null {
  return ctx().collector;
}

export function pushMayThrowFrame(): void {
  ctx().tryFrames.push([]);
}

/**
 * 弹出 try 帧。discard=true（catch 消化）时返回空；否则返回帧内效果供上浮。
 */
export function popMayThrowFrame(discard: boolean): MayThrowEffect[] {
  const frame = ctx().tryFrames.pop() ?? [];
  return discard ? [] : frame;
}

/**
 * 孤儿 soft 效果上浮：若仍有外层 try 帧则并入外层（nested try + outer catch）；
 * 否则交给 collector。不得在栈非空时直接 flush，否则 outer catch 被旁路。
 */
export function orphanMayThrowEffects(effects: MayThrowEffect[]): void {
  if (effects.length === 0) return;
  const c = ctx();
  const outer = c.tryFrames[c.tryFrames.length - 1];
  if (outer) {
    for (const e of effects) outer.push(e);
    return;
  }
  flushMayThrowEffects(effects);
}

/** B-path：try 开始时压 soft 帧（与 ast-eval evalTry 同口径） */
export function $tryMarkSoft(): void {
  pushMayThrowFrame();
}

/** B-path catch 消化 try 内 soft may-throw */
export function $tryDigestSoft(): void {
  popMayThrowFrame(true);
}

/** B-path 无 handler / 出口 / rethrow：上浮未消化 soft may-throw（外层 try 可再消化） */
export function $tryReleaseSoft(): MayThrowEffect[] {
  const effects = popMayThrowFrame(false);
  orphanMayThrowEffects(effects);
  return effects;
}

export function flushMayThrowEffects(effects: MayThrowEffect[]): void {
  const collector = ctx().collector;
  if (!collector || effects.length === 0) return;
  for (const e of effects) {
    try {
      collector(e);
    } catch {
      /* ignore */
    }
  }
}

export function recordMayThrow(e: MayThrowEffect): void {
  const c = ctx();
  const frame = c.tryFrames[c.tryFrames.length - 1];
  if (frame) {
    frame.push(e);
    return;
  }
  if (!c.collector) return;
  try {
    c.collector(e);
  } catch {
    /* ignore collector errors */
  }
}

/** throws 类型名 → Abs（brand Error 形态，formatShape 打出名字） */
export function errorTypeAbs(name: string): Abs {
  return abs(
    {
      k: "brand",
      name,
      shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    "exact",
  );
}

/** 效果集 → throws Abs（never = 无 may-throw） */
export function mayThrowEffectsToAbs(effects: MayThrowEffect[]): Abs {
  if (effects.length === 0) {
    return abs({ k: "never" }, undefined, undefined, "exact");
  }
  const names = [...new Set(effects.map((e) => e.kind))].sort();
  if (names.length === 1) return errorTypeAbs(names[0]!);
  return abs(
    { k: "sum", members: names.map((n) => errorTypeAbs(n)) },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * throws Abs → 展示名（TypeError / TypeError | RangeError）。
 * 非 brand/sum 时按 Abs 形状给出可运行时名，不再一律 "Error"。
 */
export function formatThrowsAbs(t: Abs | undefined): string | undefined {
  if (!t || t.shape.k === "never") return undefined;
  if (t.shape.k === "brand") return t.shape.name;
  if (t.shape.k === "sum") {
    // 诚实展示全部臂（含 any/unknown）；同名去重；Error 在场且全属 Error 族 → 折成 Error
    const names = [...new Set(t.shape.members.map((m) => formatThrowsAbs(m) ?? "Error"))].sort();
    if (names.includes("Error") && names.every((n) => ERROR_FAMILY.has(n))) return "Error";
    return names.join(" | ");
  }
  if (t.shape.k === "prim") {
    // throw "x" / throw 1：诚实显示被抛值的运行时类型名
    return t.shape.type === "string"
      ? "string"
      : t.shape.type === "number"
        ? "number"
        : t.shape.type === "boolean"
          ? "boolean"
          : t.shape.type === "bigint"
            ? "bigint"
            : "Error";
  }
  if (t.shape.k === "any") return "any";
  if (t.shape.k === "unknown") return "unknown";
  if (t.shape.k === "fn") return "function";
  if (t.shape.k === "arr" || t.shape.k === "tuple") return "Array";
  if (t.shape.k === "obj") return "object";
  if (t.term && t.term.op === "lit") {
    const v = (t.term as { value?: unknown }).value;
    if (v instanceof Error) return v.constructor.name;
  }
  return "Error";
}

/** JS Error 家族：`@nudo:throws Error` 覆盖全部子类（与 instanceof 语义一致） */
export const ERROR_FAMILY = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

/** throws Abs → kind 名列表（sum 拆臂；绝不把 `"A | B"` 当单个 kind） */
export function throwAbsToKinds(t: Abs | undefined): string[] {
  if (!t || t.shape.k === "never") return [];
  if (t.shape.k === "sum") {
    return t.shape.members.flatMap((m) => throwAbsToKinds(m));
  }
  const name = formatThrowsAbs(t);
  return name ? [name] : [];
}

/** declared/ignore 条目是否盖住 kind（`Error` 盖 Error 家族；`*` 由调用方先判） */
export function throwsKindCovered(kind: string, names: readonly string[]): boolean {
  if (names.includes(kind)) return true;
  // `Error` 申报/忽略 = 整族（ReferenceError extends Error）
  return names.includes("Error") && ERROR_FAMILY.has(kind);
}

/** effects 是否被 ignore 列表吞掉（kind 或 Error 族） */
export function isThrowsIgnored(kind: string, ignore: readonly string[] | undefined): boolean {
  if (!ignore || ignore.length === 0) return false;
  return throwsKindCovered(kind, ignore);
}

/**
 * L2 throws 过滤（口径固定）：
 * 1. **declare 优先**（@nudo:throws / case !! throws / sidecar fn.throws）——有意 fail-fast；
 * 2. ignoreThrows 其次——迁移期全类放行，**不是**声明的替代品。
 */
export function filterGateThrows(
  effects: MayThrowEffect[],
  declared: readonly string[] | "*" | undefined,
  ignore: readonly string[] | undefined,
): MayThrowEffect[] {
  return filterIgnoredThrows(filterDeclaredThrows(effects, declared), ignore);
}

/** effects 过滤后的剩余（L2 --ignore-throws） */
export function filterIgnoredThrows(
  effects: MayThrowEffect[],
  ignore: readonly string[] | undefined,
): MayThrowEffect[] {
  if (!ignore || ignore.length === 0) return effects;
  return effects.filter((e) => !throwsKindCovered(e.kind, ignore));
}

/**
 * 申报式抛错过滤（@nudo:throws / case !! throws / sidecar fn.throws）。
 * `*` = 全部申报，L2 清空；数组 = kind 或 Error 族覆盖。
 * 申报 ≠ ignoreThrows：前者是「这是有意 fail-fast」，后者是「迁移期先别管」。
 */
export function filterDeclaredThrows(
  effects: MayThrowEffect[],
  declared: readonly string[] | "*" | undefined,
): MayThrowEffect[] {
  if (declared === undefined) return effects;
  if (declared === "*") return [];
  if (declared.length === 0) return effects;
  return effects.filter((e) => !throwsKindCovered(e.kind, declared));
}
