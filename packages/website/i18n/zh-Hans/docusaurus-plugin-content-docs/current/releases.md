---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.9.2 |
| `@nudojs/service` | 1.6.14 |
| `nudojs (CLI)` | 1.3.15 |
| `@nudojs/parser` | 1.4.11 |
| `@nudojs/lsp` | 1.4.12 |
| `@nudojs/env` | 0.4.29 |
| `@nudojs/harvester` | 0.3.15 |
| `vite-plugin-nudo` | 0.4.30 |
| `nudo-vscode` | 0.3.34 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.9.2 {#pkg-core}

## 1.9.2

### Patch Changes

- c8e0417: Propagate member truthy-guard facts into union containers (issue #129). `$removeMemberNullish` now classifies sum members per the guarded key: members whose read is definitely nullish — a closed shape without the key whose absent read yields `undefined` (no `open`/index signature, no `Object.prototype`/`constructor` key, no getter), or a getter-free all-nullish slot value — cannot survive the truthy arm and are pruned; members with `T | nullish` slot values or `optional` flags are rebuilt with the nullish members stripped and the flag dropped (same refinement the single-object branch has applied since #118, now also migrating the accessor/invariant/nullProto side tables to the rebuilt identity). `if (!node.property) return` followed by a chained re-read `node.property.type` on a discriminated union with a lenient catch-all arm no longer records a false `property 'type' on undefined` may-throw. Keys whose absent read is unjudgeable — `open`/index shapes, `Object.prototype` method names and `constructor` (proto-chain reads a function), and getter-backed keys (the read returns the getter result, not the placeholder slot) — stay conservatively, as do `any`/`unknown` slot values and non-object members; all-pruned sums pass through unchanged and single-member remainders collapse, matching `$narrowMemberEq` conventions.

更早版本（37）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.14 {#pkg-service}

## 1.6.14

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/env@0.4.29
  - @nudojs/harvester@0.3.15
  - @nudojs/parser@1.4.11

更早版本（39）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.15 {#pkg-nudojs}

## 1.3.15

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/env@0.4.29
  - @nudojs/harvester@0.3.15
  - @nudojs/parser@1.4.11
  - @nudojs/service@1.6.14

更早版本（36）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.11 {#pkg-parser}

## 1.4.11

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2

更早版本（36）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.4.12 {#pkg-lsp}

## 1.4.12

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/parser@1.4.11
  - @nudojs/service@1.6.14

更早版本（40）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.29 {#pkg-env}

## 0.4.29

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2

更早版本（36）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.15 {#pkg-harvester}

## 0.3.15

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/env@0.4.29
  - @nudojs/parser@1.4.11

更早版本（36）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.30 {#pkg-vite-plugin}

## 0.4.30

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/service@1.6.14

更早版本（39）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
