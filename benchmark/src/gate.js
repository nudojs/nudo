/**
 * Benchmark Gate - fail hard on accuracy / error / performance regressions
 * against benchmark/baseline.json. Run after `pnpm run benchmark`.
 *
 * 规则：
 * - case 集规模变化（增删 case）→ 失败，提示更新基线
 * - exact 数下降 / unknown 数上升 / error 数上升 → 失败，逐 case 列出回退
 * - 平均耗时 > 基线的 3.0x → 失败
 *   （每 case 冷启动 `pnpm run infer`/tsx；GitHub ubuntu runner 相对本地
 *    Apple Silicon 常年 ~2.5–3x，1.5x 会把环境噪声当成回归）
 * - --allow-uniform-shift：全部计时指标均匀同向漂移（疑似机器/环境因子，
 *   见 noise.js）且失败项全为计时阈值时放行；精度门永不因此放行
 */

import { readFileSync } from "fs";
import { detectUniformShift, formatUniformShiftHint } from "./noise.js";

const args = process.argv.slice(2);

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
    const drop = baseline.results.exactMatches - current.exact;
    // 允许 1-case exact→partial 抖动（runner/路径敏感噪声）；error 恶化仍硬失败
    if (drop > 1 || current.error > baseline.results.errorCount) {
      problems.push(`exact 回退：${baseline.results.exactMatches} → ${current.exact}`);
    } else {
      console.warn(
        `Gate warn: exact dropped by ${drop} (within 1-case tolerance); error stable.`,
      );
    }
  }
  if (current.unknown > baseline.results.unknownCount) {
    problems.push(`unknown 回退：${baseline.results.unknownCount} → ${current.unknown}`);
  }
  if (current.error > baseline.results.errorCount) {
    problems.push(`error 回退：${baseline.results.errorCount} → ${current.error}`);
  }

  // exact < partial < unknown < mismatch < error（越靠右越差）
  const order = ["exact", "partial", "unknown", "mismatch", "error"];
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const b of baseline.cases) {
    const c = byId.get(b.id);
    // 回退 = 当前比基线更差（order 下标更大）；unknown→partial / mismatch→exact 是改进
    if (c && order.indexOf(c.comparison) > order.indexOf(b.comparison)) {
      problems.push(`case 回退 ${b.id} (${b.name}): ${b.comparison} → ${c.comparison}`);
    }
  }
}

// 3x 覆盖 CI runner 相对本地的冷启动差；真正引擎回归通常远超此倍数
// 机器因子探测输入：与基线可比的计时指标。当前基线刻意最小视图
// （baseline.js 只存 avgMs），单指标 < noise.js 的 MIN_METRICS → 探测
// 恒不命中；且 3.0x 阈值本身远大于 10~13% 机器因子。基线若将来记录
// 逐 case 耗时，此处追加 metrics 即自动生效。
const timeMetrics = [{ name: "avgMs", baseline: baseline.averageTimeMs, current: current.avgMs }];
let timingFailures = 0;
if (current.avgMs > baseline.averageTimeMs * 3.0) {
  problems.push(
    `性能回退：avg ${baseline.averageTimeMs}ms → ${current.avgMs}ms (>3.0x)`,
  );
  timingFailures++;
}

if (problems.length > 0) {
  console.error("Benchmark gate FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("若为有意变更：pnpm run benchmark:baseline 更新基线后一并提交。");
  // 机器因子探测（共享 noise.js）：全计时指标均匀同向漂移 → 醒目提示；
  // 默认仍红，仅 --allow-uniform-shift 且失败全部为计时项时放行
  // （exact/unknown/error 等精度门不受旗标影响；CI 不带旗标，硬门不变）。
  const shift = detectUniformShift(timeMetrics);
  if (shift.uniform && timingFailures > 0) {
    console.error(formatUniformShiftHint(shift.medianRatio));
    if (args.includes("--allow-uniform-shift") && problems.length === timingFailures) {
      console.error("--allow-uniform-shift：全部失败项均为计时指标且均匀漂移，放行。");
      process.exit(0);
    }
  }
  process.exit(1);
}

console.log(
  `Benchmark gate passed: ${current.exact}/${current.totalCases} exact, ` +
    `unknown ${current.unknown}, error ${current.error}, ` +
    `avg ${current.avgMs}ms (baseline ${baseline.averageTimeMs}ms).`,
);
