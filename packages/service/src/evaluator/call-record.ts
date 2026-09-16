/**
 * 调用点记录（CallRecord）。Abs 唯一真理源。
 * argAbs/resultAbs/throwsAbs 必填；展示/外延在 CaseResult 边界再桥。
 */
import type { Abs, PrimName } from "@nudojs/core";
import { formatAbs, joinAbs, litValue } from "@nudojs/core";

export type CallRecord = {
  fnName: string;
  /** 无损参数 Abs */
  argAbs: Abs[];
  /** 无损结果 Abs（threw 时为 never） */
  resultAbs: Abs;
  /** 无损抛出值 Abs（未抛为 never） */
  throwsAbs: Abs;
  /** Line-relative. Per-fn cache replay shifts this by lineDelta — if you
   *  add another position field (callee loc, arg loc), extend
   *  shiftCallRecordLines in analyzer.ts in the same change. */
  callLoc?: { line: number; column: number };
  targetModule?: string;
  targetExport?: string;
  /** export names the same function value was re-exported under after its
   * defining module (barrel `index.js`, CJS forwarding shims); usage-site
   * records stay name-matchable against them */
  targetAliases?: string[];
  /** module whose evaluation created the function value (definition site). */
  fnModule?: string;
};

export const neverAbs: Abs = { shape: { k: "never" }, conf: "exact" };
export const undefAbs: Abs = {
  shape: { k: "unknown" },
  term: { op: "lit", value: undefined },
  conf: "exact",
};

/** Abs 结构 key（dedupe）：lit 优先，否则 formatAbs */
export function absStructureKey(a: Abs): string {
  const v = litValue(a);
  if (v !== undefined) return `L:${typeof v}:${String(v)}`;
  if (a.term?.op === "lit") return `L:${typeof a.term.value}:${String(a.term.value)}`;
  try {
    return formatAbs(a);
  } catch {
    return a.shape.k;
  }
}

function shapeNodeCount(a: Abs, seen: Set<object>): number {
  if (!a || typeof a !== "object") return 1;
  if (seen.has(a as object)) return 0;
  seen.add(a as object);
  const s = a.shape;
  switch (s.k) {
    case "arr":
      return 1 + shapeNodeCount(s.element, seen);
    case "tuple":
      return 1 + s.elements.reduce((acc, e) => acc + shapeNodeCount(e, seen), 0);
    case "obj": {
      let n = 1;
      for (const slot of Object.values(s.slots)) n += shapeNodeCount(slot.value, seen);
      return n;
    }
    case "eff":
      return 1 + shapeNodeCount(s.inner, seen);
    case "sum":
      return 1 + s.members.reduce((acc, e) => acc + shapeNodeCount(e, seen), 0);
    case "brand":
      return 1 + shapeNodeCount(s.shape, seen);
    case "fn": {
      let n = 1;
      for (const p of s.paramTypes ?? []) n += shapeNodeCount(p, seen);
      if (s.returnType) n += shapeNodeCount(s.returnType, seen);
      return n;
    }
    default:
      return 1;
  }
}

/** Abs DAG 节点预算（与历史 TypeValue 同阈值） */
export const MAX_RECORD_TYPE_NODES = 2000;

export function absNodeCount(a: Abs, seen: Set<object> = new Set()): number {
  return shapeNodeCount(a, seen);
}

export function isOversizedCallRecord(rec: CallRecord): boolean {
  const seen = new Set<object>();
  for (const a of rec.argAbs) {
    if (absNodeCount(a, seen) > MAX_RECORD_TYPE_NODES) return true;
  }
  return absNodeCount(rec.resultAbs, seen) > MAX_RECORD_TYPE_NODES;
}

/** never+never = 求值中断泄漏 */
export function isLeakedCallRecord(rec: CallRecord): boolean {
  return rec.resultAbs.shape.k === "never" && rec.throwsAbs.shape.k === "never";
}

/** fold joinAbs；空集 → never */
export function joinAllAbs(members: Abs[]): Abs {
  if (members.length === 0) return neverAbs;
  return members.reduce((a, b) => joinAbs(a, b));
}

function isPrimLit(a: Abs): a is Abs & { shape: { k: "prim"; type: PrimName } } {
  return a.shape.k === "prim" && a.term?.op === "lit";
}

/** 字面量 → prim（去 term/pred）；非 lit 原样 */
export function widenAbsPrim(a: Abs): Abs {
  if (a.shape.k === "prim" && a.term?.op === "lit") {
    return { shape: a.shape, conf: a.conf === "exact" ? "path" : a.conf };
  }
  return a;
}

/**
 * 多成员聚合：保 lit 为 sum；超过阈值且同 prim lit → 塌为 prim
 * （对齐 collapseLiteralUnion 语义）。
 */
export function collapseAbsLits(members: Abs[], maxLits: number): Abs {
  const uniq: Abs[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const k = absStructureKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(m);
  }
  if (uniq.length === 0) return neverAbs;
  if (uniq.length === 1) return uniq[0]!;
  if (uniq.length > maxLits && uniq.every(isPrimLit)) {
    const t = uniq[0]!.shape.type;
    if (uniq.every((m) => m.shape.k === "prim" && m.shape.type === t)) {
      return { shape: { k: "prim", type: t }, conf: "path" };
    }
  }
  return { shape: { k: "sum", members: uniq }, conf: "exact" };
}

/** 实参位聚合：join 后 widen lit → prim */
export function widenJoinAbs(members: Abs[]): Abs {
  return widenAbsPrim(joinAllAbs(members));
}
