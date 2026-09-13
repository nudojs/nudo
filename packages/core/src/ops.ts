/**
 * 残差 IR 兜底（不是类型运算真理源）。
 *
 * 真理在 algebra：算术/比较/相等/typeof/!/−/字符串词法序/nullish 均走 Abs。
 * 这里只保留：
 * - add：代数拒绝时的混合 `+`
 * - 比较/相等：代数无法判定时的保守 boolean / 字面量折叠
 * - dispatchMethod/Property：宿主 refined 扩展（startsWith、length…）
 */
import { type TypeValue, type LiteralValue, T, isSubtypeOf } from "./type-value.ts";
import { concatTemplates, isTemplate } from "./refinements/template.ts";

function bothLiteral(
  l: TypeValue,
  r: TypeValue,
): { lv: LiteralValue; rv: LiteralValue } | null {
  if (l.kind === "literal" && r.kind === "literal") {
    return { lv: l.value, rv: r.value };
  }
  return null;
}

function isNullishLiteral(tv: TypeValue): boolean {
  return tv.kind === "literal" && (tv.value === null || tv.value === undefined);
}

function definitelyNotNullish(tv: TypeValue): boolean {
  switch (tv.kind) {
    case "literal":
      return tv.value !== null && tv.value !== undefined;
    case "primitive":
    case "object":
    case "array":
    case "tuple":
    case "function":
    case "instance":
    case "promise":
      return true;
    case "refined":
      return definitelyNotNullish(tv.base);
    case "union":
      return tv.members.every(definitelyNotNullish);
    default:
      return false;
  }
}

export const Ops = {
  add(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) {
      return T.literal((lit.lv as any) + (lit.rv as any));
    }
    const leftIsString = isSubtypeOf(left, T.string) || isTemplate(left);
    const rightIsString = isSubtypeOf(right, T.string) || isTemplate(right);
    if (leftIsString || rightIsString) {
      const hasStructure =
        (left.kind === "literal" && typeof left.value === "string") ||
        (right.kind === "literal" && typeof right.value === "string") ||
        isTemplate(left) || isTemplate(right);
      if (hasStructure) {
        return concatTemplates(left, right);
      }
      return T.string;
    }
    if (isSubtypeOf(left, T.number) && isSubtypeOf(right, T.number)) {
      return T.number;
    }
    return T.union(T.number, T.string);
  },

  strictEq(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) return T.literal(lit.lv === lit.rv);
    if ((isNullishLiteral(right) && definitelyNotNullish(left)) ||
        (isNullishLiteral(left) && definitelyNotNullish(right))) {
      return T.literal(false);
    }
    return T.boolean;
  },

  strictNeq(left: TypeValue, right: TypeValue): TypeValue {
    const lit = bothLiteral(left, right);
    if (lit) return T.literal(lit.lv !== lit.rv);
    if ((isNullishLiteral(right) && definitelyNotNullish(left)) ||
        (isNullishLiteral(left) && definitelyNotNullish(right))) {
      return T.literal(true);
    }
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

  not(operand: TypeValue): TypeValue {
    if (operand.kind === "literal") return T.literal(!operand.value);
    return T.boolean;
  },
} as const;

const binaryOpMap: Record<string, (l: TypeValue, r: TypeValue) => TypeValue> = {
  "+": Ops.add,
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

export function dispatchBinaryOp(
  op: string,
  left: TypeValue,
  right: TypeValue,
): TypeValue {
  if (left.kind === "refined" && left.refinement.ops?.[op]) {
    const result = left.refinement.ops[op](left, right);
    if (result !== undefined) return result;
  }
  if (right.kind === "refined" && right.refinement.ops?.[op]) {
    const result = right.refinement.ops[op](right, left);
    if (result !== undefined) return result;
  }

  const baseLeft = left.kind === "refined" ? left.base : left;
  const baseRight = right.kind === "refined" ? right.base : right;
  if (baseLeft !== left || baseRight !== right) {
    return dispatchBinaryOp(op, baseLeft, baseRight);
  }
  return applyBinaryOp(op, left, right);
}

export function dispatchMethod(
  receiver: TypeValue,
  name: string,
  args: TypeValue[],
): TypeValue | undefined {
  if (receiver.kind === "refined" && receiver.refinement.methods?.[name]) {
    const result = receiver.refinement.methods[name](receiver, args);
    if (result !== undefined) return result;
  }
  if (receiver.kind === "refined") {
    return dispatchMethod(receiver.base, name, args);
  }
  return undefined;
}

export function dispatchProperty(
  receiver: TypeValue,
  name: string,
): TypeValue | undefined {
  if (receiver.kind === "refined" && receiver.refinement.properties?.[name]) {
    const result = receiver.refinement.properties[name](receiver);
    if (result !== undefined) return result;
  }
  if (receiver.kind === "refined") {
    return dispatchProperty(receiver.base, name);
  }
  return undefined;
}
