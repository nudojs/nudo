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

  it("budget still found when string contains same fn name", () => {
    const src = `const s = "function f() {}";\n/**\n * @nudo:budget forks=20000\n */\nexport function f(x) {\n  return x;\n}\n`;
    expect(extractFnBudget(src, "f")).toEqual({ forks: 20000 });
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

  it("recursion-truncated suggestion follows the truncation reason (#158)", () => {
    // 同实参自递归 → 调用环（cycle）：不得把用户引向抬预算；
    // 实参逐层变化 + 深度封顶 → 真预算：指向函数级旋钮并指明维度
    const cycSrc = `
/**
 * @nudo:budget depth=2
 */
export function rec(n) {
  return rec(n);
}
rec(1);
`;
    const cyc = checkSource("/t/rec-cycle.js", cycSrc, pTrue, {});
    const cycTrunc = cyc.issues.find((i) => i.code === "nudo:recursion-truncated");
    if (cycTrunc) {
      expect(cycTrunc.reason).toBe("cycle");
      expect(cycTrunc.suggestion).toContain("will not change this");
    }

    const depthSrc = `
/**
 * @nudo:budget depth=2
 */
export function down(n) {
  if (n <= 0) { return 0; }
  return down(n - 1);
}
down(9);
`;
    const dep = checkSource("/t/rec-depth.js", depthSrc, pTrue, {});
    const depTrunc = dep.issues.find((i) => i.code === "nudo:recursion-truncated");
    if (depTrunc) {
      expect(depTrunc.reason).toBe("depth");
      expect(depTrunc.suggestion).toContain("@nudo:budget depth=");
    }
  });
});
