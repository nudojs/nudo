/**
 * OSS baseline regression gate — fail only on regressions.
 *
 * Compares docs/reports/oss-perf-baseline.json against benchmark/oss/baseline.json.
 * Never fails for "faster than baseline". New L1 false positives always fail.
 * Time checks get TIME_SLACK on CI (runner ~2.5–3x slower than trusted local).
 *
 * Usage: node benchmark/oss/gate.mjs [--allow-uniform-shift]
 * Exit 0 = within envelope · exit 1 = regression.
 * --allow-uniform-shift：仅当全部计时指标均匀同向漂移（疑似机器/环境因子，
 * 见 src/noise.js）且失败项全为计时阈值时放行；FP/正确性门永不因此放行。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectUniformShift, formatUniformShiftHint } from "../src/noise.js";

// 测试锚点覆写（惯例同 scripts/gate-major.mjs 的 GATE_MAJOR_ROOT）：
// 指向伪仓根时 REPORT/BASELINE 都从该根解析。
const ROOT = resolve(process.env.OSS_GATE_ROOT ?? join(import.meta.dirname, "..", ".."));
const REPORT = join(ROOT, "docs", "reports", "oss-perf-baseline.json");
const BASELINE = join(ROOT, "benchmark", "oss", "baseline.json");

const args = process.argv.slice(2);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (!existsSync(REPORT)) {
  console.error("Gate: missing docs/reports/oss-perf-baseline.json — run `pnpm run benchmark:oss` first.");
  process.exit(1);
}
if (!existsSync(BASELINE)) {
  console.error("Gate: missing benchmark/oss/baseline.json — run `pnpm run benchmark:oss` once to seed, then commit the baseline.");
  process.exit(1);
}

const report = readJson(REPORT);
const baseline = readJson(BASELINE);
const failures = [];

// CI runner 相对 trusted 本地常慢 2.5–3x（与 benchmark/src/gate.js 同策略）。
// 时间阈值在 CI 上放宽；L1 FP 仍然是硬门禁。
const TIME_SLACK = process.env.GITHUB_ACTIONS ? 3.0 : 1.0;

// 机器因子探测输入：全部与基线可比的计时指标（totals + 各包 cold/check/hub）。
// baseline 未设阈值（null）或 report 缺值的条目由 noise.js 自行过滤。
const timeMetrics = [];
let timingFailures = 0;

/** 计时阈值检查：超限记 failure，并收集 ratio 供机器因子探测。 */
function checkTime(name, baselineMs, currentMs, prefix = "") {
  timeMetrics.push({ name, baseline: baselineMs, current: currentMs });
  if (baselineMs != null && currentMs != null && currentMs > baselineMs * TIME_SLACK) {
    failures.push(`${prefix}${name} ${currentMs}ms > ${baselineMs * TIME_SLACK}ms`);
    timingFailures++;
  }
}

// --- totals ---
const maxFp = baseline.totals?.maxFpCount ?? 0;
if ((report.totals?.fpCount ?? 0) > maxFp) {
  failures.push(`FP total ${report.totals.fpCount} > baseline max ${maxFp}`);
}
checkTime("cold analyze", baseline.totals?.maxColdAnalyzeMs, report.totals?.coldAnalyzeMs);
checkTime("check all", baseline.totals?.maxCheckAllMs, report.totals?.checkAllMs);

// --- per package ---
const byName = new Map((report.packages ?? []).map((p) => [p.name, p]));
for (const b of baseline.packages ?? []) {
  const r = byName.get(b.name);
  if (!r) {
    failures.push(`package ${b.name} missing from report`);
    continue;
  }
  if (r.files < (b.minFiles ?? 1)) {
    failures.push(`${b.name}: files ${r.files} < min ${b.minFiles}`);
  }
  if (r.fpCount > (b.maxFpCount ?? 0)) {
    failures.push(`${b.name}: L1 FP ${r.fpCount} > ${b.maxFpCount}`);
  }
  checkTime("cold analyze", b.maxColdAnalyzeMs, r.coldAnalyzeMs, `${b.name}: `);
  checkTime("check all", b.maxCheckAllMs, r.checkAllMs, `${b.name}: `);
  checkTime("hub-edit", b.maxHubDirtyMedianMs, r.hub?.dirtyMedianMs, `${b.name}: `);
  if (Array.isArray(r.falsePositives) && r.falsePositives.length > 0) {
    failures.push(`${b.name}: FP detail:\n  ${r.falsePositives.slice(0, 5).join("\n  ")}`);
  }
}

if (failures.length > 0) {
  console.error("OSS baseline gate FAILED (regression):");
  for (const f of failures) console.error("  - " + f);
  // 机器因子探测（共享 noise.js）：全计时指标均匀同向漂移 → 醒目提示；
  // 默认仍红，仅 --allow-uniform-shift 且失败全部为计时项时放行
  // （FP/正确性门不受旗标影响；CI 不带旗标，硬门不变）。
  const shift = detectUniformShift(timeMetrics);
  if (shift.uniform && timingFailures > 0) {
    console.error(formatUniformShiftHint(shift.medianRatio));
    if (args.includes("--allow-uniform-shift") && failures.length === timingFailures) {
      console.error("--allow-uniform-shift：全部失败项均为计时指标且均匀漂移，放行。");
      process.exit(0);
    }
  }
  process.exit(1);
}

console.log(
  `OSS baseline gate OK — ${report.totals.files} files, FP=${report.totals.fpCount}, cold=${report.totals.coldAnalyzeMs}ms, check=${report.totals.checkAllMs}ms`,
);
