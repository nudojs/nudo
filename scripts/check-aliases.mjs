/**
 * Drift gate for workspace aliases.
 *
 * Source of truth: scripts/workspace-aliases.mjs
 * Projected into:  tsconfig.paths.json  (TypeScript `paths`)
 * Consumed live by: vitest.config.ts    (import, cannot drift)
 *
 * Usage:
 *   node scripts/check-aliases.mjs          # exit 1 if tsconfig.paths.json drifts
 *   node scripts/check-aliases.mjs --write  # regenerate tsconfig.paths.json from SoT
 *
 * Root package.json script (for parent/CI to add if missing):
 *   "check:aliases": "node scripts/check-aliases.mjs"
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tsPaths, packageRoots, subpathAliases } from "./workspace-aliases.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pathsJsonPath = join(repoRoot, "tsconfig.paths.json");
const lintJsonPath = join(repoRoot, "tsconfig.lint.json");

const writeMode = process.argv.includes("--write");

function stablePaths() {
  // Deterministic key order for diffing / writing.
  const paths = tsPaths();
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const key of Object.keys(paths).sort()) out[key] = paths[key];
  return out;
}

function renderPathsJson(paths) {
  return (
    JSON.stringify(
      {
        "//": "GENERATED from scripts/workspace-aliases.mjs — do not edit by hand. Run: node scripts/check-aliases.mjs --write",
        compilerOptions: {
          paths,
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function samePaths(a, b) {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    const av = a[ak[i]];
    const bv = b[bk[i]];
    if (av.length !== bv.length) return false;
    for (let j = 0; j < av.length; j++) if (av[j] !== bv[j]) return false;
  }
  return true;
}

const expected = stablePaths();
const expectedJson = renderPathsJson(expected);

if (writeMode) {
  writeFileSync(pathsJsonPath, expectedJson, "utf8");
  console.log(`wrote ${pathsJsonPath} (${Object.keys(expected).length} path entries)`);
  process.exit(0);
}

let failed = false;

// 1. tsconfig.paths.json must match the SoT exactly.
if (!existsSync(pathsJsonPath)) {
  console.error(`missing ${pathsJsonPath} — run: node scripts/check-aliases.mjs --write`);
  failed = true;
} else {
  const raw = readFileSync(pathsJsonPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`tsconfig.paths.json is not valid JSON: ${e.message}`);
    failed = true;
  }
  if (parsed) {
    const actual = parsed.compilerOptions?.paths ?? {};
    if (!samePaths(actual, expected)) {
      console.error("tsconfig.paths.json drifts from scripts/workspace-aliases.mjs");
      console.error("  expected keys:", Object.keys(expected).sort().join(", "));
      console.error("  actual keys:  ", Object.keys(actual).sort().join(", "));
      for (const [k, v] of Object.entries(expected)) {
        const av = actual[k];
        if (JSON.stringify(av) !== JSON.stringify(v)) {
          console.error(`  ${k}: expected ${JSON.stringify(v)} got ${JSON.stringify(av)}`);
        }
      }
      for (const k of Object.keys(actual)) {
        if (!(k in expected)) console.error(`  extra key ${k}: ${JSON.stringify(actual[k])}`);
      }
      console.error("fix: node scripts/check-aliases.mjs --write");
      failed = true;
    }
  }
}

// 2. tsconfig.lint.json must extend the shared paths file (not restate paths).
if (!existsSync(lintJsonPath)) {
  console.error(`missing ${lintJsonPath}`);
  failed = true;
} else {
  const lint = JSON.parse(readFileSync(lintJsonPath, "utf8"));
  const extendsList = Array.isArray(lint.extends) ? lint.extends : [lint.extends];
  if (!extendsList.includes("./tsconfig.paths.json")) {
    console.error(
      'tsconfig.lint.json must extend "./tsconfig.paths.json" (got extends:',
      JSON.stringify(lint.extends),
      ")",
    );
    failed = true;
  }
  if (lint.compilerOptions?.paths) {
    console.error(
      "tsconfig.lint.json must not restate compilerOptions.paths — use tsconfig.paths.json",
    );
    failed = true;
  }
}

// 3. Sanity: SoT must cover every package root + subpath alias.
if (Object.keys(expected).length !== Object.keys(packageRoots).length * 2 + Object.keys(subpathAliases).length) {
  console.error("internal: tsPaths() key count mismatch vs packageRoots/subpathAliases");
  failed = true;
}

if (failed) process.exit(1);
console.log(
  `ok: workspace aliases in sync (${Object.keys(expected).length} ts paths from ${Object.keys(packageRoots).length} packages + ${Object.keys(subpathAliases).length} subpaths)`,
);
