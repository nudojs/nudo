---
description: "Analyze @nudo: type-inference directives during Vite builds with vite-plugin-nudo: configurable include/exclude globs, build warnings, and failOnError."
---

# Vite Plugin

**vite-plugin-nudo** integrates Nudo's type inference into your Vite build. File selection follows `nudo.analysis.mode` (same gate as LSP/CLI via `shouldAnalyzeFile`); the shipped default is `"exports"`. Mode semantics: [Coexistence](./coexistence.md#when-to-use-modedirectives-vs-modeexports).

## Installation

```bash
npm install vite-plugin-nudo --save-dev
```

```bash
pnpm add -D vite-plugin-nudo
```

## Configuration

Add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import nudo from "vite-plugin-nudo";

export default defineConfig({
  plugins: [
    nudo(),
    // ... other plugins
  ],
});
```

### Options

| Option        | Type       | Default                 | Description                                                                 |
|---------------|------------|-------------------------|-----------------------------------------------------------------------------|
| `include`     | `string[]` | `["**/*.js", "**/*.mjs", "**/*.ts"]` | Glob patterns for files to analyze (aligned with `isNudoTargetPath`). Matched against both the absolute module path and the path relative to the Vite project root (`config.root`) |
| `exclude`     | `string[]` | `["**/node_modules/**", "**/*.d.ts"]` | Glob patterns for files to skip (same two matching criteria as `include`). Dependencies are always skipped, even when a custom `exclude` is given |
| `failOnError` | `boolean`  | `false`                 | When `true`, Nudo type errors become build errors                           |

### Example with Options

```typescript
import { defineConfig } from "vite";
import nudo from "vite-plugin-nudo";

export default defineConfig({
  plugins: [
    nudo({
      include: ["**/*.js", "**/*.mjs"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      failOnError: true,
    }),
  ],
});
```

Glob patterns support any file extension (`**/*.js`, `**/*.mjs`, `**/*.ts`, …), directory-segment patterns (`**/node_modules/**`, `**/dist/**`), and wildcard-free patterns, which are matched as literal substrings of the file path.

Each pattern is evaluated against **two** criteria: the absolute module path and the path relative to the Vite project root (`config.root`). A pattern that matches either one counts as a hit, so a project-relative glob such as `src/**` behaves the same here as it does in `package.json#nudo.analysis.include` / `exclude`. Paths outside `config.root` (dependencies, files outside the project) are always skipped.

## Behavior

- **File matching**: The plugin processes files that match `include` and do not match `exclude`; `exclude` always wins. The default `include` of `["**/*.js", "**/*.mjs", "**/*.ts"]` matches `isNudoTargetPath` (`.cjs`/`.cts`/`.mts`/`.tsx` are not analysis targets). Matching happens on the module id with its query string stripped (`?t=` / `?v=`), so a file is selected the same way before and after an HMR update.
- **Analysis gate**: After globs, files pass `shouldAnalyzeFile` (`package.json#nudo.analysis.mode`). Shipped default is `"exports"` — files with `@nudo:*`, `export`, or a sidecar are analyzed. Set `"all"` for every target path, or `"directives"` for the conservative gate.
- **Analysis**: Matching files use `analyzeFileAsync` from `@nudojs/service` to run type inference.
- **Source order**: The plugin runs **before** Vite's `esbuild` transform, so it sees the original source of a `.ts` file — type annotations included. `@nudo:` directives that live in comments are therefore visible to the analysis, and a `.ts` file is judged exactly like the same file written in `.js`. Diagnostic line numbers refer to your source file, not to the transpiled output. Source that the analyzer cannot parse (for example decorators) is reported as a single `Failed to analyze` warning; the build is not interrupted.
- **Refinement gate**: Matching files also pass through the Abs refinement gate (`checkSource` from `@nudojs/core`): `nudo:constraint-violated`, `nudo:assign-mismatch`, and `nudo:arg-structure` issues are merged into the same diagnostics pipeline and reported alongside evaluator diagnostics.
- **Caching**: Analysis results are cached per file. The cache is cleared at `buildStart` and on every `watchChange` (dev-server file change).
- **Diagnostics**: Analysis diagnostics are filtered through the project `package.json#nudo.analysis.diagnostics` tier (default tier: error + warning minus noisy codes) before emission; what survives is emitted as Vite warnings (or errors when `failOnError` is `true`). Setting `"diagnostics": "errors"` therefore silences warnings at build time. The **`"off"` tier silences the display path only** — the contract gate keeps working: error-level gate diagnostics (L1 `nudo:constraint-violated`, L2 `nudo:entry-may-throw`) are still reported and still fail the build under `failOnError: true`. At build end, a summary is logged: `[nudo] Analysis complete: X error(s), Y warning(s)`. The summary goes through Vite's logger, so `build.logLevel: "silent"` prints nothing at all — not even the summary line.

## `failOnError`

- **`failOnError: false`** (default): Type errors from Nudo are reported as Vite warnings. The build continues.
- **`failOnError: true`**: Nudo type errors are reported as build errors, causing the build to fail. Every error-level diagnostic is reported: the first one fails the build, the remaining ones are logged as warnings, so the number of reported diagnostics always matches the summary count.

Use `failOnError: true` when you want Nudo to enforce type correctness as part of your CI or production build.

## Next

- [Installation](../getting-started/installation.md) — add the plugin to a project
- [nudo check](./check.md) — the same Abs gate in CI
- [Coexistence with TypeScript](./coexistence.md) — mixed monorepo recipes
- [Versioning & Releases](./versioning.md) — what counts as breaking
