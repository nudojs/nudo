import { defineConfig } from "tsup";

/**
 * ESM output bundles CJS deps (e.g. commander), whose transpiled
 * `require("events")` calls hit esbuild's `__require` fallback and throw
 * "Dynamic require of X is not supported" under plain `node`. Injecting a
 * real `require` via `createRequire` makes `__require` delegate to Node's
 * CJS loader for builtins. Banner is prepended to every JS chunk, before
 * esbuild's prelude, so module-scope shims resolve before first use.
 * Shebang is preserved from src/index.ts (first line) for the `nudo` bin.
 *
 * The published bin must run from node_modules as-is and stay a single
 * self-contained file (shared chunks would break copying the bin out alone):
 * the @nudojs/* packages publish dist output, but inlining them keeps the
 * bin free of sibling-chunk and workspace-link assumptions. tsconfig.build.json
 * maps every @nudojs/* specifier to sibling SRC — resolving to their dist
 * instead would inline this package's own previous build output. The @nudojs/*
 * sources are pure ESM, so inlining them adds no CJS-interop surface; @babel/* and typescript
 * (transitive via core/service/harvester) are CJS and rely on the
 * createRequire banner below. commander stays external (plain-JS dep).
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  tsconfig: "tsconfig.build.json",
  // Single-file bin: shared chunks would make dist/index.js depend on
  // sibling chunk files (the bin must run when copied out alone).
  splitting: false,
  noExternal: [/^@nudojs\//],
  // dts uses the same src paths (types always match the bundled sources —
  // sibling dist d.ts can be stale). The emitted d.ts still keeps
  // @nudojs/* imports external: rollup marks declared deps external.
  dts: true,
  banner: {
    js: [
      'import { createRequire as __nudoCreateRequire } from "module";',
      'import { fileURLToPath as __nudoFileURLToPath } from "url";',
      "const require = __nudoCreateRequire(import.meta.url);",
      "const __filename = __nudoFileURLToPath(import.meta.url);",
      'const __dirname = __nudoFileURLToPath(new URL(".", import.meta.url));',
    ].join("\n"),
  },
});
