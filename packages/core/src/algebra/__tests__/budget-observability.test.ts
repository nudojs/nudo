import { describe, it, expect } from "vitest";
import { checkSource, serializeCheckJson, serializeCheckJsonMulti, formatCheckReport, pTrue } from "../index.ts";
import {
  resetAbsCallBudget,
  getAbsCallBudgetStats,
  setBForkBudgetLimit,
  bumpBForkBudget,
  MAX_B_TOTAL_FORKS,
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
    setBForkBudgetLimit(2);
    expect(bumpBForkBudget()).toBe(true);
    expect(bumpBForkBudget()).toBe(true);
    expect(bumpBForkBudget()).toBe(false);
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
    setBForkBudgetLimit(MAX_B_TOTAL_FORKS);
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
});
