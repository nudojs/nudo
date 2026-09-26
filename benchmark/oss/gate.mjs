/**
 * OSS baseline regression gate — fail only on regressions.
 *
 * Compares docs/reports/oss-perf-baseline.json against benchmark/oss/baseline.json.
 * Never fails for "faster than baseline". New L1 false positives always fail.
 *
 * Usage: node benchmark/oss/gate.mjs
 * Exit 0 = within envelope · exit 1 = regression.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const REPORT = join(ROOT, "docs", "reports", "oss-perf-baseline.json");
const BASELINE = join(import.meta.dirname, "baseline.json");

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

// --- totals ---
const maxFp = baseline.totals?.maxFpCount ?? 0;
if ((report.totals?.fpCount ?? 0) > maxFp) {
  failures.push(`FP total ${report.totals.fpCount} > baseline max ${maxFp}`);
}
if (baseline.totals?.maxColdAnalyzeMs != null && report.totals?.coldAnalyzeMs > baseline.totals.maxColdAnalyzeMs) {
  failures.push(`cold analyze ${report.totals.coldAnalyzeMs}ms > ${baseline.totals.maxColdAnalyzeMs}ms`);
}
if (baseline.totals?.maxCheckAllMs != null && report.totals?.checkAllMs > baseline.totals.maxCheckAllMs) {
  failures.push(`check all ${report.totals.checkAllMs}ms > ${baseline.totals.maxCheckAllMs}ms`);
}

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
  if (b.maxColdAnalyzeMs != null && r.coldAnalyzeMs > b.maxColdAnalyzeMs) {
    failures.push(`${b.name}: cold analyze ${r.coldAnalyzeMs}ms > ${b.maxColdAnalyzeMs}ms`);
  }
  if (b.maxCheckAllMs != null && r.checkAllMs > b.maxCheckAllMs) {
    failures.push(`${b.name}: check all ${r.checkAllMs}ms > ${b.maxCheckAllMs}ms`);
  }
  if (b.maxHubDirtyMedianMs != null && r.hub?.dirtyMedianMs > b.maxHubDirtyMedianMs) {
    failures.push(`${b.name}: hub-edit ${r.hub.dirtyMedianMs}ms > ${b.maxHubDirtyMedianMs}ms`);
  }
  if (Array.isArray(r.falsePositives) && r.falsePositives.length > 0) {
    failures.push(`${b.name}: FP detail:\n  ${r.falsePositives.slice(0, 5).join("\n  ")}`);
  }
}

if (failures.length > 0) {
  console.error("OSS baseline gate FAILED (regression):");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(
  `OSS baseline gate OK — ${report.totals.files} files, FP=${report.totals.fpCount}, cold=${report.totals.coldAnalyzeMs}ms, check=${report.totals.checkAllMs}ms`,
);
