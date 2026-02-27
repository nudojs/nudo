import { type TypeValue, type Refinement, T } from "../type-value.ts";

export type RangeMeta = {
  min?: number;
  max?: number;
  integer?: boolean;
};

function formatRangeName(meta: RangeMeta): string {
  const parts: string[] = [];
  if (meta.integer) parts.push("integer");
  else parts.push("number");

  const constraints: string[] = [];
  if (meta.min != null) constraints.push(`>= ${meta.min}`);
  if (meta.max != null) constraints.push(`<= ${meta.max}`);
  if (constraints.length > 0) parts.push(`(${constraints.join(", ")})`);

  return parts.join(" ");
}

function createRangeRefinement(meta: RangeMeta): Refinement {
  return {
    name: formatRangeName(meta),
    meta: { ...meta },
    check(value: unknown) {
      if (typeof value !== "number") return false;
      if (meta.integer && !Number.isInteger(value)) return false;
      if (meta.min != null && value < meta.min) return false;
      if (meta.max != null && value > meta.max) return false;
      return true;
    },
    ops: {
      ">="(self: TypeValue, other: TypeValue) {
        const m = getRangeMeta(self);
        if (!m || other.kind !== "literal" || typeof other.value !== "number") return undefined;
        if (m.min != null && m.min >= other.value) return T.literal(true);
        if (m.max != null && m.max < other.value) return T.literal(false);
        return undefined;
      },
      ">"(self: TypeValue, other: TypeValue) {
        const m = getRangeMeta(self);
        if (!m || other.kind !== "literal" || typeof other.value !== "number") return undefined;
        if (m.min != null && m.min > other.value) return T.literal(true);
        if (m.max != null && m.max <= other.value) return T.literal(false);
        return undefined;
      },
      "<="(self: TypeValue, other: TypeValue) {
        const m = getRangeMeta(self);
        if (!m || other.kind !== "literal" || typeof other.value !== "number") return undefined;
        if (m.max != null && m.max <= other.value) return T.literal(true);
        if (m.min != null && m.min > other.value) return T.literal(false);
        return undefined;
      },
      "<"(self: TypeValue, other: TypeValue) {
        const m = getRangeMeta(self);
        if (!m || other.kind !== "literal" || typeof other.value !== "number") return undefined;
        if (m.max != null && m.max < other.value) return T.literal(true);
        if (m.min != null && m.min >= other.value) return T.literal(false);
        return undefined;
      },
    },
  };
}

export function createRange(meta: RangeMeta): TypeValue {
  if (meta.min != null && meta.max != null && meta.min === meta.max) {
    return T.literal(meta.min);
  }
  return T.refine(T.number, createRangeRefinement(meta));
}

export function isRange(tv: TypeValue): boolean {
  if (tv.kind !== "refined") return false;
  const m = tv.refinement.meta;
  return m.min !== undefined || m.max !== undefined || m.integer !== undefined;
}

export function getRangeMeta(tv: TypeValue): RangeMeta | undefined {
  if (tv.kind !== "refined") return undefined;
  const m = tv.refinement.meta;
  if (m.min !== undefined || m.max !== undefined || m.integer !== undefined) {
    return m as RangeMeta;
  }
  return undefined;
}
