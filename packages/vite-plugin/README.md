# vite-plugin-nudo

Vite plugin for build-time JavaScript type inference with [Nudo](https://github.com/nudojs/nudo).

## What is Nudo?

Nudo is a type inference engine for JavaScript. The type system is Abs (`shape × term × pred × conf`); analysis runs Abs-native via abstract interpretation — no TypeScript, no build step.

## This package

`vite-plugin-nudo` runs Nudo analysis during your Vite build, reporting type diagnostics as build warnings or errors.

## Install

```bash
npm install -D vite-plugin-nudo
```

## Usage

```js
// vite.config.js
import nudo from 'vite-plugin-nudo'

export default {
  plugins: [
    nudo({
      // include / exclude accept `string | string[]` (normalized to string[] at runtime)
      // each pattern is matched against the absolute module path AND the path
      // relative to the Vite project root (`config.root`)
      include: ['**/*.js', '**/*.mjs', '**/*.ts'], // default — matches isNudoTargetPath (.js/.mjs/.ts)
      exclude: ['**/node_modules/**', '**/*.d.ts'], // default
      failOnError: false, // default — contract errors warn, do not fail the build
    }),
  ],
}
```

## Analysis gating

File selection is two-stage:

1. **Path globs** (`include` / `exclude`) — defaults cover `**/*.js`, `**/*.mjs`, `**/*.ts` (the same extensions `isNudoTargetPath` accepts; `.cjs` / `.cts` / `.mts` / `.tsx` / `.d.ts` / `*.nudo.js` are not analysis targets). Each pattern is evaluated against **two** criteria — the absolute module path and the path relative to the Vite project root (`config.root`) — so a project-relative glob such as `src/**` behaves the same here as in `package.json#nudo.analysis.include` / `exclude`. Dependencies (anything under `node_modules`, symlinked workspace packages, and paths outside `config.root`) are always skipped.
2. **`nudo.analysis.mode`** via `shouldAnalyzeFile` — same gate as the LSP/CLI. Shipped default is `"exports"` (files with `@nudo:`, `export`, or a sidecar are analyzed). Set `"all"` or `"directives"` in `package.json#nudo.analysis` to widen or tighten the gate.

The plugin runs **before** Vite's `esbuild` transform, so it sees the original source of a `.ts` file (type annotations included). `@nudo:` directives that live in comments stay visible to the analysis, a `.ts` file is judged exactly like the same file written in `.js`, and diagnostic line numbers refer to your source file rather than to the transpiled output. Source the analyzer cannot parse (for example decorators) is reported as a single `Failed to analyze` warning; the build is not interrupted.

## Diagnostics & failOnError

- **Diagnostics tier** follows `package.json#nudo.analysis.diagnostics` when set. With a project `nudo` config present but no explicit tier, the plugin uses the same `analysisConfig` default as the LSP (`mode=directives` → `errors`; `exports`/`all` → `default`). Without a project config the plugin keeps its historical `default` tier (errors + warnings) so ad-hoc files still surface warnings in build logs.
- **`failOnError`** defaults to **false** (intentional, E3): build-time diagnostics warn rather than fail, so broad analysis modes do not break CI on false positives. Use `nudo check` as the contract CI gate, or pass `failOnError: true` to block the build on error-severity contract diagnostics. Every error-level diagnostic is reported: the first one fails the build, the remaining ones are logged as warnings, so the reported count always matches the summary count.
- `nudo.analysis.diagnostics: "off"` silences the **display path** (evaluator diagnostics, path-env failures, and check warnings/info). It does **not** silence the **contract gate**: error-level gate diagnostics (L1 `nudo:constraint-violated`, L2 `nudo:entry-may-throw`) are still reported and still fail the build under `failOnError: true`.
- The build summary (`[nudo] Analysis complete: X error(s), Y warning(s)`) goes through Vite's logger, so `build.logLevel: "silent"` prints nothing at all — not even the summary line.

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
