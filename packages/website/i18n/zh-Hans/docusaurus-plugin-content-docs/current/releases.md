---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.13.0 |
| `@nudojs/service` | 1.6.25 |
| `nudojs (CLI)` | 1.3.26 |
| `@nudojs/parser` | 1.4.22 |
| `@nudojs/lsp` | 1.6.8 |
| `@nudojs/env` | 0.4.40 |
| `@nudojs/harvester` | 0.3.26 |
| `vite-plugin-nudo` | 0.4.41 |
| `nudo-vscode` | 0.3.45 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.13.0 {#pkg-core}

## 1.13.0

### Minor Changes

- f5c0c6e: Guard-equality path facts and sum anchoring close the normalised-similarity derivation chain (#170) — `@nudo:assume d <= max` now proves `1 - d/max ∈ [0,1]` when `max` comes from `Math.max(a.length, b.length)` and the body guards `max === 0`, with no per-callee sidecar bounds.
  
  - `===` / `!==` on undecided operands now carry symbolic `eq`/`ne` predicates (previously folded to an unconstrained boolean), so `$fork` pushes the equality fact into branch Φ — the else arm of `max === 0 ? … : …` knows `ne(max, 0)`
  - `numericBounds` tightens an endpoint when a `ne(x, n)` fact matches its value: `x ≠ 0 ∧ x ≥ 0 ⇒ x > 0` (cross-source order-independent: the bound and the exclusion may live on the pred and Φ respectively); supplies the strict positive denominator that relational division folding requires
  - `cmp` no longer applies brand `ToPrimitive` unboxing for `eq`/`ne` — strict equality has no coercion (`new Number(5) === 5` stays false)
  - `@nudo:assume` local anchoring descends into fork-join sums: each member's term α-renames to the local's name (on that arm the member's value **is** the local), so a `d = cond ? 0 : Math.max(...)` callee result still matches the lemma; literal members keep their exact identity
  - `0 / x` with a provably non-zero, non-NaN denominator folds to literal `0` — the literal arm of such a sum no longer poisons the joined quotient bounds

更早版本（48）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.25 {#pkg-service}

## 1.6.25

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/env@0.4.40
  - @nudojs/harvester@0.3.26
  - @nudojs/parser@1.4.22

更早版本（50）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.26 {#pkg-nudojs}

## 1.3.26

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/env@0.4.40
  - @nudojs/harvester@0.3.26
  - @nudojs/parser@1.4.22
  - @nudojs/service@1.6.25

更早版本（47）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.22 {#pkg-parser}

## 1.4.22

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0

更早版本（47）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.6.8 {#pkg-lsp}

## 1.6.8

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/parser@1.4.22
  - @nudojs/service@1.6.25

更早版本（51）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.40 {#pkg-env}

## 0.4.40

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0

更早版本（47）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.26 {#pkg-harvester}

## 0.3.26

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/env@0.4.40
  - @nudojs/parser@1.4.22

更早版本（47）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.41 {#pkg-vite-plugin}

## 0.4.41

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/service@1.6.25

更早版本（50）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
