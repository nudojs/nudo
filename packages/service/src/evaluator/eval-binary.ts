/**
 * 二元运算统一入口：代数优先，语言表面回落 Ops。
 * TypeValue 是 IR；+ - * / % 比较与数值相等走 Abs，其余外延。
 */

import {
  type TypeValue,
  T,
  simplifyUnion,
  dispatchBinaryOp,
} from "@nudojs/core";
import { tryAbsBinary } from "./abs-route.ts";

const MAX_UNION_PRODUCT = 64;

export function looseLiteralValue(
  tv: TypeValue,
): { hit: boolean; v: number | string | boolean | null | undefined } {
  if (tv.kind === "literal") {
    const v = tv.value;
    if (
      typeof v === "number" ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      v === null ||
      v === undefined
    ) {
      return { hit: true, v };
    }
  }
  return { hit: false, v: undefined };
}

export function distributeBinaryOverUnion(
  left: TypeValue,
  right: TypeValue,
  fn: (l: TypeValue, r: TypeValue) => TypeValue,
): TypeValue {
  if (left.kind === "union" && right.kind === "union") {
    if (left.members.length * right.members.length > MAX_UNION_PRODUCT) {
      return T.unknown;
    }
    return simplifyUnion(
      left.members.flatMap((l) => right.members.map((r) => fn(l, r))),
    );
  }
  if (left.kind === "union") {
    return simplifyUnion(left.members.map((l) => fn(l, right)));
  }
  if (right.kind === "union") {
    return simplifyUnion(right.members.map((r) => fn(left, r)));
  }
  return fn(left, right);
}

const ALGEBRA_OPS = new Set([
  "+", "-", "*", "/", "%",
  "<", "<=", ">", ">=",
  "===", "!==",
]);

/** 数值运算形状：任一侧 number/unknown 时，`- * / %` 结果至少是 number */
function numberish(tv: TypeValue): boolean {
  if (!tv) return false;
  if (tv.kind === "unknown") return true;
  if (tv.kind === "literal") return typeof tv.value === "number";
  if (tv.kind === "primitive") return tv.type === "number";
  if (tv.kind === "refined") return numberish(tv.base);
  return false;
}

/**
 * 纯值级二元运算（不需要 AST/env）。
 * 返回 undefined 表示调用方需处理 node 特例（instanceof / in / builtin identity）。
 */
export function evalBinaryValue(
  operator: string,
  left: TypeValue,
  right: TypeValue,
): TypeValue | undefined {
  if (operator === "instanceof" || operator === "in") return undefined;

  if (ALGEBRA_OPS.has(operator)) {
    const absResult = tryAbsBinary(operator, left, right);
    if (absResult !== undefined) return absResult;
  }

  if (operator === "==" || operator === "!=") {
    const eq = operator === "==";
    return distributeBinaryOverUnion(left, right, (l, r) => {
      const lv = looseLiteralValue(l);
      const rv = looseLiteralValue(r);
      if (lv.hit && rv.hit) return T.literal(eq ? lv.v == rv.v : lv.v != rv.v);
      return T.boolean;
    });
  }

  // refined 自定义 ops / Ops.add·比较 / nullish ===
  const viaDispatch = distributeBinaryOverUnion(left, right, (l, r) =>
    dispatchBinaryOp(operator, l, r),
  );

  // 代数与 refinement 都未接住时的数值形状：`unknown * 2` → number
  if (
    viaDispatch.kind === "unknown" &&
    (operator === "-" || operator === "*" || operator === "/" || operator === "%") &&
    (numberish(left) || numberish(right))
  ) {
    return T.number;
  }

  return viaDispatch;
}
