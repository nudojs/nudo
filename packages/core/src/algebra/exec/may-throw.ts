/**
 * may-throw 效果收集（design-cli-semantics §3.3）。
 * any/nullish 成员访问等危险操作记录 throws 域，不立刻 hard-fail 求值。
 */
import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";

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

let collector: ((e: MayThrowEffect) => void) | null = null;
/** try 帧：内层 soft may-throw 先入帧，handler 消化时丢弃 */
const tryFrames: MayThrowEffect[][] = [];

export function setMayThrowCollector(
  c: ((e: MayThrowEffect) => void) | null,
): void {
  collector = c;
}

export function getMayThrowCollector(): ((e: MayThrowEffect) => void) | null {
  return collector;
}

export function pushMayThrowFrame(): void {
  tryFrames.push([]);
}

/**
 * 弹出 try 帧。discard=true（catch 消化）时返回空；否则返回帧内效果供上浮。
 */
export function popMayThrowFrame(discard: boolean): MayThrowEffect[] {
  const frame = tryFrames.pop() ?? [];
  return discard ? [] : frame;
}

export function flushMayThrowEffects(effects: MayThrowEffect[]): void {
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
  const frame = tryFrames[tryFrames.length - 1];
  if (frame) {
    frame.push(e);
    return;
  }
  if (!collector) return;
  try {
    collector(e);
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

/** throws Abs → 展示名（TypeError / TypeError | RangeError） */
export function formatThrowsAbs(t: Abs | undefined): string | undefined {
  if (!t || t.shape.k === "never") return undefined;
  if (t.shape.k === "brand") return t.shape.name;
  if (t.shape.k === "sum") {
    return t.shape.members.map((m) => formatThrowsAbs(m) ?? "unknown").join(" | ");
  }
  if (t.shape.k === "prim" && t.shape.type === "string") {
    return "Error";
  }
  // 字面量/其它：尽量给出可读名
  return "Error";
}

/** effects 是否被 ignore 列表吞掉（按 kind 精确匹配） */
export function isThrowsIgnored(kind: string, ignore: readonly string[] | undefined): boolean {
  if (!ignore || ignore.length === 0) return false;
  return ignore.includes(kind);
}

/** effects 过滤后的剩余（L2 --ignore-throws） */
export function filterIgnoredThrows(
  effects: MayThrowEffect[],
  ignore: readonly string[] | undefined,
): MayThrowEffect[] {
  if (!ignore || ignore.length === 0) return effects;
  return effects.filter((e) => !ignore.includes(e.kind));
}
