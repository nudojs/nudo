---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.14.1 |
| `@nudojs/service` | 1.8.0 |
| `nudojs (CLI)` | 1.5.0 |
| `@nudojs/parser` | 1.4.24 |
| `@nudojs/lsp` | 1.6.10 |
| `@nudojs/env` | 0.4.42 |
| `@nudojs/harvester` | 0.3.28 |
| `vite-plugin-nudo` | 0.4.43 |
| `nudo-vscode` | 0.3.47 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.14.1 {#pkg-core}

## 1.14.1

### Patch Changes

- c19bd48: Host-global function collection no longer leaks Node lazy-getter warnings, and check hints point at the env directive (fix-12 batch).
  
  - `hostGlobalFnIds` skips accessor properties by descriptor shape (deny-by-default) instead of a name denylist — bare-node embedding consumers no longer emit `ExperimentalWarning`/`DeprecationWarning` for localStorage, punycode (DEP0040), sys (DEP0025), wasi/ffi; only the empirically warning-free, function-valued accessors (`Buffer`, `assert`, `events`, `stream`, `node:test`) are read. Future warning-emitting lazy getters are skipped automatically (fail-closed); parity probe on node 26 confirms an identical 122-function collection set.
  - Opaque-result diagnostics now suggest `/// @nudo:env` when the file imports builtin modules with no env active.

更早版本（50）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.8.0 {#pkg-service}

## 1.8.0

### Minor Changes

- c19bd48: Misplaced file-level directives now warn instead of being silently ignored, and `nudo.analysis.exclude` supports real globs (fix-12 batch).
  
  - parser: file-level directives (`@nudo:env` / `@nudo:mock-module`) written inside JSDoc blocks emit `nudo:directive-syntax` with the correct `///` form instead of being dropped silently.
  - service: `nudo.analysis.exclude` accepts glob patterns (shared `compilePattern`, extracted from vite-plugin as the single source; plain substrings still work, defaults always stack).
  - vite-plugin: pattern matching cut over to the shared `compilePattern` — behavior unchanged, one implementation.

### Patch Changes

- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/parser@1.4.24
  - @nudojs/env@0.4.42
  - @nudojs/harvester@0.3.28

更早版本（52）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.5.0 {#pkg-nudojs}

## 1.5.0

### Minor Changes

- c19bd48: DX batch: face consistency across check/fix/export/health/test, plus `nudo init` and onboarding (fix-12, 20-point TS-parity batch).
  
  - `export --format dts` consumes contract faces through the same `effectiveInterface` source as `check` — non-exported top-level functions no longer leak into `.d.ts`; evidence-less params stay unknown with a stderr note.
  - `health` budget line no longer contradicts `check`: per-file budget snapshot, attribution segments only for the budget that actually triggered (depth 64/64, not "eval calls 71/20000"); human face and multi-envelope budgets aligned.
  - `check --fix` no longer writes non-fixing contracts: array-method receivers synthesize `array(shape({...}))` from callback element reads, and a re-check gate downgrades unprovable totality to `[review]` — no auto-applied half-fixes.
  - new `nudo init`: writes an idempotent adoption baseline into package.json (L2 → warning).
  - zero-config failing check prints an onboarding block (`init` / `contract --draft` / `--profile` adoption); gate exit code unchanged.
  - `nudo.test.profile` typos warn on stderr; syntax-error files print tsc-style blocks (path:line:col + excerpt + caret), `--json` folds them into `pathErrors`.
  - `nudo test` annotates `entry@` fallback cases on contracted functions.
  - TTY colors for severity markers / section headers (`NO_COLOR` master switch, `FORCE_COLOR` override, piped output stays plain); `check --quiet` suppresses signatures; `check --help` flags grouped (Common/Observation/Fix/CI/What-if); `contract --draft` emits uncomment-to-accept suggested bindings; diagnostics outside cwd print absolute paths; multi-file check prints an opt-in cache hint.

### Patch Changes

- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/parser@1.4.24
  - @nudojs/service@1.8.0
  - @nudojs/env@0.4.42
  - @nudojs/harvester@0.3.28

更早版本（49）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.24 {#pkg-parser}

## 1.4.24

### Patch Changes

- c19bd48: Misplaced file-level directives now warn instead of being silently ignored, and `nudo.analysis.exclude` supports real globs (fix-12 batch).
  
  - parser: file-level directives (`@nudo:env` / `@nudo:mock-module`) written inside JSDoc blocks emit `nudo:directive-syntax` with the correct `///` form instead of being dropped silently.
  - service: `nudo.analysis.exclude` accepts glob patterns (shared `compilePattern`, extracted from vite-plugin as the single source; plain substrings still work, defaults always stack).
  - vite-plugin: pattern matching cut over to the shared `compilePattern` — behavior unchanged, one implementation.
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1

更早版本（49）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.6.10 {#pkg-lsp}

## 1.6.10

### Patch Changes

- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/parser@1.4.24
  - @nudojs/service@1.8.0

更早版本（53）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.42 {#pkg-env}

## 0.4.42

### Patch Changes

- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1

更早版本（49）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.28 {#pkg-harvester}

## 0.3.28

### Patch Changes

- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/parser@1.4.24
  - @nudojs/env@0.4.42

更早版本（49）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.43 {#pkg-vite-plugin}

## 0.4.43

### Patch Changes

- c19bd48: Misplaced file-level directives now warn instead of being silently ignored, and `nudo.analysis.exclude` supports real globs (fix-12 batch).
  
  - parser: file-level directives (`@nudo:env` / `@nudo:mock-module`) written inside JSDoc blocks emit `nudo:directive-syntax` with the correct `///` form instead of being dropped silently.
  - service: `nudo.analysis.exclude` accepts glob patterns (shared `compilePattern`, extracted from vite-plugin as the single source; plain substrings still work, defaults always stack).
  - vite-plugin: pattern matching cut over to the shared `compilePattern` — behavior unchanged, one implementation.
- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/service@1.8.0

更早版本（52）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
