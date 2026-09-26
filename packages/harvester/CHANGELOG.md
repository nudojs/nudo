# @nudojs/harvester

## 1.0.0-beta.1

### Major Changes

- 4305674: Split the `@nudojs/service` god package: harvest → `@nudojs/harvester`, IDE surface → `@nudojs/lsp`, emit products consolidated under `@nudojs/service/emit`.
  
  **BREAKING** for `@nudojs/service` subpath consumers:
  
  | Removed subpath | Migrate to |
  |---|---|
  | `@nudojs/service/interface` | `@nudojs/service/emit` |
  | `@nudojs/service/dts` | `@nudojs/service/emit` |
  | `@nudojs/service/case` | `@nudojs/service/emit` |
  | `@nudojs/service/lsp` | `@nudojs/lsp` (library entry — no server side effects) |
  | `@nudojs/service/harvest` | `@nudojs/harvester` |
  
  `@nudojs/service` keeps `.`, `./analysis`, `./evaluator`, `./emit`. The language server moves to `@nudojs/lsp/server` (bin `nudo-lsp` unchanged); `@nudojs/lsp` is now a side-effect-free library entry re-exporting the IDE surface.
  
  No dependency cycles: `lsp → service`, `harvester` stays independent of `service`. Emit is a service subpath (same package). Public function signatures and diagnostic codes are unchanged.

## 0.2.8-beta.0

### Patch Changes

- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
  - @nudojs/core@3.0.0-beta.0

## 0.2.7

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/core@2.1.0

## 0.2.6

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1

## 0.2.5

### Patch Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design/cli-semantics.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0

## 0.2.4

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1

## 0.2.3

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0

## 0.2.2

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0

## 0.2.1

### Patch Changes

- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1

## 0.2.0

### Minor Changes

- 5786fa5: Auto-inject `@types` during analysis-path harvest and guard oversized dts work.

  - Analysis can resolve package roots upward and feed harvested Abs into the B module graph.
  - `harvestDts` accepts optional `maxFileBytes` / `maxMs` and skips unreadable or oversized files instead of failing the run.

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
