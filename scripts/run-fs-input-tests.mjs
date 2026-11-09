/**
 * Run the fs-input suite from scripts/fs-input-tests.mjs.
 *
 * Unlike the normal test run this deliberately does not use `--changed`:
 * these tests read files that the module graph cannot see, so they must run
 * on every incremental CI path. Keep the list small — it is a targeted suite,
 * not a second full run.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FS_INPUT_TARGETS } from "./fs-input-tests.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vitest = join(repoRoot, "node_modules/vitest/vitest.mjs");
const result = spawnSync(
  process.execPath,
  [vitest, "run", ...FS_INPUT_TARGETS, ...process.argv.slice(2)],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=8192"]
        .filter(Boolean)
        .join(" "),
    },
  },
);
process.exit(result.status ?? 1);
