import { type TypeValue, T, isSubtypeOf } from "./type-value.ts";

function bothLiteral(
  l: TypeValue,
  r: TypeValue,
): { lv: string | number | boolean | null | undefined; rv: string | number | boolean | null | undefined } | null {
  if (l.kind === "literal" && r.kind === "literal") {
    return { lv: l.value, rv: r.value };
  }
  return null;
}

export const Ops = {
  add(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) {
      return T.literal((lit.lv as any) + (lit.rv as any));
    }
    if (isSubtypeOf(left, T.string) || isSubtypeOf(right, T.string)) {
      return T.string;
    }
    if (isSubtypeOf(left, T.number) && isSubtypeOf(right, T.number)) {
      return T.number;
    }
    return T.union(T.number, T.string);
  },

  sub(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit && typeof lit.lv === "number" && typeof lit.rv === "number") {
      return T.literal(lit.lv - lit.rv);
    }
    return T.number;
  },

  mul(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit && typeof lit.lv === "number" && typeof lit.rv === "number") {
      return T.literal(lit.lv * lit.rv);
    }
    return T.number;
  },

  div(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit && typeof lit.lv === "number" && typeof lit.rv === "number") {
      return T.literal(lit.lv / lit.rv);
    }
    return T.number;
  },

  mod(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit && typeof lit.lv === "number" && typeof lit.rv === "number") {
      return T.literal(lit.lv % lit.rv);
    }
    return T.number;
  },

  strictEq(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) return T.literal(lit.lv === lit.rv);
    return T.boolean;
  },

  strictNeq(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) return T.literal(lit.lv !== lit.rv);
    return T.boolean;
  },

  gt(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) return T.literal((lit.lv as any) > (lit.rv as any));
    return T.boolean;
  },

  lt(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) return T.literal((lit.lv as any) < (lit.rv as any));
    return T.boolean;
  },

  gte(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) return T.literal((lit.lv as any) >= (lit.rv as any));
    return T.boolean;
  },

  lte(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) return T.literal((lit.lv as any) <= (lit.rv as any));
    return T.boolean;
  },

  typeof_(operand: TypeValue): TypeValue {
    if (operand.kind === "literal") {
      const v = operand.value;
      if (v === null) return T.literal("object");
      return T.literal(typeof v);
    }
    if (operand.kind === "primitive") return T.literal(operand.type);
    if (operand.kind === "object") return T.literal("object");
    if (operand.kind === "array" || operand.kind === "tuple")
      return T.literal("object");
    if (operand.kind === "function") return T.literal("function");
    if (operand.kind === "promise") return T.literal("object");
    if (operand.kind === "instance") return T.literal("object");
    return T.string;
  },

  not(operand: TypeValue): TypeValue {
    if (operand.kind === "literal") return T.literal(!operand.value);
    return T.boolean;
  },

  neg(operand: TypeValue): TypeValue {
    if (operand.kind === "literal" && typeof operand.value === "number") {
      return T.literal(-operand.value);
    }
    return T.number;
  },
} as const;

const binaryOpMap: Record<string, (l: TypeValue, r: TypeValue) => TypeValue> = {
  "+": Ops.add,
  "-": Ops.sub,
  "*": Ops.mul,
  "/": Ops.div,
  "%": Ops.mod,
  "===": Ops.strictEq,
  "!==": Ops.strictNeq,
  ">": Ops.gt,
  "<": Ops.lt,
  ">=": Ops.gte,
  "<=": Ops.lte,
};

export function applyBinaryOp(
  op: string,
  left: TypeValue,
  right: TypeValue,
): TypeValue {
  const fn = binaryOpMap[op];
  if (!fn) return T.unknown;
  return fn(left, right);
}
