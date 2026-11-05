/**
 * 项（Term）防爆炸的预算判定：深度/宽度阈值（leak 替换机制已随
 * maybeLeak 删除——预算消费方现只用 exceedsBudget 做门槛判定）。
 */

import type { Term } from "../term.ts";

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
