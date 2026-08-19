import { defineConfig } from "tsup";

/**
 * ESM output bundles CJS deps (e.g. commander), whose transpiled
 * `require("events")` calls hit esbuild's `__require` fallback and throw
 * "Dynamic require of X is not supported" under plain `node`. Injecting a
 * real `require` via `createRequire` makes `__require` delegate to Node's
 * CJS loader for builtins. Banner is prepended to every JS chunk, before
 * esbuild's prelude, so module-scope shims resolve before first use.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/evaluator-api.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  banner: {
    js: 'import { createRequire } from "module";\nconst require = createRequire(import.meta.url);',
  },
});
