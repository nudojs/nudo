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
| `include`     | `string[]` | `["**/*.js", "**/*.mjs", "**/*.ts"]` | Glob patterns for files to analyze (aligned with `isNudoTargetPath`) |
| `exclude`     | `string[]` | `["**/node_modules/**", "**/*.d.ts"]` | Glob patterns for files to skip                                             |
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

## Behavior

- **File matching**: The plugin processes files that match `include` and do not match `exclude`; `exclude` always wins. The default `include` of `["**/*.js", "**/*.mjs", "**/*.ts"]` matches `isNudoTargetPath` (`.cjs`/`.cts`/`.mts`/`.tsx` are not analysis targets).
- **Analysis gate**: After globs, files pass `shouldAnalyzeFile` (`package.json#nudo.analysis.mode`). Shipped default is `"exports"` — files with `@nudo:*`, `export`, or a sidecar are analyzed. Set `"all"` for every target path, or `"directives"` for the conservative gate.
- **Analysis**: Matching files use `analyzeFileAsync` from `@nudojs/service` to run type inference.
- **Refinement gate**: Matching files also pass through the Abs refinement gate (`checkSource` from `@nudojs/core`): `nudo:constraint-violated`, `nudo:assign-mismatch`, and `nudo:arg-structure` issues are merged into the same diagnostics pipeline and reported alongside evaluator diagnostics.
- **Caching**: Analysis results are cached per file. The cache is cleared at `buildStart` and on every `watchChange` (dev-server file change).
- **Diagnostics**: Analysis diagnostics are filtered through the project `package.json#nudo.analysis.diagnostics` tier (default tier: error + warning minus noisy codes) before emission; what survives is emitted as Vite warnings (or errors when `failOnError` is `true`). Setting `"diagnostics": "errors"` therefore silences warnings at build time, and `"off"` silences the plugin's diagnostic output entirely. At build end, a summary is logged: `[nudo] Analysis complete: X error(s), Y warning(s)`.

## `failOnError`

- **`failOnError: false`** (default): Type errors from Nudo are reported as Vite warnings. The build continues.
- **`failOnError: true`**: Nudo type errors are reported as build errors, causing the build to fail.

Use `failOnError: true` when you want Nudo to enforce type correctness as part of your CI or production build.

## Next

- [Installation](../getting-started/installation.md) — add the plugin to a project
- [nudo check](./check.md) — the same Abs gate in CI
- [Coexistence with TypeScript](./coexistence.md) — mixed monorepo recipes
- [Versioning & Releases](./versioning.md) — what counts as breaking
