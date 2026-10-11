---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.10.1 |
| `@nudojs/service` | 1.6.18 |
| `nudojs (CLI)` | 1.3.19 |
| `@nudojs/parser` | 1.4.15 |
| `@nudojs/lsp` | 1.6.1 |
| `@nudojs/env` | 0.4.33 |
| `@nudojs/harvester` | 0.3.19 |
| `vite-plugin-nudo` | 0.4.34 |
| `nudo-vscode` | 0.3.38 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.10.1 {#pkg-core}

## 1.10.1

### Patch Changes

- 96090cd: Fix unsound getter loss on object joins: `joinAbs`/`joinObjects` built the merged object as a fresh Abs identity without migrating the accessor side table, so a getter arm joined with a data arm read as its `undefined` placeholder (`{ get q() { return 42; } }` joined with `{ q: 0 }` read `undefined | 0` instead of `42 | 0`). Mixed arms now fold the getter's read domain (evaluated with its original receiver, same as `$spread`) into the data slot; arms sharing the identical accessor definition (aliases, migrated immutable updates such as loop-widening frames) migrate the registration whole so reads keep dispatching through the side table. The accessor table moved to a leaf module `algebra/accessors.ts` so `objects.ts` can consume it without an import cycle; `annotateJoinPath`'s re-wrap now migrates registrations to the final identity.

更早版本（41）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.18 {#pkg-service}

## 1.6.18

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/env@0.4.33
  - @nudojs/harvester@0.3.19
  - @nudojs/parser@1.4.15

更早版本（43）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.19 {#pkg-nudojs}

## 1.3.19

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/env@0.4.33
  - @nudojs/harvester@0.3.19
  - @nudojs/parser@1.4.15
  - @nudojs/service@1.6.18

更早版本（40）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.15 {#pkg-parser}

## 1.4.15

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1

更早版本（40）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.6.1 {#pkg-lsp}

## 1.6.1

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/parser@1.4.15
  - @nudojs/service@1.6.18

更早版本（44）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.33 {#pkg-env}

## 0.4.33

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1

更早版本（40）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.19 {#pkg-harvester}

## 0.3.19

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/env@0.4.33
  - @nudojs/parser@1.4.15

更早版本（40）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.34 {#pkg-vite-plugin}

## 0.4.34

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/service@1.6.18

更早版本（43）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
