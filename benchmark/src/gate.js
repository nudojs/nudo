/**
 * Benchmark Gate - fail hard on accuracy / error / performance regressions
 * against benchmark/baseline.json. Run after `pnpm run benchmark`.
 *
 * 规则：
 * - case 集规模变化（增删 case）→ 失败，提示更新基线
 * - exact 数下降 / unknown 数上升 / error 数上升 → 失败，逐 case 列出回退
 * - 平均耗时 > 基线的 1.5x → 失败（共享 runner 噪声余量）
 */

import { readFileSync } from "fs";

const LATEST = "./benchmark/results/latest.json";
const BASELINE = "./benchmark/baseline.json";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

const latest = readJson(LATEST);
const baseline = readJson(BASELINE);

if (!latest) {
  console.error("Gate: missing benchmark/results/latest.json — run `pnpm run benchmark` first.");
  process.exit(1);
}
if (!baseline) {
  console.error("Gate: missing benchmark/baseline.json — run `pnpm run benchmark:baseline`.");
  process.exit(1);
}

const { summary, results } = latest;
const current = {
  totalCases: summary.totalCases,
  exact: summary.results.exactMatches,
  partial: summary.results.partialMatches,
  unknown: summary.results.unknownCount,
  error: summary.results.errorCount,
  avgMs: parseFloat(summary.performance.averageTimeMs),
};

const problems = [];

if (current.totalCases !== baseline.totalCases) {
  problems.push(
    `case 集规模变化：${baseline.totalCases} → ${current.totalCases}（新增/删除 case 后请 pnpm run benchmark:baseline 更新基线）`,
  );
} else {
  if (current.exact < baseline.results.exactMatches) {
    problems.push(`exact 回退：${baseline.results.exactMatches} → ${current.exact}`);
  }
  if (current.unknown > baseline.results.unknownCount) {
    problems.push(`unknown 回退：${baseline.results.unknownCount} → ${current.unknown}`);
  }
  if (current.error > baseline.results.errorCount) {
    problems.push(`error 回退：${baseline.results.errorCount} → ${current.error}`);
  }

  const order = ["exact", "partial", "unknown", "error"];
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const b of baseline.cases) {
    const c = byId.get(b.id);
    // 回退 = 当前比基线更差（order 下标更大）；partial→unknown 才是回退
    if (c && order.indexOf(c.comparison) > order.indexOf(b.comparison)) {
      problems.push(`case 回退 ${b.id} (${b.name}): ${b.comparison} → ${c.comparison}`);
    }
  }
}

if (current.avgMs > baseline.averageTimeMs * 1.5) {
  problems.push(
    `性能回退：avg ${baseline.averageTimeMs}ms → ${current.avgMs}ms (>1.5x)`,
  );
}

if (problems.length > 0) {
  console.error("Benchmark gate FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("若为有意变更：pnpm run benchmark:baseline 更新基线后一并提交。");
  process.exit(1);
}

console.log(
  `Benchmark gate passed: ${current.exact}/${current.totalCases} exact, ` +
    `unknown ${current.unknown}, error ${current.error}, ` +
    `avg ${current.avgMs}ms (baseline ${baseline.averageTimeMs}ms).`,
);
