---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.21.0 |
| `@nudojs/service` | 1.13.0 |
| `nudojs (CLI)` | 1.9.7 |
| `@nudojs/parser` | 1.5.15 |
| `@nudojs/lsp` | 1.10.7 |
| `@nudojs/env` | 0.5.15 |
| `@nudojs/harvester` | 0.6.7 |
| `vite-plugin-nudo` | 0.7.8 |
| `nudo-vscode` | 0.3.63 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.21.0 {#pkg-core}

## 1.21.0

### Minor Changes

- 0d32f39: Reorganize the dts pipeline and tighten analysis/diagnostic behavior across the stack.
  
  - `@nudojs/service`: dts emission now goes through a single typed `DtsType` IR. Legacy `absToTSType` / `absToTSTypeB` helpers are no longer exported from the emit surface; class, module, value, signature, JSDoc and assembly stages live in focused modules.
  - dts: annotation gates, class inheritance/generic members, validator return widening, `export =` / `import = require`, namespace objects, `unique symbol`, user symbols and unresolved-member ledgers are covered by the new pipeline. Added a `tsc --strict` compile matrix and an independent hand-written `DtsType` oracle.
  - `@nudojs/core`: iteration and predicate internals are split into capability, guard, element, spread/rest, for-of/for-in, template-object, user-iterator, nullish, typeguard, discriminant and switch modules behind stable facades.
  - tsconfig/module resolution: inherited `paths`/`baseUrl`, `extends` arrays, paths wildcard longest-prefix selection and NodeNext `.js`/`.mjs`/`.cjs` specifier rewrites are covered by regression tests; runtime load and annotation resolution share one rewrite table.
  - diagnostics: CLI and LSP share protocol codes, severity and source-range parity tests; scope-dependent diagnostic set differences remain intentional.
  - `@nudojs/env` / `@nudojs/lsp`: host Node built-in resolution and path argument verdict order fixes are included.

### Patch Changes

- bd5a0a7: Annotation mapping, entry census and declared returns each have one decision point; dts and validator faces agree.
  
  - `@nudojs/core`: source-AST type annotations are mapped by the `TSType` node fold. The fold is exhaustive over Babel's `TSType` kinds (a new kind is a compile error; unsupported kinds return `undefined` instead of falling back to the text grammar). Mapped types (enumerable and wide key domains), `keyof` / indexed access / labeled-optional-rest tuples / type predicates / dotted `typeof` paths / inline `import("spec").T` / interface `extends` / utility types (`Partial` `Required` `Readonly` `Pick` `Omit`) map structurally. Imported declarations carry their nodes across files, so a construct maps identically within and across modules, and parameterised builtins (`Array<T>` `ReadonlyArray<T>` `Map<K,V>` `Set<T>` `WeakMap` `WeakSet` `Promise<T>` `Record<K,V>` …) keep their arguments.
  - `@nudojs/core`: one annotation-environment assembly point (`sameFileAnnotationEnv`) and one imported-type scanner (`importedTypesForSource`: text and node tables). A text-vs-node parity ratchet pins every construct (a new divergence fails; the baseline only holds "node more precise" entries).
  - `@nudojs/core`: fixes `nudo check` crashing with `Converting circular structure to JSON` on annotations such as `Map<string, Set<string>>` or recursive types with `Map` values.
  - `@nudojs/service`: `annotationEnvForFile` is the only file-level annotation environment (same-file declarations, relative imports, inline imports); edits to imported files invalidate it by stat signature instead of serving a stale table.
  - `@nudojs/service` / `nudojs`: a declared return annotation is the published contract. The dts signature publishes it whenever its type names resolve in the product module (the `tsc --declaration` answer), and the guard / standard / zod return faces validate the same domain. Unresolvable names fall back to the observed type with a `nudo:dropped-type-annotation` ledger line; declaration-vs-observation conflicts keep a `nudo:return-annotation-mismatch` note without changing the published type. The former shape whitelist and the covariant observed/declared choice are gone.
  - `@nudojs/core` / `@nudojs/service` / `nudojs` / `@nudojs/lsp`: the entry census is a single fact on `SemanticIndex` (names plus node-bearing entry infos). `nudo check` no longer scans a second legacy census, the service analyzer reads the same index, and LSP import binding / export definition read it too.
  - other carried fixes: `FormalParam.tsTypeNode` / `FunctionAnalysis.declaredReturnAbs` carry declaration evidence; class field declarations seed `$declDomain`; function expressions carry `paramTypes` / `returnType`; `$copy` transports `Abs.facets` for every shape; class surfaces keep `#private;` and `abstract` accessors; module dts projection appends `export {};` when it has no other module marker; overload export glue keeps alias/default extras; ambient `declare function` + `export =` emits the glue line; same-name namespace blocks merge members (including ambient implicit exports); non-exported enums referenced by public signatures are emitted module-locally; bigint literal terms render as `10n`.

更早版本（66）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.13.0 {#pkg-service}

## 1.13.0

### Minor Changes

- 0d32f39: Reorganize the dts pipeline and tighten analysis/diagnostic behavior across the stack.
  
  - `@nudojs/service`: dts emission now goes through a single typed `DtsType` IR. Legacy `absToTSType` / `absToTSTypeB` helpers are no longer exported from the emit surface; class, module, value, signature, JSDoc and assembly stages live in focused modules.
  - dts: annotation gates, class inheritance/generic members, validator return widening, `export =` / `import = require`, namespace objects, `unique symbol`, user symbols and unresolved-member ledgers are covered by the new pipeline. Added a `tsc --strict` compile matrix and an independent hand-written `DtsType` oracle.
  - `@nudojs/core`: iteration and predicate internals are split into capability, guard, element, spread/rest, for-of/for-in, template-object, user-iterator, nullish, typeguard, discriminant and switch modules behind stable facades.
  - tsconfig/module resolution: inherited `paths`/`baseUrl`, `extends` arrays, paths wildcard longest-prefix selection and NodeNext `.js`/`.mjs`/`.cjs` specifier rewrites are covered by regression tests; runtime load and annotation resolution share one rewrite table.
  - diagnostics: CLI and LSP share protocol codes, severity and source-range parity tests; scope-dependent diagnostic set differences remain intentional.
  - `@nudojs/env` / `@nudojs/lsp`: host Node built-in resolution and path argument verdict order fixes are included.
- bd5a0a7: Annotation mapping, entry census and declared returns each have one decision point; dts and validator faces agree.
  
  - `@nudojs/core`: source-AST type annotations are mapped by the `TSType` node fold. The fold is exhaustive over Babel's `TSType` kinds (a new kind is a compile error; unsupported kinds return `undefined` instead of falling back to the text grammar). Mapped types (enumerable and wide key domains), `keyof` / indexed access / labeled-optional-rest tuples / type predicates / dotted `typeof` paths / inline `import("spec").T` / interface `extends` / utility types (`Partial` `Required` `Readonly` `Pick` `Omit`) map structurally. Imported declarations carry their nodes across files, so a construct maps identically within and across modules, and parameterised builtins (`Array<T>` `ReadonlyArray<T>` `Map<K,V>` `Set<T>` `WeakMap` `WeakSet` `Promise<T>` `Record<K,V>` …) keep their arguments.
  - `@nudojs/core`: one annotation-environment assembly point (`sameFileAnnotationEnv`) and one imported-type scanner (`importedTypesForSource`: text and node tables). A text-vs-node parity ratchet pins every construct (a new divergence fails; the baseline only holds "node more precise" entries).
  - `@nudojs/core`: fixes `nudo check` crashing with `Converting circular structure to JSON` on annotations such as `Map<string, Set<string>>` or recursive types with `Map` values.
  - `@nudojs/service`: `annotationEnvForFile` is the only file-level annotation environment (same-file declarations, relative imports, inline imports); edits to imported files invalidate it by stat signature instead of serving a stale table.
  - `@nudojs/service` / `nudojs`: a declared return annotation is the published contract. The dts signature publishes it whenever its type names resolve in the product module (the `tsc --declaration` answer), and the guard / standard / zod return faces validate the same domain. Unresolvable names fall back to the observed type with a `nudo:dropped-type-annotation` ledger line; declaration-vs-observation conflicts keep a `nudo:return-annotation-mismatch` note without changing the published type. The former shape whitelist and the covariant observed/declared choice are gone.
  - `@nudojs/core` / `@nudojs/service` / `nudojs` / `@nudojs/lsp`: the entry census is a single fact on `SemanticIndex` (names plus node-bearing entry infos). `nudo check` no longer scans a second legacy census, the service analyzer reads the same index, and LSP import binding / export definition read it too.
  - other carried fixes: `FormalParam.tsTypeNode` / `FunctionAnalysis.declaredReturnAbs` carry declaration evidence; class field declarations seed `$declDomain`; function expressions carry `paramTypes` / `returnType`; `$copy` transports `Abs.facets` for every shape; class surfaces keep `#private;` and `abstract` accessors; module dts projection appends `export {};` when it has no other module marker; overload export glue keeps alias/default extras; ambient `declare function` + `export =` emits the glue line; same-name namespace blocks merge members (including ambient implicit exports); non-exported enums referenced by public signatures are emitted module-locally; bigint literal terms render as `10n`.

### Patch Changes

- Updated dependencies [0d32f39]
- Updated dependencies [bd5a0a7]
  - @nudojs/core@1.21.0
  - @nudojs/env@0.5.15
  - @nudojs/harvester@0.6.7
  - @nudojs/parser@1.5.15

更早版本（68）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.9.7 {#pkg-nudojs}

## 1.9.7

### Patch Changes

- bd5a0a7: Annotation mapping, entry census and declared returns each have one decision point; dts and validator faces agree.
  
  - `@nudojs/core`: source-AST type annotations are mapped by the `TSType` node fold. The fold is exhaustive over Babel's `TSType` kinds (a new kind is a compile error; unsupported kinds return `undefined` instead of falling back to the text grammar). Mapped types (enumerable and wide key domains), `keyof` / indexed access / labeled-optional-rest tuples / type predicates / dotted `typeof` paths / inline `import("spec").T` / interface `extends` / utility types (`Partial` `Required` `Readonly` `Pick` `Omit`) map structurally. Imported declarations carry their nodes across files, so a construct maps identically within and across modules, and parameterised builtins (`Array<T>` `ReadonlyArray<T>` `Map<K,V>` `Set<T>` `WeakMap` `WeakSet` `Promise<T>` `Record<K,V>` …) keep their arguments.
  - `@nudojs/core`: one annotation-environment assembly point (`sameFileAnnotationEnv`) and one imported-type scanner (`importedTypesForSource`: text and node tables). A text-vs-node parity ratchet pins every construct (a new divergence fails; the baseline only holds "node more precise" entries).
  - `@nudojs/core`: fixes `nudo check` crashing with `Converting circular structure to JSON` on annotations such as `Map<string, Set<string>>` or recursive types with `Map` values.
  - `@nudojs/service`: `annotationEnvForFile` is the only file-level annotation environment (same-file declarations, relative imports, inline imports); edits to imported files invalidate it by stat signature instead of serving a stale table.
  - `@nudojs/service` / `nudojs`: a declared return annotation is the published contract. The dts signature publishes it whenever its type names resolve in the product module (the `tsc --declaration` answer), and the guard / standard / zod return faces validate the same domain. Unresolvable names fall back to the observed type with a `nudo:dropped-type-annotation` ledger line; declaration-vs-observation conflicts keep a `nudo:return-annotation-mismatch` note without changing the published type. The former shape whitelist and the covariant observed/declared choice are gone.
  - `@nudojs/core` / `@nudojs/service` / `nudojs` / `@nudojs/lsp`: the entry census is a single fact on `SemanticIndex` (names plus node-bearing entry infos). `nudo check` no longer scans a second legacy census, the service analyzer reads the same index, and LSP import binding / export definition read it too.
  - other carried fixes: `FormalParam.tsTypeNode` / `FunctionAnalysis.declaredReturnAbs` carry declaration evidence; class field declarations seed `$declDomain`; function expressions carry `paramTypes` / `returnType`; `$copy` transports `Abs.facets` for every shape; class surfaces keep `#private;` and `abstract` accessors; module dts projection appends `export {};` when it has no other module marker; overload export glue keeps alias/default extras; ambient `declare function` + `export =` emits the glue line; same-name namespace blocks merge members (including ambient implicit exports); non-exported enums referenced by public signatures are emitted module-locally; bigint literal terms render as `10n`.
- Updated dependencies [0d32f39]
- Updated dependencies [bd5a0a7]
  - @nudojs/core@1.21.0
  - @nudojs/service@1.13.0
  - @nudojs/env@0.5.15
  - @nudojs/harvester@0.6.7
  - @nudojs/parser@1.5.15

更早版本（65）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.15 {#pkg-parser}

## 1.5.15

### Patch Changes

- Updated dependencies [0d32f39]
- Updated dependencies [bd5a0a7]
  - @nudojs/core@1.21.0

更早版本（65）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.10.7 {#pkg-lsp}

## 1.10.7

### Patch Changes

- 0d32f39: Reorganize the dts pipeline and tighten analysis/diagnostic behavior across the stack.
  
  - `@nudojs/service`: dts emission now goes through a single typed `DtsType` IR. Legacy `absToTSType` / `absToTSTypeB` helpers are no longer exported from the emit surface; class, module, value, signature, JSDoc and assembly stages live in focused modules.
  - dts: annotation gates, class inheritance/generic members, validator return widening, `export =` / `import = require`, namespace objects, `unique symbol`, user symbols and unresolved-member ledgers are covered by the new pipeline. Added a `tsc --strict` compile matrix and an independent hand-written `DtsType` oracle.
  - `@nudojs/core`: iteration and predicate internals are split into capability, guard, element, spread/rest, for-of/for-in, template-object, user-iterator, nullish, typeguard, discriminant and switch modules behind stable facades.
  - tsconfig/module resolution: inherited `paths`/`baseUrl`, `extends` arrays, paths wildcard longest-prefix selection and NodeNext `.js`/`.mjs`/`.cjs` specifier rewrites are covered by regression tests; runtime load and annotation resolution share one rewrite table.
  - diagnostics: CLI and LSP share protocol codes, severity and source-range parity tests; scope-dependent diagnostic set differences remain intentional.
  - `@nudojs/env` / `@nudojs/lsp`: host Node built-in resolution and path argument verdict order fixes are included.
- bd5a0a7: Annotation mapping, entry census and declared returns each have one decision point; dts and validator faces agree.
  
  - `@nudojs/core`: source-AST type annotations are mapped by the `TSType` node fold. The fold is exhaustive over Babel's `TSType` kinds (a new kind is a compile error; unsupported kinds return `undefined` instead of falling back to the text grammar). Mapped types (enumerable and wide key domains), `keyof` / indexed access / labeled-optional-rest tuples / type predicates / dotted `typeof` paths / inline `import("spec").T` / interface `extends` / utility types (`Partial` `Required` `Readonly` `Pick` `Omit`) map structurally. Imported declarations carry their nodes across files, so a construct maps identically within and across modules, and parameterised builtins (`Array<T>` `ReadonlyArray<T>` `Map<K,V>` `Set<T>` `WeakMap` `WeakSet` `Promise<T>` `Record<K,V>` …) keep their arguments.
  - `@nudojs/core`: one annotation-environment assembly point (`sameFileAnnotationEnv`) and one imported-type scanner (`importedTypesForSource`: text and node tables). A text-vs-node parity ratchet pins every construct (a new divergence fails; the baseline only holds "node more precise" entries).
  - `@nudojs/core`: fixes `nudo check` crashing with `Converting circular structure to JSON` on annotations such as `Map<string, Set<string>>` or recursive types with `Map` values.
  - `@nudojs/service`: `annotationEnvForFile` is the only file-level annotation environment (same-file declarations, relative imports, inline imports); edits to imported files invalidate it by stat signature instead of serving a stale table.
  - `@nudojs/service` / `nudojs`: a declared return annotation is the published contract. The dts signature publishes it whenever its type names resolve in the product module (the `tsc --declaration` answer), and the guard / standard / zod return faces validate the same domain. Unresolvable names fall back to the observed type with a `nudo:dropped-type-annotation` ledger line; declaration-vs-observation conflicts keep a `nudo:return-annotation-mismatch` note without changing the published type. The former shape whitelist and the covariant observed/declared choice are gone.
  - `@nudojs/core` / `@nudojs/service` / `nudojs` / `@nudojs/lsp`: the entry census is a single fact on `SemanticIndex` (names plus node-bearing entry infos). `nudo check` no longer scans a second legacy census, the service analyzer reads the same index, and LSP import binding / export definition read it too.
  - other carried fixes: `FormalParam.tsTypeNode` / `FunctionAnalysis.declaredReturnAbs` carry declaration evidence; class field declarations seed `$declDomain`; function expressions carry `paramTypes` / `returnType`; `$copy` transports `Abs.facets` for every shape; class surfaces keep `#private;` and `abstract` accessors; module dts projection appends `export {};` when it has no other module marker; overload export glue keeps alias/default extras; ambient `declare function` + `export =` emits the glue line; same-name namespace blocks merge members (including ambient implicit exports); non-exported enums referenced by public signatures are emitted module-locally; bigint literal terms render as `10n`.
- Updated dependencies [0d32f39]
- Updated dependencies [bd5a0a7]
  - @nudojs/core@1.21.0
  - @nudojs/service@1.13.0
  - @nudojs/parser@1.5.15

更早版本（69）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.15 {#pkg-env}

## 0.5.15

### Patch Changes

- 0d32f39: Reorganize the dts pipeline and tighten analysis/diagnostic behavior across the stack.
  
  - `@nudojs/service`: dts emission now goes through a single typed `DtsType` IR. Legacy `absToTSType` / `absToTSTypeB` helpers are no longer exported from the emit surface; class, module, value, signature, JSDoc and assembly stages live in focused modules.
  - dts: annotation gates, class inheritance/generic members, validator return widening, `export =` / `import = require`, namespace objects, `unique symbol`, user symbols and unresolved-member ledgers are covered by the new pipeline. Added a `tsc --strict` compile matrix and an independent hand-written `DtsType` oracle.
  - `@nudojs/core`: iteration and predicate internals are split into capability, guard, element, spread/rest, for-of/for-in, template-object, user-iterator, nullish, typeguard, discriminant and switch modules behind stable facades.
  - tsconfig/module resolution: inherited `paths`/`baseUrl`, `extends` arrays, paths wildcard longest-prefix selection and NodeNext `.js`/`.mjs`/`.cjs` specifier rewrites are covered by regression tests; runtime load and annotation resolution share one rewrite table.
  - diagnostics: CLI and LSP share protocol codes, severity and source-range parity tests; scope-dependent diagnostic set differences remain intentional.
  - `@nudojs/env` / `@nudojs/lsp`: host Node built-in resolution and path argument verdict order fixes are included.
- Updated dependencies [0d32f39]
- Updated dependencies [bd5a0a7]
  - @nudojs/core@1.21.0

更早版本（65）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.6.7 {#pkg-harvester}

## 0.6.7

### Patch Changes

- Updated dependencies [0d32f39]
- Updated dependencies [bd5a0a7]
  - @nudojs/core@1.21.0
  - @nudojs/env@0.5.15
  - @nudojs/parser@1.5.15

更早版本（65）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.7.8 {#pkg-vite-plugin}

## 0.7.8

### Patch Changes

- Updated dependencies [0d32f39]
- Updated dependencies [bd5a0a7]
  - @nudojs/core@1.21.0
  - @nudojs/service@1.13.0

更早版本（68）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
