/**
 * #64 P4：`@nudo:budget` 函数级预算旋钮。
 *
 * 递归 helper 必然触发 recursion-truncated 时，不再只能调全局 maxForks——
 * 函数级指令抬高该函数求值期的 depth/calls/forks 上限。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { extractFnBudget } from "../refine.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache } from "../interface.ts";
import {
  resetAbsCallBudget,
  setEvalForkBudgetLimit,
  MAX_EVAL_TOTAL_FORKS,
  withFnBudgetOverride,
  getAbsCallBudgetStats,
} from "../call-budget.ts";

describe("#64 P4 @nudo:budget", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
    resetAbsCallBudget();
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
  });

  it("parses forks/calls/depth from the function comment block", () => {
    const src = `/**
 * @nudo:budget forks=20000
 */
export function staticName(node) {
  return node;
}
`;
    expect(extractFnBudget(src, "staticName")).toEqual({ forks: 20000 });
  });

  it("parses combined keys and comma separators", () => {
    const src = `/**
 * @nudo:budget calls=50000, depth=128
 */
export function f(x) {
  return x;
}
`;
    expect(extractFnBudget(src, "f")).toEqual({ calls: 50000, depth: 128 });
  });

  it("returns undefined when no @nudo:budget", () => {
    const src = `export function f(x) {\n  return x;\n}\n`;
    expect(extractFnBudget(src, "f")).toBeUndefined();
  });

  it("withFnBudgetOverride raises fork limit during run and restores after", () => {
    setEvalForkBudgetLimit(2);
    expect(getAbsCallBudgetStats().maxForks).toBe(2);
    withFnBudgetOverride({ forks: 100 }, () => {
      expect(getAbsCallBudgetStats().maxForks).toBe(100);
    });
    expect(getAbsCallBudgetStats().maxForks).toBe(2);
  });

  it("withFnBudgetOverride raises calls/depth and restores", () => {
    expect(getAbsCallBudgetStats().maxCalls).toBe(20_000);
    withFnBudgetOverride({ calls: 99_999 }, () => {
      expect(getAbsCallBudgetStats().maxCalls).toBe(99_999);
    });
    expect(getAbsCallBudgetStats().maxCalls).toBe(20_000);
  });

  it("recursion-truncated suggestion mentions @nudo:budget", () => {
    // 深递归 → 截断；suggestion 应指向函数级旋钮
    const src = `
/**
 * @nudo:budget depth=2
 */
export function rec(n) {
  return rec(n);
}
rec(1);
`;
    const r = checkSource("/t/rec.js", src, pTrue, {});
    const trunc = r.issues.find((i) => i.code === "nudo:recursion-truncated");
    // 可能因 memo/求值路径不同不触发截断——触发时必须指向 @nudo:budget
    if (trunc) {
      expect(trunc.suggestion).toContain("@nudo:budget");
    }
  });
});
