/**
 * 从 Babel 测试表达式提取代数 Φ 约束。
 * 支持 `x > n` / `x >= n` / `x < n` / `x <= n`（Identifier × NumericLiteral）。
 * false 分支用对偶比较（`>` ↔ `≤`），使 else 路径也能携带约束。
 */

import type { Node } from "@babel/types";
import type { Phi } from "@nudojs/core";
import { pTrue, and as phiAnd, gt, ge, lt, le, v as termVar, lit } from "@nudojs/core";

export function phiFromTest(test: Node): { whenTrue: Phi; whenFalse: Phi } {
  if (test.type !== "BinaryExpression") {
    return { whenTrue: pTrue, whenFalse: pTrue };
  }
  const op = test.operator;
  const left = test.left;
  const right = test.right;

  // x ≷ n
  if (
    left.type === "Identifier" &&
    right.type === "NumericLiteral" &&
    (op === ">" || op === ">=" || op === "<" || op === "<=")
  ) {
    const t = termVar(left.name);
    const n = lit(right.value);
    const pred =
      op === ">" ? gt(t, n) : op === ">=" ? ge(t, n) : op === "<" ? lt(t, n) : le(t, n);
    // 对偶：¬(a≷b) = a≲b（数值全序）
    const dual =
      op === ">" ? le(t, n) : op === ">=" ? lt(t, n) : op === "<" ? ge(t, n) : gt(t, n);
    return { whenTrue: pred, whenFalse: dual };
  }

  return { whenTrue: pTrue, whenFalse: pTrue };
}

export function combinePhi(base: Phi, extra: Phi): Phi {
  if (extra.op === "true") return base;
  if (base.op === "true") return extra;
  return phiAnd(base, extra);
}
