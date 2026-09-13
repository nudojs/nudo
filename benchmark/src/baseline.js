/**
 * Benchmark Baseline - snapshot the latest run as the regression baseline.
 * `pnpm run benchmark:baseline` after a verified-good `pnpm run benchmark`.
 */

import { readFileSync, writeFileSync } from "fs";

const LATEST = "./benchmark/results/latest.json";
const BASELINE = "./benchmark/baseline.json";

const latest = JSON.parse(readFileSync(LATEST, "utf-8"));
const { summary, results } = latest;

const baseline = {
  updatedAt: new Date().toISOString(),
  totalCases: summary.totalCases,
  results: summary.results,
  averageTimeMs: parseFloat(summary.performance.averageTimeMs),
  // 逐 case 精度对比所需的最小视图（full output 不入库）
  cases: results.map((r) => ({ id: r.id, name: r.name, comparison: r.comparison })),
};

writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
console.log(
  `Baseline updated: ${baseline.totalCases} cases, ` +
    `${baseline.results.exactMatches} exact, unknown ${baseline.results.unknownCount}, ` +
    `avg ${baseline.averageTimeMs}ms.`,
);
