# vite-plugin-nudo

## 0.4.1

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1
  - @nudojs/service@3.0.0

## 0.4.0

### Minor Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design-analysis-scope.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

### Patch Changes

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0
  - @nudojs/service@2.0.0

## 0.3.4

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1
  - @nudojs/service@1.0.1

## 0.3.3

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0
  - @nudojs/service@1.0.0

## 0.3.2

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0
  - @nudojs/service@0.3.2

## 0.3.1

### Patch Changes

- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1
  - @nudojs/service@0.3.1

## 0.3.0

### Minor Changes

- 5786fa5: Ship TypeScript-aware defaults and Abs check diagnostics in the Vite plugin.

  - Default include covers `.js` / `.mjs` / `.ts` / `.mts`; exclude also skips `*.d.ts`.
  - Glob matching is a real anchored RegExp (not `endsWith` heuristics).
  - Runs `analyzeFileAsync` plus `checkSource` so Abs constraint issues surface as Vite warnings/errors.
  - Exposes `clearAnalysisSessionCaches` for long-lived Vite processes.

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
  - @nudojs/service@0.3.0

## 0.2.1

### Patch Changes

- @nudojs/service@0.2.1

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

### Patch Changes

- Updated dependencies [6c38283]
- Updated dependencies [9f7f819]
- Updated dependencies [c175f71]
  - @nudojs/service@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/service@0.1.0
