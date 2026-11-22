---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.20.4 |
| `@nudojs/service` | 1.12.6 |
| `nudojs (CLI)` | 1.9.6 |
| `@nudojs/parser` | 1.5.14 |
| `@nudojs/lsp` | 1.10.6 |
| `@nudojs/env` | 0.5.14 |
| `@nudojs/harvester` | 0.6.6 |
| `vite-plugin-nudo` | 0.7.7 |
| `nudo-vscode` | 0.3.62 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.20.4 {#pkg-core}

## 1.20.4

### Patch Changes

- 322ad41: Resolve the remaining audit batch: type-text mapping, entry domains, narrowing, dts/validator projection, builtins, and contract-draft evidence.
  
  - TS annotations: same-file interface/type-alias references, generic type parameters and constraints, function/method signatures, index signatures, literal terms (including hex/bin/oct/BigInt/separators), readonly tuples, tuple labels, intersection merging, `keyof`, indexed access and template literal types now map into the entry domain. Explicit `unknown` annotations are declarations, not inference failures.
  - Check/entry: default initializers, destructured defaults, rest annotations and optional-parameter undefined arms seed the same entry domain used by dts/guard/zod/standard; local `let`/`var` annotations feed assignment reconciliation.
  - Narrowing: `typeof` narrows `unknown` and member targets, user-defined type predicates participate in call-site narrowing, `in` produces union pruning facts, member logical assignments write back, and switch/fallback arms apply negated guard facts.
  - dts/validators: annotation gates recognize rest tuples, global lib type names and `typeof` value references; literal and readonly declarations survive observed returns; class fields/accessors and object methods keep their signatures; module value aliases, default interfaces, `export type`, class expressions, user symbols and `unique symbol` render correctly.
  - Builtins: `Object.fromEntries` expands typed entry arrays; `String.match` and array iterators retain per-index/element domains; `flat` no longer joins the original element domain; abstract index reads do not invent an undefined arm.
  - Architecture: one annotation resolver now owns type-parameter / same-file / imported / built-in / `typeof` name resolution, and one `buildEntryDomain` feeds check, L2, service entry witnesses, dts and validators. Unresolvable annotations surface as `nudo:annotation-unresolved` instead of silently falling back to `any`.
  - Annotation names: relative / package `types` / tsconfig `paths` modules are resolved for type imports; explicit `unknown` and generic parameters now use provenance/term namespaces instead of silent `any`.
  - Provenance: `Abs` gains a `provenance` facet (`declared` / `observed` / `asserted` / `inferred` / `synthetic`); dts and validator projection use it to preserve declared literals and drop synthetic OOB arms at the boundary.
  - `contract --draft`: coercion calls and operator uses are not type evidence; drafts import the constraint `lit` alias, strip single-line JSDoc tails, keep throws in suggested bodies, and preserve generalized return obligations.

更早版本（65）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.12.6 {#pkg-service}

## 1.12.6

### Patch Changes

- 322ad41: Resolve the remaining audit batch: type-text mapping, entry domains, narrowing, dts/validator projection, builtins, and contract-draft evidence.
  
  - TS annotations: same-file interface/type-alias references, generic type parameters and constraints, function/method signatures, index signatures, literal terms (including hex/bin/oct/BigInt/separators), readonly tuples, tuple labels, intersection merging, `keyof`, indexed access and template literal types now map into the entry domain. Explicit `unknown` annotations are declarations, not inference failures.
  - Check/entry: default initializers, destructured defaults, rest annotations and optional-parameter undefined arms seed the same entry domain used by dts/guard/zod/standard; local `let`/`var` annotations feed assignment reconciliation.
  - Narrowing: `typeof` narrows `unknown` and member targets, user-defined type predicates participate in call-site narrowing, `in` produces union pruning facts, member logical assignments write back, and switch/fallback arms apply negated guard facts.
  - dts/validators: annotation gates recognize rest tuples, global lib type names and `typeof` value references; literal and readonly declarations survive observed returns; class fields/accessors and object methods keep their signatures; module value aliases, default interfaces, `export type`, class expressions, user symbols and `unique symbol` render correctly.
  - Builtins: `Object.fromEntries` expands typed entry arrays; `String.match` and array iterators retain per-index/element domains; `flat` no longer joins the original element domain; abstract index reads do not invent an undefined arm.
  - Architecture: one annotation resolver now owns type-parameter / same-file / imported / built-in / `typeof` name resolution, and one `buildEntryDomain` feeds check, L2, service entry witnesses, dts and validators. Unresolvable annotations surface as `nudo:annotation-unresolved` instead of silently falling back to `any`.
  - Annotation names: relative / package `types` / tsconfig `paths` modules are resolved for type imports; explicit `unknown` and generic parameters now use provenance/term namespaces instead of silent `any`.
  - Provenance: `Abs` gains a `provenance` facet (`declared` / `observed` / `asserted` / `inferred` / `synthetic`); dts and validator projection use it to preserve declared literals and drop synthetic OOB arms at the boundary.
  - `contract --draft`: coercion calls and operator uses are not type evidence; drafts import the constraint `lit` alias, strip single-line JSDoc tails, keep throws in suggested bodies, and preserve generalized return obligations.
- Updated dependencies [322ad41]
  - @nudojs/core@1.20.4
  - @nudojs/env@0.5.14
  - @nudojs/harvester@0.6.6
  - @nudojs/parser@1.5.14

更早版本（67）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.9.6 {#pkg-nudojs}

## 1.9.6

### Patch Changes

- 322ad41: Resolve the remaining audit batch: type-text mapping, entry domains, narrowing, dts/validator projection, builtins, and contract-draft evidence.
  
  - TS annotations: same-file interface/type-alias references, generic type parameters and constraints, function/method signatures, index signatures, literal terms (including hex/bin/oct/BigInt/separators), readonly tuples, tuple labels, intersection merging, `keyof`, indexed access and template literal types now map into the entry domain. Explicit `unknown` annotations are declarations, not inference failures.
  - Check/entry: default initializers, destructured defaults, rest annotations and optional-parameter undefined arms seed the same entry domain used by dts/guard/zod/standard; local `let`/`var` annotations feed assignment reconciliation.
  - Narrowing: `typeof` narrows `unknown` and member targets, user-defined type predicates participate in call-site narrowing, `in` produces union pruning facts, member logical assignments write back, and switch/fallback arms apply negated guard facts.
  - dts/validators: annotation gates recognize rest tuples, global lib type names and `typeof` value references; literal and readonly declarations survive observed returns; class fields/accessors and object methods keep their signatures; module value aliases, default interfaces, `export type`, class expressions, user symbols and `unique symbol` render correctly.
  - Builtins: `Object.fromEntries` expands typed entry arrays; `String.match` and array iterators retain per-index/element domains; `flat` no longer joins the original element domain; abstract index reads do not invent an undefined arm.
  - Architecture: one annotation resolver now owns type-parameter / same-file / imported / built-in / `typeof` name resolution, and one `buildEntryDomain` feeds check, L2, service entry witnesses, dts and validators. Unresolvable annotations surface as `nudo:annotation-unresolved` instead of silently falling back to `any`.
  - Annotation names: relative / package `types` / tsconfig `paths` modules are resolved for type imports; explicit `unknown` and generic parameters now use provenance/term namespaces instead of silent `any`.
  - Provenance: `Abs` gains a `provenance` facet (`declared` / `observed` / `asserted` / `inferred` / `synthetic`); dts and validator projection use it to preserve declared literals and drop synthetic OOB arms at the boundary.
  - `contract --draft`: coercion calls and operator uses are not type evidence; drafts import the constraint `lit` alias, strip single-line JSDoc tails, keep throws in suggested bodies, and preserve generalized return obligations.
- Updated dependencies [322ad41]
  - @nudojs/core@1.20.4
  - @nudojs/service@1.12.6
  - @nudojs/env@0.5.14
  - @nudojs/harvester@0.6.6
  - @nudojs/parser@1.5.14

更早版本（64）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.14 {#pkg-parser}

## 1.5.14

### Patch Changes

- Updated dependencies [322ad41]
  - @nudojs/core@1.20.4

更早版本（64）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.10.6 {#pkg-lsp}

## 1.10.6

### Patch Changes

- Updated dependencies [322ad41]
  - @nudojs/core@1.20.4
  - @nudojs/service@1.12.6
  - @nudojs/parser@1.5.14

更早版本（68）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.14 {#pkg-env}

## 0.5.14

### Patch Changes

- Updated dependencies [322ad41]
  - @nudojs/core@1.20.4

更早版本（64）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.6.6 {#pkg-harvester}

## 0.6.6

### Patch Changes

- Updated dependencies [322ad41]
  - @nudojs/core@1.20.4
  - @nudojs/env@0.5.14
  - @nudojs/parser@1.5.14

更早版本（64）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.7.7 {#pkg-vite-plugin}

## 0.7.7

### Patch Changes

- Updated dependencies [322ad41]
  - @nudojs/core@1.20.4
  - @nudojs/service@1.12.6

更早版本（67）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
