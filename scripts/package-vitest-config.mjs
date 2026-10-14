/**
 * Shared vitest config for package-local runs (`cd packages/<pkg> && vitest …`).
 *
 * Why: vitest only auto-discovers a config in the CWD. Without a per-package
 * config, `@nudojs/*` specifiers resolve through package.json exports (or the
 * Node self-reference) to dist/ — a possibly stale build — so package-local
 * runs split from the root run's src view (wave-3 hit this: a test was
 * mis-fixed against stale dist). This factory reuses the workspace alias
 * table so package-local runs resolve the exact same src/ targets as the
 * root vitest.config.ts.
 *
 * Alias table (single source of truth): scripts/workspace-aliases.mjs
 * — never restate the maps here or in package configs.
 */
import { vitestAlias } from "./workspace-aliases.mjs";

/**
 * @param {string} importMetaUrl `import.meta.url` of the calling
 *   `packages/<pkg>/vitest.config.ts` (repo root is `../../` from there).
 */
export function packageVitestConfig(importMetaUrl) {
  const repoRoot = new URL("../../", importMetaUrl).pathname;
  return {
    test: {
      include: ["src/**/*.test.ts"],
      // Mirrors root vitest.config.ts: the default isolate pool dies on the
      // big Abs graphs (lodash harvest, relationFn).
      pool: "forks",
    },
    resolve: {
      alias: vitestAlias(repoRoot),
    },
  };
}
