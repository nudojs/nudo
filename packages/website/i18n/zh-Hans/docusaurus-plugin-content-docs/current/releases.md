---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.9.0 |
| `@nudojs/service` | 1.6.12 |
| `nudojs (CLI)` | 1.3.13 |
| `@nudojs/parser` | 1.4.9 |
| `@nudojs/lsp` | 1.4.10 |
| `@nudojs/env` | 0.4.27 |
| `@nudojs/harvester` | 0.3.13 |
| `vite-plugin-nudo` | 0.4.28 |
| `nudo-vscode` | 0.3.32 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.9.0 {#pkg-core}

## 1.9.0

### Minor Changes

- aeb6f7e: Add discriminated-union narrowing for `x.key === 'lit'` guards (issue #126). In the arm where the equality fact holds (`===` true arm / `!==` false arm), a union parameter is shadow-rebound via the new `$narrowMemberEq` runtime helper to the subset of members whose `key` domain may equal the literal: arms pinned to a different literal, closed shapes without the key, and nullish-literal members are pruned (three-state classification: `only` / `never` / `may` via shape assignability plus `implies` over the slot pred, with a local literal-disequality rule for strings/booleans the prover does not cover). Kind-specific field reads stop recording false `computed member on nullish (union arm)` may-throws. Recognizes strict equality only (`===`/`!==`, literal on either side, string/number/boolean literals, non-computed single-level member), composes across `&&`/`||` tests with the existing nullish/typeof guard channels, and applies to ternaries, `if` statements, the early-return promotion path, and optional-chain guards (`node?.type === 'lit'` also drops the null members). Dual polarity: `!==` early-returns prune the exactly-literal arm in the fall-through. Boundary (honest residual): a lenient catch-all arm like `shape({ type: string() })` admits the discriminant literal, so it is conservatively kept in the fact arm and undeclared index-read fields on it still report one L2 — the parameter domain genuinely admits such values (TypeScript keeps the overlapping arm too and flags the property as missing).

更早版本（35）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.12 {#pkg-service}

## 1.6.12

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/env@0.4.27
  - @nudojs/harvester@0.3.13
  - @nudojs/parser@1.4.9

更早版本（37）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.13 {#pkg-nudojs}

## 1.3.13

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/env@0.4.27
  - @nudojs/harvester@0.3.13
  - @nudojs/parser@1.4.9
  - @nudojs/service@1.6.12

更早版本（34）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.9 {#pkg-parser}

## 1.4.9

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0

更早版本（34）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.4.10 {#pkg-lsp}

## 1.4.10

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/parser@1.4.9
  - @nudojs/service@1.6.12

更早版本（38）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.27 {#pkg-env}

## 0.4.27

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0

更早版本（34）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.13 {#pkg-harvester}

## 0.3.13

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/env@0.4.27
  - @nudojs/parser@1.4.9

更早版本（34）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.28 {#pkg-vite-plugin}

## 0.4.28

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/service@1.6.12

更早版本（37）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
