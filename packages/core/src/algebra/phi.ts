/**
 * 路径约束栈（Φ）。
 *
 * Φ 是当前控制流路径上的合取前提。代数运算（add/cmp/…）读取它做单调传播；
 * evaluator 在 if 守卫处 push/pop。栈属于类型系统，不属于 host CLI。
 */

import type { Phi } from "./pred.ts";
import { pTrue } from "./pred.ts";

let phiStack: Phi[] = [pTrue];

export function currentPhi(): Phi {
  return phiStack[phiStack.length - 1] ?? pTrue;
}

export function pushPhi(p: Phi): void {
  phiStack.push(p);
}

export function popPhi(): void {
  if (phiStack.length > 1) phiStack.pop();
}

export function resetPhi(): void {
  phiStack = [pTrue];
}

/** 在当前 Φ 上合取额外约束，body 结束后恢复 */
export function withPhiConstraint(extra: Phi, body: () => void): void {
  pushPhi(extra);
  try {
    body();
  } finally {
    popPhi();
  }
}

export function describePhi(): string {
  const p = currentPhi();
  return p.op === "true" ? "⊤" : "(phi)";
}
