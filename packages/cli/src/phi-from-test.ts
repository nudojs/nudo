/**
 * 从 Babel 测试表达式提取代数 Φ 约束。
 * 仅处理 `x > n` / `x >= n` / `x < n` / `x <= n` 的 Identifier 形式。
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

  // x > n
  if (
    left.type === "Identifier" &&
    right.type === "NumericLiteral" &&
    (op === ">" || op === ">=" || op === "<" || op === "<=")
  ) {
    const t = termVar(left.name);
    const n = lit(right.value);
    const pred =
      op === ">" ? gt(t, n) : op === ">=" ? ge(t, n) : op === "<" ? lt(t, n) : le(t, n);
    // 简化：false 分支用否定（Phase M1 仅 true 分支）
    return { whenTrue: pred, whenFalse: pTrue };
  }

  return { whenTrue: pTrue, whenFalse: pTrue };
}

export function combinePhi(base: Phi, extra: Phi): Phi {
  if (extra.op === "true") return base;
  if (base.op === "true") return extra;
  return phiAnd(base, extra);
}
