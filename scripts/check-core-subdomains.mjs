/**
 * Boundary gate for packages/core/src/algebra.
 *
 * core holds ~54% of the repo's TypeScript; algebra/ top level currently
 * carries 93 flat .ts files while five subdomain directories already exist.
 * Relocating those files would break ~2300 `.ts`-extension relative imports,
 * so this gate does NOT move anything — it freezes the flat area and forces
 * new modules into an existing subdomain.
 *
 *   node scripts/check-core-subdomains.mjs
 *
 * Raising MAX_TOP_LEVEL_TS or adding a subdomain is an architecture decision:
 * update the constant/set here AND docs/design/kernel-merge.md in the same PR.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const algebra = join(repoRoot, "packages/core/src/algebra");

const SUBDOMAINS = new Set(["__tests__", "arithmetic", "builtins", "exec", "scan"]);

// Frozen 2026-11-05 baseline (93 top-level .ts). Intent: no NEW flat files,
// not "cap at 93 forever" — a deliberate consolidation may lower it.
const MAX_TOP_LEVEL_TS = 93;

const entries = readdirSync(algebra, { withFileTypes: true });
const topLevelTs = entries.filter((e) => e.isFile() && e.name.endsWith(".ts"));
const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

const problems = [];
if (topLevelTs.length > MAX_TOP_LEVEL_TS) {
  problems.push(
    `algebra/ top level has ${topLevelTs.length} .ts files (baseline ${MAX_TOP_LEVEL_TS}); ` +
      `put new modules under ${[...SUBDOMAINS].filter((d) => d !== "__tests__").join(" / ")}, not the flat root.`,
  );
}
for (const d of dirs) {
  if (!SUBDOMAINS.has(d)) {
    problems.push(
      `unknown subdomain directory algebra/${d} — add it to SUBDOMAINS with an architecture note`,
    );
  }
}

if (problems.length > 0) {
  console.error("Core subdomain gate FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `ok: algebra/ top level ${topLevelTs.length}/${MAX_TOP_LEVEL_TS} .ts; subdomains: ${dirs.join(", ")}`,
);
