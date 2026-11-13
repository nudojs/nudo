---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.19.1 |
| `@nudojs/service` | 1.12.1 |
| `nudojs (CLI)` | 1.9.1 |
| `@nudojs/parser` | 1.5.9 |
| `@nudojs/lsp` | 1.10.1 |
| `@nudojs/env` | 0.5.9 |
| `@nudojs/harvester` | 0.6.1 |
| `vite-plugin-nudo` | 0.7.2 |
| `nudo-vscode` | 0.3.57 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.19.1 {#pkg-core}

## 1.19.1

### Patch Changes

- 86bc56e: Fix: conjunctive guard facts now accumulate across parameters (issue #185), without weakening the NaN complement red line.
  
  - `matchRelIdentLitComposite` keeps **every** guarded name in a relational conjunction (`x >= 1 && y >= 2`), exposing the non-first names as `RelGuard.others`; `narrowRelArmThunk` applies them all as `$refineRel` shadow rebindings in the fact arm. Same-name bounds stay in `extra` (tightest per operator, unchanged).
  - `&&` short-circuit cons arm (right operand) now receives the left operand's relational guard (`relGuardOf(expr.left)`) — `x >= 1 && (y >= 2 ? x + y : 3)` keeps `x`'s bound inside the right side.
  - New `relGuardOfNegation` / `narrowRelNegationArmThunk`: when the test is `!(A ∧ …)`, the **false** arm (early-return rest path, `if` else arm, ternary alternate, `||` right operand) soundly asserts every relational conjunct of `A` — `!` is exact boolean negation, so NaN cannot slip through (`!(x < k)` false ⟺ `x < k` true). Bare relational complements (`if (x < k) return …;` rest path) remain un-narrowed per Bug 1115.
  - Result: `x >= 1 && y >= 2 ? x + y : 3`, `if (x >= 1 && y >= 2) { return x + y } return 3`, and `if (!(x >= 1 && y >= 2)) return 3; return x + y` now discharge `return number().ge(3)`; the sequential guard-clause and De Morgan spellings stay `nudo:unproven-return` because `number()` admits NaN (`add6(NaN, 5) = NaN`), which is the correct verdict.

更早版本（60）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.12.1 {#pkg-service}

## 1.12.1

### Patch Changes

- Updated dependencies [86bc56e]
  - @nudojs/core@1.19.1
  - @nudojs/env@0.5.9
  - @nudojs/harvester@0.6.1
  - @nudojs/parser@1.5.9

更早版本（62）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.9.1 {#pkg-nudojs}

## 1.9.1

### Patch Changes

- Updated dependencies [86bc56e]
  - @nudojs/core@1.19.1
  - @nudojs/env@0.5.9
  - @nudojs/harvester@0.6.1
  - @nudojs/parser@1.5.9
  - @nudojs/service@1.12.1

更早版本（59）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.9 {#pkg-parser}

## 1.5.9

### Patch Changes

- Updated dependencies [86bc56e]
  - @nudojs/core@1.19.1

更早版本（59）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.10.1 {#pkg-lsp}

## 1.10.1

### Patch Changes

- Updated dependencies [86bc56e]
  - @nudojs/core@1.19.1
  - @nudojs/parser@1.5.9
  - @nudojs/service@1.12.1

更早版本（63）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.9 {#pkg-env}

## 0.5.9

### Patch Changes

- Updated dependencies [86bc56e]
  - @nudojs/core@1.19.1

更早版本（59）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.6.1 {#pkg-harvester}

## 0.6.1

### Patch Changes

- Updated dependencies [86bc56e]
  - @nudojs/core@1.19.1
  - @nudojs/env@0.5.9
  - @nudojs/parser@1.5.9

更早版本（59）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.7.2 {#pkg-vite-plugin}

## 0.7.2

### Patch Changes

- Updated dependencies [86bc56e]
  - @nudojs/core@1.19.1
  - @nudojs/service@1.12.1

更早版本（62）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
