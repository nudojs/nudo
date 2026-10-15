---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.14.0 |
| `@nudojs/service` | 1.7.0 |
| `nudojs (CLI)` | 1.4.0 |
| `@nudojs/parser` | 1.4.23 |
| `@nudojs/lsp` | 1.6.9 |
| `@nudojs/env` | 0.4.41 |
| `@nudojs/harvester` | 0.3.27 |
| `vite-plugin-nudo` | 0.4.42 |
| `nudo-vscode` | 0.3.46 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.14.0 {#pkg-core}

## 1.14.0

### Minor Changes

- 0d9e7de: Pure-expression equality folding and the `@nudo:invariant` loop lemma close #175/#176 — `const d = a === b ? 0 : Math.max(a.length, b.length); const max = Math.max(a.length, b.length); return max - d` now proves `ge(0)` with no directive, and levenshtein-style DP loops gain a user-declared invariant channel.
  
  - `sub` folds `x − x` to exact `0` (NaN arm preserved) when both operands carry structurally equal terms that pass `isDeterministicTerm` — `len#N` identity-minted leaves plus a deterministic host whitelist (`Math.max/min/…`, arithmetic). Adoption re-anchors, `get` member reads and `arg${i}` placeholders are rejected, so structurally-equal-but-distinct values never fold
  - `sub` now consumes `@nudo:assume` premises (symmetric to `divAssumeBounds`): `@nudo:assume d <= max` proves `max - d ≥ 0` — the subtraction formulation of the similarity lemma previously had no working channel
  - Domain-shared values (arr element handed to two index reads, for-of single representative, callback element args) are marked at hand-out (`len-sharing.ts`): `abstractLen` mints a fresh `len#N` per read and the reflexivity fold rejects marked operands — `xs[0].length - xs[1].length` no longer falsely folds to `0`
  - `@nudo:invariant <name><path> <rel> <number>` (`dp[*][*] >= 0`, scalar `last >= 1`): loop analogue of `@nudo:assume` — parsed in core, seeded per target entry, enforced at loop join/widen on the named binding (element domains / object slots drilled by `[*]`/`.ident`), cleared at call boundaries, audited via `nudo:invariant-relied` info (+ `nudo:invariant-invalid` for bad syntax). Unguarded `dp[m][n]` keeps its honest `number | undefined` OOB read face
  - `Array.from({length}, mapFn)` hands the callback a bounded index (`ge(0)`, plus `lt(length)` when the length term is available); the same bounds now apply to abstract-receiver `.map/.forEach/.reduce/...` callback indices and `entries()`; the array-like missing-slot seed no longer pins a false literal `0`

更早版本（49）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.7.0 {#pkg-service}

## 1.7.0

### Minor Changes

- 0d9e7de: `@nudo:skip` no longer kills `@nudo:case` evaluation (#176) — the declared face and runtime ground truth are no longer a trade-off.
  
  - A skipped function keeps `combinedAbs` from its declared return face (dts/sidecar/draft consumers unchanged), while declared `@nudo:case` directives are evaluated and asserted as usual; `nudo test` prints the skip note and the case assertions in the same block (previously the cases vanished entirely: "no declared @nudo:case expectations")
  - `nudo check` behavior is byte-identical (caseMode none — no case evaluation, no synthesized entry@ for skipped functions)

### Patch Changes

- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/env@0.4.41
  - @nudojs/harvester@0.3.27
  - @nudojs/parser@1.4.23

更早版本（51）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.4.0 {#pkg-nudojs}

## 1.4.0

### Minor Changes

- 0d9e7de: `@nudo:skip` no longer kills `@nudo:case` evaluation (#176) — the declared face and runtime ground truth are no longer a trade-off.
  
  - A skipped function keeps `combinedAbs` from its declared return face (dts/sidecar/draft consumers unchanged), while declared `@nudo:case` directives are evaluated and asserted as usual; `nudo test` prints the skip note and the case assertions in the same block (previously the cases vanished entirely: "no declared @nudo:case expectations")
  - `nudo check` behavior is byte-identical (caseMode none — no case evaluation, no synthesized entry@ for skipped functions)

### Patch Changes

- Updated dependencies [0d9e7de]
- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/service@1.7.0
  - @nudojs/env@0.4.41
  - @nudojs/harvester@0.3.27
  - @nudojs/parser@1.4.23

更早版本（48）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.23 {#pkg-parser}

## 1.4.23

### Patch Changes

- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0

更早版本（48）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.6.9 {#pkg-lsp}

## 1.6.9

### Patch Changes

- Updated dependencies [0d9e7de]
- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/service@1.7.0
  - @nudojs/parser@1.4.23

更早版本（52）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.41 {#pkg-env}

## 0.4.41

### Patch Changes

- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0

更早版本（48）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.27 {#pkg-harvester}

## 0.3.27

### Patch Changes

- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/env@0.4.41
  - @nudojs/parser@1.4.23

更早版本（48）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.42 {#pkg-vite-plugin}

## 0.4.42

### Patch Changes

- Updated dependencies [0d9e7de]
- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/service@1.7.0

更早版本（51）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
