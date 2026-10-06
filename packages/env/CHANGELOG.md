# @nudojs/env

## 0.4.23

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8

## 0.4.22

### Patch Changes

- 92e6a5f: fix(core,env): L2 entry-may-throw 假阳性两处（issue #105 / #106）——1.3.5 的 builtin throws 语义对齐（2e5aeb35）引入的回归面：
  
  - **#105 typeof 守卫后的 any 不再记假 may-throw**：`$narrowTypeOf` 此前只剪 sum 成员，裸 `any`（无约束入口参数）在守卫事实臂原样保留 → `RegExp.exec/test(v)` 的 subject ToString 档位按 any 记 may-throw。修复：事实臂（keep=true）any 健全窄化为对应 prim（string/number/boolean/bigint/symbol，term/pred/conf 保留；补集臂与 object/function/undefined 不可表示、unknown fail-closed 令牌均保守保留）。npm-safe `parseVersion`（`typeof v !== 'string'` + `if (!m) return null` 双守卫 + 捕获组读）恢复干净。无守卫的 `exec(any)` 仍如实报（原生 `exec(Symbol())` 抛 TypeError，与 check-gold 的 scale(x) 口径一致）。
  - **#106 env 声明构造器不再报 constructibility 假抛**：env 的 Error 族声明为无名 envFn——`$new` 的按名派发（evalBuiltinNew → errorBrandAbs）拿不到名字，落到通用 fn 分支的 unknown-constructibility 门；`$class` 的 extends 门同样只见 ctor:undefined，`class ApiError extends Error` 定义期误报。修复：`envFn` 支持 `ctor` facet 并给 relationFn 路径补 `name` 盖章；Error 族 / Date / Promise / URL / AbortController / EventEmitter / stream 族声明 ctor:true（Symbol 声明 ctor:false——原生非构造器，`new Symbol()` / `extends Symbol` 仍定抛）；`$new` 的 ctor:true-无-impl 路径回落声明 returnType（保实例面精度，AbortController/EventEmitter 不丢方法槽）。`new Error('lit')` / `new TypeError('lit')` / `new ApiError(...)` / `class extends Error` 在 env 下恢复干净；`new Error(anyMsg)` 仍如实报 message ToString may-throw（node 实测 `new Error(Symbol())` 抛 TypeError，与无 env 宿主路径同口径）。
- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7

## 0.4.21

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6

## 0.4.20

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5

## 0.4.19

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4

## 0.4.18

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3

## 0.4.17

### Patch Changes

- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [a00bccc]
- Updated dependencies [39332ca]
- Updated dependencies [446914f]
  - @nudojs/core@1.7.2

## 0.4.16

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1

## 0.4.15

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0

## 0.4.14

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0

## 0.4.13

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0

## 0.4.12

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

## 0.4.11

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1

## 0.4.10

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0

## 0.4.9

### Patch Changes

- 662aeb5: fix(env): env-declared `Number`/`Array`/`Promise`/`Date` no longer shadow away call/construct
  
  Declaring `nudo.env` (e.g. `"es"`) bound these globals as namespace-only
  `objAbs` objects. Once shadowed, `Number(x)` and `new Array(n)` found nothing
  callable/constructible and degraded to `unknown` — the opposite of the host
  identity path (no env), which folds via `GLOBAL_FNS` / `$new`'s `cls === Array`.
  
  Dual-facet globals now model both faces (issue #58 option 1):
  
  - Abs `fn` may carry static `slots` (`Number.isFinite`, `Array.isArray`, …).
    `$get` / `$in` read them; `typeof` stays `"function"`.
  - `$new` dispatches Abs constructors by name through `evalBuiltinNew`
    (Array/Date/Promise/Number/String/Boolean/Map/Set/Error), instead of only
    the Error/Promise special cases.
  - ES env declares `Number`/`Array`/`Promise`/`Date` as callable `envFn` with
    static slots and a ctor `name`, so call, construct, and statics all keep
    builtin semantics under env shadowing.
  
  `Number(s)` folds to `number`, `new Array(n)` to a holey tuple, and
  `Number.isInteger` / `Array.isArray` stay precise with `nudo.env` declared.
- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2

## 0.4.8

### Patch Changes

- 5494f67: fix(env): `Math.min` / `Math.max` / `Math.hypot` are variadic
  
  The ES env declared them as binary (`envFn([prim.num(), prim.num()], num)`), so
  `Math.min(a, b, c)` — the ordinary usage — no longer matched the arity, and the
  call degraded to `unknown`. On a real project this turned an OSA
  Damerau–Levenshtein implementation into `unknown` and failed 8 case assertions
  the moment `nudo.env` was declared.
  
  They now use `envFnVariadic(prim.num(), prim.num(), { apply: numImplVAbs(...) })`:
  any number of literal numeric args fold (`Math.min(3, 1, 2) === 1`), and
  non-literal args yield `number` instead of `unknown`.
- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1

## 0.4.7

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0

## 0.4.6

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4

## 0.4.5

### Patch Changes

- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3

## 0.4.4

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2

## 0.4.3

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1

## 0.4.2-beta.0

### Patch Changes

- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
  - @nudojs/core@3.0.0-beta.0

## 0.4.1

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/core@2.1.0

## 0.4.0

### Minor Changes

- 9731238: **BREAKING (behavior)** `@nudojs/service`: handwritten `@nudojs/env` now **wins** over harvest / module-graph modules on overlapping module keys and export names (`mergeHarvestUnderEnv`). This is the documented B8 priority — harvest only fills missing slots — but analysis results on projects that relied on harvest overwriting a handwritten env export will change.

  Migration: remove or update the conflicting handwritten `@nudojs/env` slot if you needed harvest's version; otherwise no code change. Conflicts emit a `nudo:env-harvest-conflict` warning listing overwritten module/export names.

  Also in this service major (additive public surface, riding the required major for the priority change):

  - Public harvest helpers: `mergeHarvestUnderEnv` (optional per-call `onConflict`), `setEnvHarvestConflictCollector` (returns previous; save/restore for nested analysis), `getEnvHarvestConflictCollector`, `clearNodeHarvestCache`, `getNodeHarvestCacheSize`, `isHarvestNodeDisabled`, `HARVEST_NODE_DEFAULT_*`. Negative harvest outcomes (`not-found` / `no-dts` / `failed`) are cached in-process; `NUDO_HARVEST_NODE=off` stays explicit and uncached. `clearNodeHarvestCache()` also drops `not-found` misses so a later `@types/node` install is visible in-process. `nudo:env-harvest-conflict` warnings point at the conflicting import specifier when found (file-level `line 0` otherwise).
  - `@nudojs/env` (minor): `events` / `stream` / `querystring`; high-frequency `util` slots; **Promise APIs only under `fs.promises` / `node:fs/promises`** (callback-style `fs.readFile` etc. no longer pretend to return Promise). Optional Node params (`path.basename` ext, `url.URL` base) keep typed labels (`ext?: string`) but are **not** required slots — `requiredFnArity` skips `?` / `...`.
  - `@nudojs/core` (patch): `formatShape` renders fn rest labels (`...paths`) and optional labels (`options?`) as `...name: T` / `name?: T`. `leqAbs` fn arity uses **required** slots only (`requiredFnArity` skips `...rest` / `name?`): src is assignable to tgt iff `src.required ≤ tgt.required` (TS-like — rest src ⊑ required tgt; required src ⊭ rest tgt when src requires args). Pairwise `paramTypes` contravariance is unchanged.
  - `@nudojs/lsp` (patch): freeze inventory in `public-api.ts` (also exported as `@nudojs/lsp/public-api`); agent slash requests register from `NUDO_AGENT_TOOL_NAMES`; `selectCase` / `getActiveCases` are editor executeCommand + slash-only (not dot-form custom requests).

  Migration for env consumers who need bit-stable hover/format strings: pin `@nudojs/env` `~0.3.0` after the next release, and prefer **leaf-clean** coverage counts (empty `{  }` shapes are not leaf-clean) over raw resolved ratios.

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1

## 0.3.0

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

## 0.2.5

### Patch Changes

- 61b8a6c: Fix soundness issues in Abs evaluation:

  - `parseInt` honors hex/octal/binary prefixes and explicit radix (no forced radix 10)
  - `Array.isArray` returns unknown boolean for any/unknown/sum, and sees through brand
  - `Date.now()` is an unknown number, not a folded wall-clock timestamp
  - strict numeric bounds win over non-strict at equal value (order-independent)
  - `boundsSatisfiable` no longer downgrades strict bounds via redundant ge/le
  - structural `absShapeKey` stops join/dedup collapsing distinct arrays, overloads, brands
  - `denoteGuard` renders NaN/±Infinity correctly
  - `String.split` with non-literal separator returns `arr<string>`, not a 1-tuple

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1

## 0.2.4

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0

## 0.2.3

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0

## 0.2.2

### Patch Changes

- df1726c: Make `@nudo:env` actually affect inference: declaration-only fnSigs (readFileSync) now become relationFns instead of unknown-on-call, B-path `$invoke` implements string methods and filters union members, and `collectAbsCallRecords` merges env modules so call@ cases no longer overwrite correct B-path results.
- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0

## 0.2.0

### Minor Changes

- 0fd0718: Merge the three environment packages into one: `@nudojs/env-es`, `@nudojs/env-web`, `@nudojs/env-node` are replaced by a single `@nudojs/env` package with subpath exports `@nudojs/env/es`, `@nudojs/env/web`, `@nudojs/env/node`.

  Move agent-facing tools from the standalone MCP server into the language server: `@nudojs/mcp` is removed. `@nudojs/lsp` now exposes `nudo.whatIf`, `nudo.suggestCase`, `nudo.trace`, `nudo.selectCase`, and `nudo.getActiveCases` via `workspace/executeCommand` (custom-request aliases `nudo/whatIf` etc. included), adds pull-mode diagnostics, and works on files that are not open in the editor (disk fallback). `nudo.whatIf` now actually applies the given type bindings — previously they were ignored. AI agents connect through any LSP↔MCP bridge (cclsp, mcpls, agent-lsp) or a native LSP client; an installable agent skill ships at `packages/lsp/agent-skill/SKILL.md`.
