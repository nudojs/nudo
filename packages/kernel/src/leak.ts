/**
 * 项（Term）防爆炸：深度/宽度阈值 → leak 为新鲜 var + 等式约束。
 */

import type { Term } from "./term.ts";
import { v, termToString, termEquals, app, lit } from "./term.ts";
import type { Pred } from "./pred.ts";
import { eq, and } from "./pred.ts";
import type { Abs } from "./abs.ts";
import { abs, confJoin } from "./abs.ts";

export type LeakBudget = {
  maxDepth: number;
  maxNodes: number;
};

export const defaultLeakBudget: LeakBudget = {
  maxDepth: 6,
  maxNodes: 32,
};

export function termDepth(t: Term): number {
  if (t.op !== "app") return 1;
  return 1 + Math.max(0, ...t.args.map(termDepth));
}

export function termNodes(t: Term): number {
  if (t.op !== "app") return 1;
  return 1 + t.args.reduce((s, x) => s + termNodes(x), 0);
}

export function exceedsBudget(t: Term, budget: LeakBudget = defaultLeakBudget): boolean {
  return termDepth(t) > budget.maxDepth || termNodes(t) > budget.maxNodes;
}

let leakCounter = 0;

export function resetLeakCounter(): void {
  leakCounter = 0;
}

/**
 * 若项超预算，替换为新鲜变量，并返回附加等式 pred：fresh = originalTerm。
 * 未超预算则原样返回。
 */
export function maybeLeak(
  a: Abs,
  budget: LeakBudget = defaultLeakBudget,
  label = "t",
): Abs {
  if (!a.term || a.term.op !== "app") return a;
  if (!exceedsBudget(a.term, budget)) return a;

  leakCounter += 1;
  const id = `${label}$${leakCounter}`;
  const fresh: Term = v(id);
  const linkage: Pred = eq(fresh, a.term);
  // pred：原 pred 中的 term 无法直接替换（pred 相对旧 term），改为只挂 linkage
  // 置信度：仍 path，但标注 leaked
  return abs(a.shape, fresh, linkage, confJoin(a.conf, "path"));
}

/**
 * 批量：在算术结果上应用 leak。
 */
export function leakIfNeeded(a: Abs, budget?: LeakBudget, label?: string): Abs {
  return maybeLeak(a, budget, label);
}
