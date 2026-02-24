---
sidebar_position: 3
---

# Vite Plugin

**vite-plugin-nudo** integrates Nudo's type inference into your Vite build. It analyzes files with `@nudo:*` directives and reports diagnostics during development and production builds.

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
| `include`     | `string[]` | `["**/*.js"]`           | Glob patterns for files to analyze                                          |
| `exclude`     | `string[]` | `["**/node_modules/**"]`| Glob patterns for files to skip                                             |
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

## Behavior

- **File matching**: The plugin processes files that match `include` and do not match `exclude`. The default `**/*.js` includes all JavaScript files.
- **Directive check**: Files without Nudo directives (`@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, `@nudo:returns`) are skipped. No analysis is run for them.
- **Analysis**: For matching files with directives, the plugin uses `analyzeFile` from `@nudojs/service` to run type inference.
- **Caching**: Analysis results are cached per file. The cache is cleared at `buildStart`.
- **Diagnostics**: Errors and warnings from analysis are emitted as Vite warnings (or errors when `failOnError` is `true`). At build end, a summary is logged: `[nudo] Analysis complete: X error(s), Y warning(s)`.

## `failOnError`

- **`failOnError: false`** (default): Type errors from Nudo are reported as Vite warnings. The build continues.
- **`failOnError: true`**: Nudo type errors are reported as build errors, causing the build to fail.

Use `failOnError: true` when you want Nudo to enforce type correctness as part of your CI or production build.
