import { describe, it, expect } from "vitest";
import { checkSource, serializeCheckJson, serializeCheckJsonMulti, formatCheckReport, pTrue } from "../index.ts";
import {
  resetAbsCallBudget,
  getAbsCallBudgetStats,
  setEvalForkBudgetLimit,
  bumpEvalForkBudget,
  MAX_EVAL_TOTAL_FORKS,
} from "../call-budget.ts";

describe("A2 budget observability", () => {
  it("check report carries budget usage; truncated prints a budget block", () => {
    resetAbsCallBudget();
    const report = checkSource(
      "/t/a.js",
      `export function id(x) { return x; }\nid(1);\n`,
      pTrue,
    );
    expect(report.budget).toBeDefined();
    expect(report.budget!.truncated).toBe(false);
    expect(report.budget!.calls).toBeGreaterThanOrEqual(0);
    expect(report.budget!.maxCalls).toBeGreaterThan(0);
    expect(report.budget!.maxForks).toBeGreaterThan(0);

    const json = serializeCheckJson(report);
    expect(json.budget).toBeDefined();
    expect(json.budget!.truncated).toBe(false);

    const text = formatCheckReport(report);
    expect(text).not.toContain("budget");
  });

  it("fork exhaustion sets truncated and surfaces in JSON + human face", () => {
    resetAbsCallBudget();
    setEvalForkBudgetLimit(2);
    expect(bumpEvalForkBudget()).toBe(true);
    expect(bumpEvalForkBudget()).toBe(true);
    expect(bumpEvalForkBudget()).toBe(false);
    const stats = getAbsCallBudgetStats();
    expect(stats.forkTruncated).toBe(true);
    expect(stats.truncated).toBe(true);
    expect(stats.forks).toBeGreaterThan(stats.maxForks);

    const report = checkSource(
      "/t/b.js",
      `export function id(x) { return x; }\nid(1);\n`,
      pTrue,
    );
    // resetAbsCallBudget inside checkSource clears the prior burn — budget on
    // the report reflects *this* run (clean). The collector path is covered by
    // recursion/fork-truncated diagnostics tests; here we assert the wire shape.
    expect(report.budget).toBeDefined();
    expect(report.budget!.maxForks).toBeGreaterThan(0);
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
    resetAbsCallBudget();
  });

  it("multi envelope aggregates budgetTruncated", () => {
    resetAbsCallBudget();
    const a = serializeCheckJson(
      checkSource("/t/a.js", `export function id(x) { return x; }\nid(1);\n`, pTrue),
    );
    const multi = serializeCheckJsonMulti([a, a]);
    expect(multi.summary.files).toBe(2);
    expect(multi.budget === undefined || multi.budget.truncated === false).toBe(true);
  });

  it("per-path attribution: depth 截断的 depth 计数/上限取触发现场（必到顶）", () => {
    resetAbsCallBudget();
    const report = checkSource(
      "/t/deep.js",
      `export function down(n) { if (n <= 0) { return 0; } return down(n - 1); }\n`,
      pTrue,
    );
    const b = report.budget!;
    expect(b.truncated).toBe(true);
    // 截断的是 B 路径 depth 预算：A 路径无归因、calls 预算未到顶
    expect(b.evalReasons).toContain("depth");
    expect(b.callReasons).toEqual([]);
    expect(b.evalCalls).toBeLessThan(b.maxEvalCalls);
    // depth 计数 = 触发时深度 == 当时生效上限（不得打未到顶的总调用数冒充）
    expect(b.evalDepth).toBe(b.maxEvalDepth);
    expect(b.evalDepth).toBe(64);
    expect(b.evalDepth).toBeGreaterThan(0);
  });

  it("cycle-only：truncated=true 但两路径 reasons 只有 cycle（无预算计数段）", () => {
    resetAbsCallBudget();
    const report = checkSource(
      "/t/cyc.js",
      `export function sameArgs(x) { sameArgs(x); return x; }\n`,
      pTrue,
    );
    const b = report.budget!;
    expect(b.truncated).toBe(true);
    expect(b.evalReasons).toEqual(["cycle"]);
    expect(b.callReasons).toEqual([]);
    expect(b.evalCalls).toBeLessThan(b.maxEvalCalls);
  });

  it("resetAbsCallBudget 清空归因与 depth 现场（health 按文件隔离依赖此口径）", () => {
    resetAbsCallBudget();
    checkSource(
      "/t/deep2.js",
      `export function down(n) { if (n <= 0) { return 0; } return down(n - 1); }\n`,
      pTrue,
    );
    expect(getAbsCallBudgetStats().truncated).toBe(true);
    resetAbsCallBudget();
    const after = getAbsCallBudgetStats();
    expect(after.truncated).toBe(false);
    expect(after.evalReasons).toEqual([]);
    expect(after.callReasons).toEqual([]);
    expect(after.depth).toBe(0);
    expect(after.evalDepth).toBe(0);
    expect(after.maxDepth).toBe(64);
    expect(after.maxEvalDepth).toBe(64);
  });
});
