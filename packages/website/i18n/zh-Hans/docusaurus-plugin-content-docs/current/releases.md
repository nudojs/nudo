---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.11.0 |
| `@nudojs/service` | 1.6.20 |
| `nudojs (CLI)` | 1.3.21 |
| `@nudojs/parser` | 1.4.17 |
| `@nudojs/lsp` | 1.6.3 |
| `@nudojs/env` | 0.4.35 |
| `@nudojs/harvester` | 0.3.21 |
| `vite-plugin-nudo` | 0.4.36 |
| `nudo-vscode` | 0.3.40 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.11.0 {#pkg-core}

## 1.11.0

### Minor Changes

- 16cda31: Add `@nudo:assume <param> <= <param>` user lemmas: cross-variable bound premises participate in relational division folding, so return contracts like `1 - d/max ∈ [0,1]` become provable (#152).
  
  - `@nudo:assume a >= b` is normalized to `le(b, a)`; malformed lemmas or names outside the formal parameter list report `nudo:assume-invalid` (error).
  - Premises are seeded per target-function entry evaluation and never inherited across call boundaries (callee frames are cleared — same-name re-anchoring cannot produce false precision). Recursive calls are conservatively cleared.
  - Division folding derives the correlated bound `le(a,b) ∧ b > 0 ⇒ a/b ≤ 1` (plus mirrors), which plain interval propagation cannot express; downstream `+`/`-`/`*` folding consumes it as usual.
  - Proofs that rely on lemmas surface `nudo:assume-relied` (info) — user axioms stay audit-visible.
  - Constraint builders now throw on non-numeric bounds (`number().le("max")` previously built a silent string-literal predicate); use `@nudo:assume` for cross-variable references.

### Patch Changes

- cce5e58: Fix false `nudo:unproven-return` warnings when a return value was widened to a prim domain top by the loop-carried-binding widener (issue #151):
  
  - `postcondition.ts` now treats `conf="widened"` loop-widen products under the same policy as issue #115 partial arms: widening loses bound/path evidence but not the prim value domain, so domain membership against an unbounded bare prim contract is provable.
  - The whole-value `isValueSetUnknown` gate in `assertImplies` no longer swallows `conf="widened"` returns before arm distribution; the per-arm gates in `assertImpliesSingle` (new proved exit) and `assertSumArms` keep everything else conservative.
  - `isWidenedSumArm` also accepts arm-level `conf="widened"` (loop-widen sums carry widened on both parent and arm), enabling the existing `provesBarePrimDomain` discharge for union members such as `union(string(), lit(null))`.
  - Guards unchanged: widened arms with mismatched prim or bounded contracts (`number().gt(0)`), and any-derivation FP protection, stay `unprovable` (never `proved`, never `disproved`); non-widened exact-arm semantics are untouched.
- cce5e58: Fix array mutator spread arguments (`f.push(...xs)`) folding to `$unknown()` and polluting the container element domain (issue #153):
  
  - The array-mutator fast path in `transpile/stmt.ts` (statement position, identifier/member-path receivers) and the rebind lines of `emitArrMutatorRebinds` in `transpile/emit.ts` (expression position / nested mutators — the rebind line performs the *real* mutation, so the unknown argument landed in the container) now emit `...$elems(<expr>)`, the same flattening the ordinary call paths have used since DEC-006 K5. Generated code is a JS spread inside the args array literal, so `$elems`' returned `Abs[]` flattens element-wise into `$arrMutContainer`.
  - Element precision restored: `const findings = []; findings.push(...check(x)); return findings` keeps the precise per-element tuple from `check` instead of `[unknown]`; mixed arguments keep order (`f.push(a, ...xs, b)`); spreading an abstract array joins its known element domain via the single representative; spreading a string pushes per code point, matching native `push(..."ab")` semantics.

更早版本（43）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.20 {#pkg-service}

## 1.6.20

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/env@0.4.35
  - @nudojs/harvester@0.3.21
  - @nudojs/parser@1.4.17

更早版本（45）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.21 {#pkg-nudojs}

## 1.3.21

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/env@0.4.35
  - @nudojs/harvester@0.3.21
  - @nudojs/parser@1.4.17
  - @nudojs/service@1.6.20

更早版本（42）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.17 {#pkg-parser}

## 1.4.17

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0

更早版本（42）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.6.3 {#pkg-lsp}

## 1.6.3

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/parser@1.4.17
  - @nudojs/service@1.6.20

更早版本（46）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.35 {#pkg-env}

## 0.4.35

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0

更早版本（42）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.21 {#pkg-harvester}

## 0.3.21

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/env@0.4.35
  - @nudojs/parser@1.4.17

更早版本（42）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.36 {#pkg-vite-plugin}

## 0.4.36

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/service@1.6.20

更早版本（45）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
