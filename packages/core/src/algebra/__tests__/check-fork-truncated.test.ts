/**
 * check 观测面：fork 超限 → nudo:fork-truncated（**info**，预算观测非质量失败）。
 * 与 nudo:recursion-truncated 同 collector 管道，但专用码/专用标签。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { setBForkBudgetLimit, resetAbsCallBudget, MAX_B_TOTAL_FORKS } from "@nudojs/core/internal";

describe("nudo:fork-truncated diagnostic (checkSource)", () => {
  beforeEach(() => {
    resetAbsCallBudget();
    setBForkBudgetLimit(MAX_B_TOTAL_FORKS);
  });
  afterEach(() => {
    setBForkBudgetLimit(MAX_B_TOTAL_FORKS);
    resetAbsCallBudget();
  });

  it("under default budget: no fork-truncated on ordinary branching", () => {
    const src = `
export function abs(n) {
  if (n > 0) return n;
  if (n < 0) return -n;
  return 0;
}
`;
    const r = checkSource("t.js", src, pTrue);
    expect(r.issues.filter((i) => i.code === "nudo:fork-truncated")).toHaveLength(0);
  });

  it("fork budget exhausted → nudo:fork-truncated info (not error, not recursion-truncated)", () => {
    setBForkBudgetLimit(1);
    const src = `
export function branchy(n) {
  if (n > 0) { n = n - 1; }
  if (n > 1) { n = n - 2; }
  return n;
}
`;
    const r = checkSource("t.js", src, pTrue);
    const forks = r.issues.filter((i) => i.code === "nudo:fork-truncated");
    expect(forks.length).toBeGreaterThanOrEqual(1);
    for (const f of forks) {
      expect(f.severity).toBe("info");
    }
    // 不得把 fork 截断误报成递归截断
    expect(r.issues.filter((i) => i.code === "nudo:recursion-truncated")).toHaveLength(0);
  });
});
