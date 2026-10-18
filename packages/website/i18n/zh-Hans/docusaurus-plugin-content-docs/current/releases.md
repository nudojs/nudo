---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.15.2 |
| `@nudojs/service` | 1.9.2 |
| `nudojs (CLI)` | 1.6.2 |
| `@nudojs/parser` | 1.5.2 |
| `@nudojs/lsp` | 1.7.2 |
| `@nudojs/env` | 0.5.2 |
| `@nudojs/harvester` | 0.4.2 |
| `vite-plugin-nudo` | 0.5.2 |
| `nudo-vscode` | 0.3.50 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.15.2 {#pkg-core}

## 1.15.2

### Patch Changes

- 4513a45: Fix a 5.5x yargs regression from the Bug 116 strict seam: guard shadow
  rebinding emitted the **guarded identifier** as an arrow parameter
  (`((arguments) => THUNK)(…)` for `if (arguments.length === 0)` style
  discriminant/nullish/typeof/rel guards), and `arguments`/`eval` are
  illegal binding names in strict code — the whole module body then died
  at `new Function` compile time with "Unexpected eval or arguments in
  strict mode", fail-closed to empty exports, and since failed evals are
  never memoized every analysis re-transpiled the file (yargs check
  5952ms → 1161ms after the fix). Guard names that cannot be bound in
  strict mode now skip the narrowing wrapper entirely (same all-or-nothing
  skip as fork-binding collisions — narrowing is a precision gain, not a
  semantic obligation). The `"use strict"` prefix itself is now scoped to
  sources with ESM syntax (`sourceHasEsmSyntax`: static `import` / any
  `export` statement ⇒ definitely ESM); sources without it follow Node's
  `.js`-without-`type:"module"` default and stay CommonJS/sloppy, so
  sloppy-legal constructs (implicit global writes, `arguments` bindings)
  no longer miscompile in CJS files. Docs: the levenshtein
  `@nudo:invariant` example splits its L2 expectation
  (`--ignore-throws RangeError`, mirroring the engine test suite) for the
  legitimate `Array.from` array-like-length may-throw.

更早版本（53）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.9.2 {#pkg-service}

## 1.9.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/env@0.5.2
  - @nudojs/harvester@0.4.2
  - @nudojs/parser@1.5.2

更早版本（55）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.6.2 {#pkg-nudojs}

## 1.6.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/env@0.5.2
  - @nudojs/harvester@0.4.2
  - @nudojs/parser@1.5.2
  - @nudojs/service@1.9.2

更早版本（52）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.2 {#pkg-parser}

## 1.5.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2

更早版本（52）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.7.2 {#pkg-lsp}

## 1.7.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/parser@1.5.2
  - @nudojs/service@1.9.2

更早版本（56）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.2 {#pkg-env}

## 0.5.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2

更早版本（52）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.4.2 {#pkg-harvester}

## 0.4.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/env@0.5.2
  - @nudojs/parser@1.5.2

更早版本（52）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.5.2 {#pkg-vite-plugin}

## 0.5.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/service@1.9.2

更早版本（55）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
