import { type TypeValue, type Refinement, T } from "../type-value.ts";

export type RangeMeta = {
  min?: number;
  max?: number;
  /** 下界开区间：value > min（JS 实数，不能写成 >= min+1） */
  minExclusive?: boolean;
  /** 上界开区间：value < max */
  maxExclusive?: boolean;
  integer?: boolean;
};

function formatRangeName(meta: RangeMeta): string {
  const parts: string[] = [];
  if (meta.integer) parts.push("integer");
  else parts.push("number");

  const constraints: string[] = [];
  if (meta.min != null) {
    constraints.push(meta.minExclusive ? `> ${meta.min}` : `>= ${meta.min}`);
  }
  if (meta.max != null) {
    constraints.push(meta.maxExclusive ? `< ${meta.max}` : `<= ${meta.max}`);
  }
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
      if (meta.min != null) {
        if (meta.minExclusive ? value <= meta.min : value < meta.min) return false;
      }
      if (meta.max != null) {
        if (meta.maxExclusive ? value >= meta.max : value > meta.max) return false;
      }
      return true;
    },
    ops: {
      ">="(self: TypeValue, other: TypeValue) {
        const m = getRangeMeta(self);
        if (!m || other.kind !== "literal" || typeof other.value !== "number") return undefined;
        if (m.min != null) {
          if (m.minExclusive && m.min >= other.value) return T.literal(true);
          if (!m.minExclusive && m.min >= other.value) return T.literal(true);
        }
        if (m.max != null) {
          if (m.maxExclusive && m.max <= other.value) return T.literal(false);
          if (!m.maxExclusive && m.max < other.value) return T.literal(false);
        }
        return undefined;
      },
      ">"(self: TypeValue, other: TypeValue) {
        const m = getRangeMeta(self);
        if (!m || other.kind !== "literal" || typeof other.value !== "number") return undefined;
        if (m.min != null) {
          if (m.minExclusive && m.min >= other.value) return T.literal(true);
          if (!m.minExclusive && m.min > other.value) return T.literal(true);
        }
        if (m.max != null) {
          if (m.max <= other.value) return T.literal(false);
        }
        return undefined;
      },
      "<="(self: TypeValue, other: TypeValue) {
        const m = getRangeMeta(self);
        if (!m || other.kind !== "literal" || typeof other.value !== "number") return undefined;
        if (m.max != null) {
          if (m.maxExclusive && m.max <= other.value) return T.literal(true);
          if (!m.maxExclusive && m.max <= other.value) return T.literal(true);
        }
        if (m.min != null) {
          if (m.minExclusive && m.min >= other.value) return T.literal(false);
          if (!m.minExclusive && m.min > other.value) return T.literal(false);
        }
        return undefined;
      },
      "<"(self: TypeValue, other: TypeValue) {
        const m = getRangeMeta(self);
        if (!m || other.kind !== "literal" || typeof other.value !== "number") return undefined;
        if (m.max != null) {
          if (m.maxExclusive && m.max <= other.value) return T.literal(true);
          if (!m.maxExclusive && m.max < other.value) return T.literal(true);
        }
        if (m.min != null) {
          if (m.min >= other.value) return T.literal(false);
        }
        return undefined;
      },
    },
  };
}

export function createRange(meta: RangeMeta): TypeValue {
  if (
    meta.min != null &&
    meta.max != null &&
    meta.min === meta.max &&
    !meta.minExclusive &&
    !meta.maxExclusive
  ) {
    return T.literal(meta.min);
  }
  return T.refine(T.number, createRangeRefinement(meta));
}

export function isRange(tv: TypeValue): boolean {
  if (tv.kind !== "refined") return false;
  const m = tv.refinement.meta;
  return (
    m.min !== undefined ||
    m.max !== undefined ||
    m.minExclusive !== undefined ||
    m.maxExclusive !== undefined ||
    m.integer !== undefined
  );
}

export function getRangeMeta(tv: TypeValue): RangeMeta | undefined {
  if (tv.kind !== "refined") return undefined;
  const m = tv.refinement.meta;
  if (
    m.min !== undefined ||
    m.max !== undefined ||
    m.minExclusive !== undefined ||
    m.maxExclusive !== undefined ||
    m.integer !== undefined
  ) {
    return m as RangeMeta;
  }
  return undefined;
}
