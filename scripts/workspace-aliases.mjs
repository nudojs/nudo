/**
 * Single source of truth for `@nudojs/*` workspace path aliases.
 *
 * Consumers:
 *   - vitest.config.ts          → resolve.alias (via `vitestAlias()`)
 *   - tsconfig.paths.json       → TypeScript `paths` (via `tsPaths()`, kept in
 *                                  sync by scripts/check-aliases.mjs --write)
 *   - scripts/check-aliases.mjs → drift gate (`node scripts/check-aliases.mjs`)
 *
 * Edit the maps here only; never restate them in vitest/tsconfig.
 */

/** Package name → source dir (relative to repo root). */
export const packageRoots = {
  "@nudojs/core": "packages/core/src",
  "@nudojs/parser": "packages/parser/src",
  "nudojs": "packages/nudojs/src",
  "@nudojs/service": "packages/service/src",
  "@nudojs/lsp": "packages/lsp/src",
  "@nudojs/harvester": "packages/harvester/src",
  "@nudojs/env": "packages/env/src",
};

/**
 * Exact subpath / file aliases. These win over the package-root prefix match
 * (Vite alias is prefix-based, TS `paths` prefers the longest pattern).
 */
export const subpathAliases = {
  "@nudojs/core/internal": "packages/core/src/internal.ts",
  "@nudojs/core/exec": "packages/core/src/algebra/exec/index.ts",
  "@nudojs/service/evaluator": "packages/service/src/evaluator/evaluator-api.ts",
  "@nudojs/env/es": "packages/env/src/es.ts",
  "@nudojs/env/web": "packages/env/src/web.ts",
  "@nudojs/env/node": "packages/env/src/node.ts",
};

/**
 * TypeScript `compilerOptions.paths` (relative targets, baseUrl = repo root).
 * Package roots also get a `/*` wildcard so deep imports keep working.
 */
export function tsPaths() {
  /** @type {Record<string, string[]>} */
  const paths = {};
  for (const [name, rel] of Object.entries(packageRoots)) {
    paths[name] = [rel];
    paths[`${name}/*`] = [`${rel}/*`];
  }
  for (const [name, rel] of Object.entries(subpathAliases)) {
    paths[name] = [rel];
  }
  return paths;
}

/**
 * Vite/Vitest `resolve.alias` as a plain object of absolute paths.
 * Longest specifier first: Vite's alias matching is prefix-based
 * (`importee === find || importee.startsWith(find + "/")`) and first match
 * wins, so `@nudojs/core/exec` must be listed before `@nudojs/core`.
 */
export function vitestAlias(repoRoot) {
  const all = { ...packageRoots, ...subpathAliases };
  const entries = Object.entries(all).sort((a, b) => b[0].length - a[0].length);
  /** @type {Record<string, string>} */
  const alias = {};
  for (const [name, rel] of entries) {
    alias[name] = `${repoRoot.replace(/\/$/, "")}/${rel}`;
  }
  return alias;
}
