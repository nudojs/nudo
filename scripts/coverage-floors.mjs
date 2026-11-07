/**
 * Print per-package coverage and suggested per-package floors.
 *
 *   pnpm run test:coverage      # writes coverage/coverage-summary.json
 *   pnpm run coverage:floors    # this script
 *
 * Suggested floor = current pct rounded down to a multiple of 5, minus 5
 * points of headroom. Floors in vitest.config.ts are a "no silent crater"
 * net, not a quality proof (docs/design/limitations.md §1.5) — raise them
 * with a full nightly baseline attached to the PR, never lower them without
 * an explicit reason in the PR description.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const summaryPath = join(repoRoot, "coverage/coverage-summary.json");

if (!existsSync(summaryPath)) {
  console.error(
    "missing coverage/coverage-summary.json — run `pnpm run test:coverage` first (full run, not --changed)",
  );
  process.exit(1);
}

const data = JSON.parse(readFileSync(summaryPath, "utf8"));
const KEYS = ["lines", "functions", "branches", "statements"];
/** @type {Map<string, Record<string, [number, number]>>} */
const buckets = new Map();

for (const [file, metrics] of Object.entries(data)) {
  if (file === "total") continue;
  const rel = file.replace(`${repoRoot}/`, "").replace(/\\/g, "/");
  const match = /^packages\/([^/]+)\//.exec(rel);
  if (!match) continue;
  const pkg = match[1];
  const bucket = buckets.get(pkg) ?? Object.fromEntries(KEYS.map((k) => [k, [0, 0]]));
  for (const key of KEYS) {
    bucket[key][0] += metrics[key]?.total ?? 0;
    bucket[key][1] += metrics[key]?.covered ?? 0;
  }
  buckets.set(pkg, bucket);
}

if (buckets.size === 0) {
  console.error("no packages/* files found in coverage summary — is this a --changed subset?");
  process.exit(1);
}

const pct = (pair) => (pair[0] === 0 ? 100 : (100 * pair[1]) / pair[0]);
const floor = (pair) => Math.max(0, Math.floor((pct(pair) - 5) / 5) * 5);

console.log("package        lines          functions      branches       statements");
for (const [pkg, bucket] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
  const cells = KEYS.map((k) => `${pct(bucket[k]).toFixed(1)}% → ${floor(bucket[k])}`.padEnd(15));
  console.log(`${pkg.padEnd(14)} ${cells.join(" ")}`);
}
console.log(
  "\n只升不降：把建议值填入 vitest.config.ts 的 per-package thresholds，并在 PR 里附本次全量覆盖率报告。",
);
