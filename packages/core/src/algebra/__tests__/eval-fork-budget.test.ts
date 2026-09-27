/**
 * B $fork 总次数预算（MAX_EVAL_TOTAL_FORKS 策略）：
 * - 超限结果 unknown（保守）且截断经 collector 上报（FORK_TRUNCATION_LABEL）
 * - setEvalForkBudgetLimit(1)：第二次 fork 放弃
 * - resetAbsCallBudget / resetEvalCallBudget 重置 fork 计数
 * - setEvalForkBudgetLimit 非法值回默认 5000
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { $fork, $lit, abs, unknown as unknownAbs } from "@nudojs/core";
import { setAbsTruncationCollector, resetAbsCallBudget, setEvalForkBudgetLimit, getEvalForkBudgetLimit, getEvalForkCount, bumpEvalForkBudget, noteEvalForkTruncation, FORK_TRUNCATION_LABEL, MAX_EVAL_TOTAL_FORKS } from "@nudojs/core/internal";

function abstractBool() {
  return abs({ k: "prim", type: "boolean" } as never, undefined, undefined, "path" as never);
}

describe("B fork budget (MAX_EVAL_TOTAL_FORKS)", () => {
  beforeEach(() => {
    resetAbsCallBudget();
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
  });
  afterEach(() => {
    setAbsTruncationCollector(null);
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
    resetAbsCallBudget();
  });

  it("default limit is 5000", () => {
    expect(getEvalForkBudgetLimit()).toBe(5000);
    expect(MAX_EVAL_TOTAL_FORKS).toBe(5000);
  });

  it("under-limit fork evaluates both arms (no truncation note)", () => {
    const seen: string[] = [];
    setAbsTruncationCollector((l) => seen.push(l));
    const r = $fork(abstractBool(), () => $lit(1), () => $lit(2));
    expect(r.shape.k).not.toBe("unknown");
    expect(seen).toEqual([]);
    expect(getEvalForkCount()).toBe(1);
  });

  it("setEvalForkBudgetLimit(1): second fork abandons to unknown and notes truncation", () => {
    expect(setEvalForkBudgetLimit(1)).toBe(1);
    const seen: string[] = [];
    setAbsTruncationCollector((l) => seen.push(l));
    const ok = $fork(abstractBool(), () => $lit(1), () => $lit(2));
    expect(ok.shape.k).not.toBe("unknown");
    const abandoned = $fork(abstractBool(), () => $lit(3), () => $lit(4));
    expect(abandoned.shape.k).toBe("unknown");
    expect(seen).toContain(FORK_TRUNCATION_LABEL);
  });

  it("over-limit result is unknown (conservative) and collector records fork truncation", () => {
    expect(setEvalForkBudgetLimit(2)).toBe(2);
    const seen: string[] = [];
    setAbsTruncationCollector((l) => seen.push(l));
    $fork(abstractBool(), () => $lit(1));
    $fork(abstractBool(), () => $lit(2));
    const r = $fork(abstractBool(), () => $lit(3), () => $lit(4));
    expect(r).toBe(unknownAbs);
    expect(seen).toContain(FORK_TRUNCATION_LABEL);
    // 同一轮只 note 一次（避免 collector 刷屏）
    $fork(abstractBool(), () => $lit(5));
    expect(seen.filter((l) => l === FORK_TRUNCATION_LABEL)).toHaveLength(1);
  });

  it("resetAbsCallBudget resets fork count", () => {
    setEvalForkBudgetLimit(1);
    expect(bumpEvalForkBudget()).toBe(true);
    expect(bumpEvalForkBudget()).toBe(false);
    expect(getEvalForkCount()).toBeGreaterThan(1);
    resetAbsCallBudget();
    expect(getEvalForkCount()).toBe(0);
    expect(bumpEvalForkBudget()).toBe(true);
  });

  it("setEvalForkBudgetLimit: invalid values fall back to default 5000", () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity, 0.5]) {
      expect(setEvalForkBudgetLimit(bad)).toBe(MAX_EVAL_TOTAL_FORKS);
      expect(getEvalForkBudgetLimit()).toBe(MAX_EVAL_TOTAL_FORKS);
    }
    expect(setEvalForkBudgetLimit(10)).toBe(10);
    expect(setEvalForkBudgetLimit(10.9)).toBe(10); // floor
  });

  it("noteEvalForkTruncation uses the reserved fork label (not a fn name)", () => {
    const seen: string[] = [];
    setAbsTruncationCollector((l) => seen.push(l));
    noteEvalForkTruncation();
    expect(seen).toEqual([FORK_TRUNCATION_LABEL]);
    expect(FORK_TRUNCATION_LABEL).toBe("#fork-budget");
  });
});
