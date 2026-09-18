# vite-plugin-nudo

Vite plugin for build-time JavaScript type inference with [Nudo](https://github.com/nudojs/nudo).

## What is Nudo?

Nudo is a type inference engine for JavaScript. Instead of a separate type system, it runs your code with symbolic type values via abstract interpretation — no TypeScript, no build step.

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
      include: ['**/*.js', '**/*.mjs', '**/*.ts'], // default — matches isNudoTargetPath (.js/.mjs/.ts)
      exclude: ['**/node_modules/**', '**/*.d.ts'], // default
      failOnError: false, // default — contract errors warn, do not fail the build
    }),
  ],
}
```

## Analysis gating

File selection is two-stage:

1. **Path globs** (`include` / `exclude`) — defaults cover `**/*.js`, `**/*.mjs`, `**/*.ts` (the same extensions `isNudoTargetPath` accepts; `.cjs` / `.cts` / `.mts` / `.tsx` / `.d.ts` / `*.nudo.js` are not analysis targets).
2. **`nudo.analysis.mode`** via `shouldAnalyzeFile` — same gate as the LSP/CLI. Shipped default is `"directives"` (only files with `@nudo:` directives are analyzed). Set `"exports"` or `"all"` in `package.json#nudo.analysis` to opt in to whole-file analysis.

## Diagnostics & failOnError

- **Diagnostics tier** follows `package.json#nudo.analysis.diagnostics` when set. With a project `nudo` config present but no explicit tier, the plugin uses the same `analysisConfig` default as the LSP (`mode=directives` → `errors`; `exports`/`all` → `default`). Without a project config the plugin keeps its historical `default` tier (errors + warnings) so ad-hoc files still surface warnings in build logs.
- **`failOnError`** defaults to **false** (intentional, E3): build-time diagnostics warn rather than fail, so broad analysis modes do not break CI on false positives. Use `nudo check` as the contract CI gate, or pass `failOnError: true` to block the build on error-severity contract diagnostics.
- Display filtering via `nudo.analysis.diagnostics: "off"` silences plugin diagnostics; it does **not** replace `nudo check`.

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
