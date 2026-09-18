---
"@nudojs/core": major
"@nudojs/service": major
"@nudojs/cli": major
"@nudojs/lsp": minor
"vite-plugin-nudo": minor
"@nudojs/parser": minor
"@nudojs/env": minor
"nudojs": minor
"@nudojs/harvester": patch
---

**BREAKING** (fix-2: close TypeScript DX gaps):

- **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
- **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design-analysis-scope.md`.

Feature highlights (after accepting the defaults above):

- Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
- Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
- IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
- Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
- dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`
