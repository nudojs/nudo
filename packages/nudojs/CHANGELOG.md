# nudojs

## 1.0.0-beta.3

### Patch Changes

- 247f751: docs(website): product narrative — runtime-adjacent variables, Observation/Contracts layers, cost face (tokens / rounds / edit latency), top-level glossary (Abs origin, B-path, fail-closed, conf grades), TypeScript comparison without permanent dual-gate framing.

## 1.0.0-beta.2

### Patch Changes

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
- Updated dependencies [4305674]
  - @nudojs/service@5.0.0-beta.1
  - @nudojs/harvester@1.0.0-beta.1

## 1.0.0-beta.1

### Major Changes

- e29ceac: **BREAKING**: merge `@nudojs/cli` into `nudojs` — one install unit for the `nudo` command.
  
  - **`nudojs` is now the full CLI** (`check` / `test` / `contract` / `export` / `health` / `migrate`), with `bin: nudo` and the previous `@nudojs/cli` dependencies. `nudo --version` prints `nudojs <ver>` (+ `@nudojs/core <ver>` when resolvable).
  - **`@nudojs/cli` is a deprecated migration stub** that forwards `nudo` and the module entry to `nudojs` and prints a deprecation line on stderr. Prefer `npm i -g nudojs`. The stub will be unpublished.
  - No more "shell ≠ engine" version heads-up: the package you install is the product version.
  
  Migration:
  
  ```bash
  npm rm @nudojs/cli
  npm i -g nudojs   # same `nudo` bin
  ```
  
  `import "@nudojs/cli"` / `npx @nudojs/cli` keep working via the stub for one beta cycle.

## 1.0.0-beta.0

### Major Changes

- 0e1432a: feat!: source contract directive is `@nudo:contract` only
  
  `@nudo:refine` and `@nudo:interface` are deleted with no alias layer. The product word is **contract** end to end (sidecar `*.nudo.js`, `@nudo:contract`, `nudo contract`, `package.json#nudo.contract.*`).
  
  - **BREAKING:** replace every `@nudo:refine` / `@nudo:interface` with `@nudo:contract` (including `@nudo:contract return <constraint>`). Grammar is unchanged: `@nudo:contract <param> <constraint>`.
  - Constraints still enter Abs as Preds and participate in algebra (`x>0` ⇒ `x+1>1`) — this is not a call-site validation gate.
  - Diagnostic codes `nudo:interface-*` are unchanged in this release.
  - Chinese product copy uses 契约, not 精化.
- 8db7320: feat!: remove `env harvest` from the product CLI face
  
  Harvest is not a user task. Product verbs are `check` / `test` / `contract` / `export` / `health`.
  
  - **BREAKING:** `nudo env harvest` (and the `env` command group) is removed. Third-party `@types` still auto-fill during analysis via module-graph harvest; env-package generation stays available as the `@nudojs/harvester` library.
  - Handwritten `@nudojs/env` remains the fixed product env (`es` / `web` / `node`) and still wins over harvest on overlapping modules/exports.
  - Scripts that called `nudo env harvest` should either rely on analysis auto-fill or call `harvestDts` / `emitEnvModule` from `@nudojs/harvester` directly.

### Patch Changes

- P1–P3 engineering hardening (review follow-ups) — no product-face breaks
  
  - **@nudojs/parser**: export typed Babel AST narrowers (`ast-guards.ts`); service `analyzer-ast` / lsp `symbols` no longer use `as any` on nodes.
  - **@nudojs/cli**: extract pure decision modules (`check-gate-config`, `check-json-map`, `check-ci-flags`, `export-format`) and cover them with in-process unit tests; per-package coverage floors raised.
  - **@nudojs/service**: host cache-invalidation contract documented (`docs/design/cache-invalidation.md`) + C1–C8 regression tests; LSP targeted eviction now clears path-env and abs-module cache for changed deps.
  - **@nudojs/lsp**: `server.ts` split into watch/commands/navigation/code-actions/ide modules (public API unchanged); path-env clear on dependent eviction.
  - **@nudojs/service**: `interface-derivation` / `analyzer-orchestrate` split into cohesion modules with stable facades.
  - Docs: trust-boundary note in Quick Start, version narrative consistency, env mock-boundary checklist, CheckJson `actions[]` field table.
  - vite-plugin: named `logAnalysisSummary` helper (logging surface unchanged).
- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies
- Updated dependencies [279d73a]
- Updated dependencies [8db7320]
- Updated dependencies [5a5e167]
  - @nudojs/cli@4.0.0-beta.0

## 0.3.2

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/cli@3.0.0

## 0.3.1

### Patch Changes

- @nudojs/cli@2.0.1

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
  - @nudojs/cli@2.0.0

## 0.2.2

### Patch Changes

- @nudojs/cli@1.0.1

## 0.2.1

### Patch Changes

- bd28356: Rename thin shell package from unavailable npm name `nudo` to `nudojs`. The installed command remains `nudo` (`npx nudojs infer …` / `npm i -g nudojs` → `nudo infer …`).

## 0.2.0

### Minor Changes

- 0f0b7d5: **Feature**: Interface 分层推导 Phase 1（design-refine-derivation.md）

  - 侧车同名自动绑定：`foo.nudo.js` 导出绑定 `foo.js` 本地 named export；手写 > `@generated` > 隐式合并序
  - 约束代数：`lit` / `union` / `fn` / `shift` / `and` / `partial` / `pick` / `omit`
  - Abs→ 契约投影与字面量域隶属（domain-membership）
  - 新诊断：`nudo:interface-drift` / `interface-domain-exceeds` / `interface-conflict` / `interface-cycle` / `interface-load` / `interface-name-clash`
  - CLI：`nudo interface`（别名 `refine`）分层打印；`--emit` / `--fn` / `--all` / `--dry-run` / `--exit-on-diff` / `--callsites`；`nudo check --callsites`
  - 配置：`package.json#nudo.interface.autoBind`（默认 true；node_modules 永不 ambient 加载）
  - LSP：CodeLens interface 默认层 + persist/update；agent 工具 `nudo.interface` / `nudo.interface.emit`（emit 路径限制在项目根内）
  - 新薄壳包 `nudojs`（`bin` 委托 `@nudojs/cli`，命令名仍为 `nudo`）

- 0fd253f: 新增 `nudojs` 薄壳包：`npm i -g nudojs` 或 `npx nudojs` 直接获得 `nudo` 命令（委托 @nudojs/cli，参数与退出码透传）。

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
  - @nudojs/cli@1.0.0
