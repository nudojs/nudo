# @nudojs/harvester

## 0.3.14

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/env@0.4.28
  - @nudojs/parser@1.4.10

## 0.3.13

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/env@0.4.27
  - @nudojs/parser@1.4.9

## 0.3.12

### Patch Changes

- Updated dependencies [05c2c8c]
- Updated dependencies [33239da]
- Updated dependencies [3588ddd]
- Updated dependencies [c647af8]
  - @nudojs/core@1.8.0
  - @nudojs/env@0.4.26
  - @nudojs/parser@1.4.8

## 0.3.11

### Patch Changes

- Updated dependencies [427da20]
- Updated dependencies [427da20]
  - @nudojs/core@1.7.10
  - @nudojs/env@0.4.25
  - @nudojs/parser@1.4.7

## 0.3.10

### Patch Changes

- Updated dependencies [b14ac2d]
  - @nudojs/core@1.7.9
  - @nudojs/env@0.4.24
  - @nudojs/parser@1.4.6

## 0.3.9

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/env@0.4.23
  - @nudojs/parser@1.4.5

## 0.3.8

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/env@0.4.22
  - @nudojs/parser@1.4.4

## 0.3.7

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/env@0.4.21
  - @nudojs/parser@1.4.3

## 0.3.6

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/env@0.4.20
  - @nudojs/parser@1.4.2

## 0.3.5

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/env@0.4.19
  - @nudojs/parser@1.4.1

## 0.3.4

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/parser@1.4.0
  - @nudojs/env@0.4.18

## 0.3.3

### Patch Changes

- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [a00bccc]
- Updated dependencies [39332ca]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
  - @nudojs/core@1.7.2
  - @nudojs/parser@2.0.0
  - @nudojs/env@0.4.17

## 0.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/env@0.4.16
  - @nudojs/parser@1.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/env@0.4.15
  - @nudojs/parser@1.3.1

## 0.3.0

### Minor Changes

- 2f9717b: repo-wide correctness batch (fix-10: 19 fixes + 3 design-defect fixes)

  Security & correctness:
  - type-expression AST whitelist blocks @nudo:case/@nudo:as RCE (P0)
  - unified export/binding-name sanitization (reserved words / collisions)
  - slot & export tables read via own-property, blocking Object.prototype members

  Type system:
  - tuple rest slot effective across leq / widen / runtime / schema / dts
  - x++/x-- propagate term/pred/Φ constraints from the same source as +=/-=
  - key-channel literals distinguish -0/0 (litKeyString)
  - projection/format exits unified under ProjectionBudget: cycle & depth truncation observable

  CLI gates & contracts:
  - health --from path errors fold into pathErrors; ok↔exit single source
  - migrate verify/health pass skips, judged same as nudo check
  - malformed JSDoc directives no longer silently dropped / line-swallowed / host-throwing
  - case-arg recursion depth cap 32 (DoS protection)

  Service layer:
  - cache-limit precedence explicit > env > project; env params take effect per call
  - session LRUs aligned with BoundedLruMap (overwrite refreshes position; max=0 read miss)
  - module-cache entries carry subtree content fingerprints; transitive invalidation cohesive (DESIGN-002)
  - sidecar contract identity = export name, binding name aliasable; reserved-word / string exports emitted safely (DESIGN-003)
  - @nudo:import alias lookup uses the original export name; miss reports a diagnostic

  Parsing & diagnostics:
  - eval diagnostics cover rest / default-value / named-expression declarations and computed-key references
  - ambient sidecar lookup includes .nudo.mjs; suffix set single source of truth

  S2/S5/S6 tracking batch (BUG-017–028):
  - type inference: collectPredVars collects assumeFinite constraints; eqLit channel tagged (eq(x, lit(undefined)) projectable); non-finite bounds (NaN/±Infinity) not projected; fn rest non-array types promoted to (T)[]; optional param names keep `?`
  - gates & CLI: check --fix preserves gate semantics (residual errors exit 1; flag combos are usage errors); variadic flags swallowing positional args → targeted usage error + `--` terminator; export on the PathError face (nudo:path-* + nudo:path-io); findProjectConfig parse-failure diagnostic + stop
  - eval engine: injection-table collection exceptions fail-closed (never a half table); same-name class collision epoch detection + fallback observation; EvalCallRecord.threw required + bridge fail-closed (omitted threw → throwsAbs unknown); tryEvalCall explicit isAbsVal guard
  - LSP / error face: validateText document version gate (stale analysis never published); diagnostic / agent error message absolute-path redaction (home→~, root→.); injection setup failure surfaces and blocks exit
  - observation face: standard-schema missing-key vs explicit-undefined distinction; dts projection optional param names, fn rest TS validity

  PR #80 review batches (merge 7e6051ae):
  - own-property reads across sidecar import/export tables and the modules table; emit-identity dedup; quote-aware sidecar binding scan; check injection-failure gate (no fake-green --json exit, no degraded cache write); class-collision epoch scoped to the entry-call phase; LSP error redaction with real workspace roots; health --from requires explicit paths

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/parser@1.3.0
  - @nudojs/env@0.4.14

## 0.2.19

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0
  - @nudojs/env@0.4.13
  - @nudojs/parser@1.2.1

## 0.2.18

### Patch Changes

- f10066d: fix: repository-scale bug hunt — algebra, CLI, IDE, cache, release hardening
  
  Correctness (core algebra / check):
  - `Symbol() < 1` now TypeError (cmp relational ops); `eq`/`ne` unchanged
  - bare prim contracts reject obj/arr/tuple/fn/brand/eff returns
  - `lit(undefined)` is a real literal (`LitValueResult {ok,value}` tagged path)
  - empty-sum reduce guards (DEC-006); explicit re-exports win over `export *`
  - projection fidelity: tuple holes, tuple-rest parens, schema eq-app anchoring
  
  Design refactors (additive public API):
  - `LitValueResult` + bigint in `LiteralValue`
  - `AbsApplyResult {abs,throws}` + `callTranspiledExportApply` (sole wrap point) + `$call` throws routing
  - `directive-scan` single-source extractors; directives bind AST nearest Function (nested/class/object methods)
  - `stablePathKey` / `stablePathKeyGraph` for L0/LSP/CLI/disk path identity
  
  Product / CLI / migrate:
  - `check --json` path errors enter the CheckJson envelope (`pathErrors`, `ok:false`); ok↔exit single source
  - migrate: missing paths error (no parent `package.json` fallthrough); retire is atomic with rollback; rewritten paths are single-quoted
  - malformed directives warn instead of silent drop; `@nudo:skip` requires explicit types
  
  Service / cache:
  - disk-cache atomic write + portable path keys (incl. maxForks in cache key)
  - pure memo replays may-throw; bounded memo maps; sidecar EACCES ≠ missing
  
  IDE / extension:
  - LSP path-key unify (Windows drive forms); directive diag watermark; hover follows G2 scope
  - VS Code client catches start/sendRequest; selectCase rollback
  
  Release / CI supply chain:
  - `gen-llms` confines slug writes under build root (path-escape fix)
  - gate-major: 2.x / major jumps / first 1.0.0 need `confirm_major`; 1.x train auto-publishes
  - release: quoted secrets, tag whitelist + semver precedence incl. prerelease, pinned website actions
- Updated dependencies [f10066d]
  - @nudojs/core@1.4.0
  - @nudojs/parser@1.2.0
  - @nudojs/env@0.4.12

## 0.2.17

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/env@0.4.11
  - @nudojs/parser@1.1.9

## 0.2.16

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/env@0.4.10
  - @nudojs/parser@1.1.8

## 0.2.15

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/env@0.4.9
  - @nudojs/parser@1.1.7

## 0.2.14

### Patch Changes

- Updated dependencies [5494f67]
- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/env@0.4.8
  - @nudojs/core@1.2.1
  - @nudojs/parser@1.1.6

## 0.2.13

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/env@0.4.7
  - @nudojs/parser@1.1.5

## 0.2.12

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/env@0.4.6
  - @nudojs/parser@1.1.4

## 0.2.11

### Patch Changes

- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/env@0.4.5

## 0.2.10

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2
  - @nudojs/env@0.4.4
  - @nudojs/parser@1.1.2

## 0.2.9

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1
  - @nudojs/env@0.4.3
  - @nudojs/parser@1.1.1

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
