---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.7.1 |
| `@nudojs/service` | 1.6.1 |
| `nudojs (CLI)` | 1.3.2 |
| `@nudojs/parser` | 1.3.2 |
| `@nudojs/lsp` | 1.3.2 |
| `@nudojs/env` | 0.4.16 |
| `@nudojs/harvester` | 0.3.2 |
| `vite-plugin-nudo` | 0.4.17 |
| `nudo-vscode` | 0.3.21 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.7.1 {#pkg-core}

## 1.7.1

### Patch Changes

- ef514a8: fix(core): handle fork-joined sum args in arithmetic, bounds, and non-NaN

更早版本（24）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.1 {#pkg-service}

## 1.6.1

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/env@0.4.16
  - @nudojs/harvester@0.3.2
  - @nudojs/parser@1.3.2

更早版本（26）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.2 {#pkg-nudojs}

## 1.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/harvester@0.3.2
  - @nudojs/parser@1.3.2
  - @nudojs/service@1.6.1

更早版本（23）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.3.2 {#pkg-parser}

## 1.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1

更早版本（24）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.3.2 {#pkg-lsp}

## 1.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/parser@1.3.2
  - @nudojs/service@1.6.1

更早版本（27）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.16 {#pkg-env}

## 0.4.16

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1

更早版本（23）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.2 {#pkg-harvester}

## 0.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/env@0.4.16
  - @nudojs/parser@1.3.2

更早版本（23）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.17 {#pkg-vite-plugin}

## 0.4.17

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/service@1.6.1

更早版本（26）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
