# @nudojs/parser


## 1.4.8

### Patch Changes

- Updated dependencies [05c2c8c]
- Updated dependencies [33239da]
- Updated dependencies [3588ddd]
- Updated dependencies [c647af8]
  - @nudojs/core@1.8.0

## 1.4.7

### Patch Changes

- Updated dependencies [427da20]
- Updated dependencies [427da20]
  - @nudojs/core@1.7.10

## 1.4.6

### Patch Changes

- Updated dependencies [b14ac2d]
  - @nudojs/core@1.7.9

## 1.4.5

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8

## 1.4.4

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7

## 1.4.3

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6

## 1.4.2

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5

## 1.4.1

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4

## 1.4.0

### Minor Changes

- 50e50f1: feat(parser): 指令文法诊断通道收敛为显式 sink
  
  > 原变更曾以 major（2.0.0）形式发布后被整班撤回；现按团队决定以 1.4.0 minor 落地。内容含删除模块级 side-channel 旧 API（`takeDirectiveDiags` / `takeDirectiveDiagsSince` / `directiveDiagCount` / `setDirectiveDiagCollector`）——仓库内全部消费方（service / lsp / nudojs / harvester）已随本班车迁移显式通道，外部如有直接使用这些旧 API 的集成请按下述迁移。
  
  - `extractDirectives(ast, { diags })` / `extractInlineDirectives(node, { diags })`：诊断同步落调用方数组，单次调用内同文案去重；不传 `diags` 为纯查询形态（诊断丢弃，等价 `extractDirectivesQuiet`）
  - 新增 `runWithDirectiveDiags(diags, fn)`：把「extract + 复解析」（如 nudo check D1 段的 `@nudo:mock` 表达式种子复解析）包进同一去重域
  - 删除模块级缓冲与上述旧 API。迁移路径：`directiveDiagCount()` + `takeDirectiveDiagsSince(since)` 锚点对 → `extractDirectives(ast, { diags })` 直接落袋（或 `runWithDirectiveDiags` 包住 extract+复解析窗口）；`takeDirectiveDiags()` 整批排干 → 显式 `diags` 数组
  - `collectEvalReplacements(source, { diags })`（@nudojs/service，additive）：行内 `@nudo:as`/`@nudo:replace` 文法诊断显式落袋，nudojs check 的 D1 并入面行为零变更（issue code / 合并顺序 / 去重口径保持）
  - 删除动因：模块级缓冲曾引发两轮跨消费方偷诊断事故（R2B-003：全量 take 在 await 窗口偷走在途诊断）；service analyzer 与 LSP validateText 此前已迁移显式通道

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3

## 1.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1

## 1.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0

## 1.3.0

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

## 1.2.1

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0

## 1.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [f10066d]
  - @nudojs/core@1.4.0

## 1.1.9

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1

## 1.1.8

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0

## 1.1.7

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2

## 1.1.6

### Patch Changes

- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1

## 1.1.5

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0

## 1.1.4

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4

## 1.1.3

### Patch Changes

- 3bf9997: fix(core): JS semantics soundness — ToString args, compare undefined, NaN identity, JSON.stringify
  
  B-path Abs folding corrections so concrete results match native JS:
  
  - string/parse methods (`startsWith`/`endsWith`/`includes`/`split`/`replace`/
    `indexOf`/`parseInt`/`parseFloat`) honor ToString and missing-arg defaults;
    `split` keeps the ES special case that an **undefined** separator returns
    `[ToString(O)]` without splitting
  - relational compare of `lit(undefined)` folds via ToNumber (all relations false)
  - same-var `===` is not exact `true` when the value may be NaN
  - `JSON.stringify` of top-level function/symbol returns the JS `undefined` value
  - NaN literal identity uses SameValue (assignment/`leq`), not `===`
  - drop unsound `x*0=0` / `x+0=x` algebra identities (NaN/`-0`/string domain)
  - `n % 0` folds to NaN; `x % k` bounds only for finite dividends
  - `0n` is falsy; `Number.is*` fold non-number lits to false; global `isNaN` coerces
  - string index methods (`charAt`/`slice`/…) honor ToNumber and default args
  - unary minus and `parseInt`/`parseFloat` honor ToNumber/ToInt32
  - Math.* folds ToNumber lits (own numeric methods only — no `constructor`/`toString`)
  - tuple index reads use canonical array index (`a["0"] === a[0]`)
  - call-spread placeholder is `unknown`, not `undefined` lit
  
  `fix(parser)`: directive scanners (`splitTopLevelArgs` / colon / arrow / balanced
  parens) respect string literals.
  
  Review follow-ups folded in: `split(undefined)` special case, `indexOf` returns
  number shape on abstract receivers, Math method allowlist.
- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3

## 1.1.2

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1

## 1.1.0-beta.0

### Minor Changes

- P1–P3 engineering hardening (review follow-ups) — no product-face breaks
  
  - **@nudojs/parser**: export typed Babel AST narrowers (`ast-guards.ts`); service `analyzer-ast` / lsp `symbols` no longer use `as any` on nodes.
  - **@nudojs/cli**: extract pure decision modules (`check-gate-config`, `check-json-map`, `check-ci-flags`, `export-format`) and cover them with in-process unit tests; per-package coverage floors raised.
  - **@nudojs/service**: host cache-invalidation contract documented (`docs/design/cache-invalidation.md`) + C1–C8 regression tests; LSP targeted eviction now clears path-env and abs-module cache for changed deps.
  - **@nudojs/lsp**: `server.ts` split into watch/commands/navigation/code-actions/ide modules (public API unchanged); path-env clear on dependent eviction.
  - **@nudojs/service**: `interface-derivation` / `analyzer-orchestrate` split into cohesion modules with stable facades.
  - Docs: trust-boundary note in Quick Start, version narrative consistency, env mock-boundary checklist, CheckJson `actions[]` field table.
  - vite-plugin: named `logAnalysisSummary` helper (logging surface unchanged).

### Patch Changes

- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
  - @nudojs/core@3.0.0-beta.0

## 1.0.0

### Major Changes

- 69ebbf6: Align product surface with interface-first design: `@nudo:case` is debug / `nudo test` only, and the `T.*` directive grammar is removed.

  - Directive type expressions accept constraint builders (`number()`, `lit()`, `shape()`, `union()`, `array()`, `any()`, …) and concrete literals only. Bare `T.*` parses as unknown; `parseTypeValueExpr` is no longer exported — use `parseCaseArgExpr`.
  - `serializeCaseArg` / `--emit-cases` emit builders (`number()`, `union(…)`) instead of `T.*`.
  - LSP `typeExprToDirective` emits builders (`number()`, `union(…)`, `any()`).
  - CLI `infer` reports call-site facts (`call@L…`) and `debug "name"` witnesses with `Observed:` joins — not `Case "…"` / `Combined:` as the type product. Contracts stay on `*.nudo.js` / `@nudo:refine`.
  - Constraint builders accept concrete nested literals so directive grammar round-trips.

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/core@2.1.0

## 0.5.1

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1

## 0.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0

## 0.4.2

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1

## 0.4.1

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0

## 0.4.0

### Minor Changes

- 1d6bb01: `getFunctionName` 对 `export const f = …`（ExportNamedDeclaration + VariableDeclaration）返回 `<anonymous>`——现在递归进入声明节点，导出箭头函数获得真实函数名，case 求值可达。

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0

## 0.3.1

### Patch Changes

- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1

## 0.3.0

### Minor Changes

- 5786fa5: Improve `@nudo:mock` parsing for sinon-style stubs and share parse/strip with core.

  - Support `stub().onFirstCall()`, `stub().callsFake(fn)`, and `sinon.`-prefixed chains as the same MockHelper shape TypeValue/Abs already consume.
  - Drop the unused `ReturnsDirective` / `@nudo:returns` directive type (contracts use `@nudo:refine`).
  - `parse()` now strips types unconditionally via core `parseSource` (shared AST cache).

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

### Patch Changes

- Updated dependencies [6c38283]
- Updated dependencies [9f7f819]
- Updated dependencies [c175f71]
  - @nudojs/core@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/core@0.1.0
