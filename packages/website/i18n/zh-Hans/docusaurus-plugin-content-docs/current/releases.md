---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.20.3 |
| `@nudojs/service` | 1.12.5 |
| `nudojs (CLI)` | 1.9.5 |
| `@nudojs/parser` | 1.5.13 |
| `@nudojs/lsp` | 1.10.5 |
| `@nudojs/env` | 0.5.13 |
| `@nudojs/harvester` | 0.6.5 |
| `vite-plugin-nudo` | 0.7.6 |
| `nudo-vscode` | 0.3.61 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.20.3 {#pkg-core}

## 1.20.3

### Patch Changes

- b888b76: Close the BUG-174..238 audit batch: one judgment per fact across the evaluator, projection faces, migration tools, and reporting surfaces.
  
  **Evaluation and domains** — rest tuples keep their fixed prefix instead of collapsing to a single array element type; TS `null` / `undefined` / `void` annotations map to terms instead of degrading the whole annotation to `any`; optional parameters (`x?: T`) enter the entry domain with `undefined`; arrow parameters inherit contextual function types; `Object.prototype.toString` covers union / any / unknown receivers; computed array keys consult `Array.prototype`; `Object.assign` propagates the open-key-set marker; Proxy `ownKeys` honours trap-only and non-enumerable keys; `Map` / `Set` `forEach` forwards `thisArg`; `URLSearchParams.forEach` runs its callback; reflector symbol keys stay symbols; sparse-array descriptors skip holes and honour `enumerable`; typed arrays expose `@@iterator`.
  
  **Classes and effects** — `X.prototype` identity is keyed by class binding, so same-named classes in different scopes/modules no longer share prototype writes; `class X extends Array` keeps the subclass instance face; generator `.throw()` into a `try/catch` records may-throw only when the transpile-time catch facts allow a rethrow (`YIELD_CATCH_THROWS`); `JSON.parse(<abstract text>)` records `SyntaxError`; union receivers record the nullish arm only for declared entry domains, keeping guard-derived slot reads quiet.
  
  **Dts / export** — overload sets are emitted without implementation signatures (free functions) and with full overload sets (methods); inline-object method names, same-module enum type refs, and string/template literal types survive resolvability checks; default parameter values are type evidence; contract `any()` slots no longer mint generic parameters; namespace constants and annotated `const f: T = …` keep their declared types; inherited members substitute base type arguments and preserve `private` / `protected`; constructor overloads and parameter-property optionality, symbol members, and type-only export aliases are emitted; observed return values / guard-zod domains are widened to base types (including a single call-site sample), while asserted `@nudo:case` literals stay exact.
  
  **Migrate / strip** — folded YAML scalars preserve more-indented command lines; `migrate verify --with-tsc` rejects files outside the tsconfig project instead of reporting `ok`; strip keeps imports referenced from destructuring defaults, elides proven type-only re-exports, and surfaces package-specifier retain notes.
  
  **Reporting / tooling** — the per-function analysis cache no longer replays pre-synthesis snapshots or stale diagnostics across case modes; `health` prints the drift line alongside file errors and no longer labels a rewrite as `+1 new`; directive witnesses render as `debug "call@…"` instead of masquerading as call sites; `contract --from-dts --write` writes alias-shaped drafts; `contract --emit --json --dry-run` carries `dryRun: true` with an empty `written` list; `.d.mts` / `.d.cts` resolve `.mjs` / `.cjs` runtime siblings; vite `include` literals use the same path-shaped matcher as the service watcher.
  
  Compatibility notes: `@nudojs/core/internal` gains `absTypeForTsTypeText`; `@nudojs/service/emit` gains the observation-widening helpers used by guard/zod/standard. Observed return types in generated `.d.ts` and runtime validators are now wider by design (a call-site sample is not a function domain); asserted cases keep exact literals. These are additive or stricter-correctness changes, not API removals.

更早版本（64）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.12.5 {#pkg-service}

## 1.12.5

### Patch Changes

- b888b76: Close the BUG-174..238 audit batch: one judgment per fact across the evaluator, projection faces, migration tools, and reporting surfaces.
  
  **Evaluation and domains** — rest tuples keep their fixed prefix instead of collapsing to a single array element type; TS `null` / `undefined` / `void` annotations map to terms instead of degrading the whole annotation to `any`; optional parameters (`x?: T`) enter the entry domain with `undefined`; arrow parameters inherit contextual function types; `Object.prototype.toString` covers union / any / unknown receivers; computed array keys consult `Array.prototype`; `Object.assign` propagates the open-key-set marker; Proxy `ownKeys` honours trap-only and non-enumerable keys; `Map` / `Set` `forEach` forwards `thisArg`; `URLSearchParams.forEach` runs its callback; reflector symbol keys stay symbols; sparse-array descriptors skip holes and honour `enumerable`; typed arrays expose `@@iterator`.
  
  **Classes and effects** — `X.prototype` identity is keyed by class binding, so same-named classes in different scopes/modules no longer share prototype writes; `class X extends Array` keeps the subclass instance face; generator `.throw()` into a `try/catch` records may-throw only when the transpile-time catch facts allow a rethrow (`YIELD_CATCH_THROWS`); `JSON.parse(<abstract text>)` records `SyntaxError`; union receivers record the nullish arm only for declared entry domains, keeping guard-derived slot reads quiet.
  
  **Dts / export** — overload sets are emitted without implementation signatures (free functions) and with full overload sets (methods); inline-object method names, same-module enum type refs, and string/template literal types survive resolvability checks; default parameter values are type evidence; contract `any()` slots no longer mint generic parameters; namespace constants and annotated `const f: T = …` keep their declared types; inherited members substitute base type arguments and preserve `private` / `protected`; constructor overloads and parameter-property optionality, symbol members, and type-only export aliases are emitted; observed return values / guard-zod domains are widened to base types (including a single call-site sample), while asserted `@nudo:case` literals stay exact.
  
  **Migrate / strip** — folded YAML scalars preserve more-indented command lines; `migrate verify --with-tsc` rejects files outside the tsconfig project instead of reporting `ok`; strip keeps imports referenced from destructuring defaults, elides proven type-only re-exports, and surfaces package-specifier retain notes.
  
  **Reporting / tooling** — the per-function analysis cache no longer replays pre-synthesis snapshots or stale diagnostics across case modes; `health` prints the drift line alongside file errors and no longer labels a rewrite as `+1 new`; directive witnesses render as `debug "call@…"` instead of masquerading as call sites; `contract --from-dts --write` writes alias-shaped drafts; `contract --emit --json --dry-run` carries `dryRun: true` with an empty `written` list; `.d.mts` / `.d.cts` resolve `.mjs` / `.cjs` runtime siblings; vite `include` literals use the same path-shaped matcher as the service watcher.
  
  Compatibility notes: `@nudojs/core/internal` gains `absTypeForTsTypeText`; `@nudojs/service/emit` gains the observation-widening helpers used by guard/zod/standard. Observed return types in generated `.d.ts` and runtime validators are now wider by design (a call-site sample is not a function domain); asserted cases keep exact literals. These are additive or stricter-correctness changes, not API removals.
- Updated dependencies [b888b76]
  - @nudojs/core@1.20.3
  - @nudojs/harvester@0.6.5
  - @nudojs/env@0.5.13
  - @nudojs/parser@1.5.13

更早版本（66）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.9.5 {#pkg-nudojs}

## 1.9.5

### Patch Changes

- b888b76: Close the BUG-174..238 audit batch: one judgment per fact across the evaluator, projection faces, migration tools, and reporting surfaces.
  
  **Evaluation and domains** — rest tuples keep their fixed prefix instead of collapsing to a single array element type; TS `null` / `undefined` / `void` annotations map to terms instead of degrading the whole annotation to `any`; optional parameters (`x?: T`) enter the entry domain with `undefined`; arrow parameters inherit contextual function types; `Object.prototype.toString` covers union / any / unknown receivers; computed array keys consult `Array.prototype`; `Object.assign` propagates the open-key-set marker; Proxy `ownKeys` honours trap-only and non-enumerable keys; `Map` / `Set` `forEach` forwards `thisArg`; `URLSearchParams.forEach` runs its callback; reflector symbol keys stay symbols; sparse-array descriptors skip holes and honour `enumerable`; typed arrays expose `@@iterator`.
  
  **Classes and effects** — `X.prototype` identity is keyed by class binding, so same-named classes in different scopes/modules no longer share prototype writes; `class X extends Array` keeps the subclass instance face; generator `.throw()` into a `try/catch` records may-throw only when the transpile-time catch facts allow a rethrow (`YIELD_CATCH_THROWS`); `JSON.parse(<abstract text>)` records `SyntaxError`; union receivers record the nullish arm only for declared entry domains, keeping guard-derived slot reads quiet.
  
  **Dts / export** — overload sets are emitted without implementation signatures (free functions) and with full overload sets (methods); inline-object method names, same-module enum type refs, and string/template literal types survive resolvability checks; default parameter values are type evidence; contract `any()` slots no longer mint generic parameters; namespace constants and annotated `const f: T = …` keep their declared types; inherited members substitute base type arguments and preserve `private` / `protected`; constructor overloads and parameter-property optionality, symbol members, and type-only export aliases are emitted; observed return values / guard-zod domains are widened to base types (including a single call-site sample), while asserted `@nudo:case` literals stay exact.
  
  **Migrate / strip** — folded YAML scalars preserve more-indented command lines; `migrate verify --with-tsc` rejects files outside the tsconfig project instead of reporting `ok`; strip keeps imports referenced from destructuring defaults, elides proven type-only re-exports, and surfaces package-specifier retain notes.
  
  **Reporting / tooling** — the per-function analysis cache no longer replays pre-synthesis snapshots or stale diagnostics across case modes; `health` prints the drift line alongside file errors and no longer labels a rewrite as `+1 new`; directive witnesses render as `debug "call@…"` instead of masquerading as call sites; `contract --from-dts --write` writes alias-shaped drafts; `contract --emit --json --dry-run` carries `dryRun: true` with an empty `written` list; `.d.mts` / `.d.cts` resolve `.mjs` / `.cjs` runtime siblings; vite `include` literals use the same path-shaped matcher as the service watcher.
  
  Compatibility notes: `@nudojs/core/internal` gains `absTypeForTsTypeText`; `@nudojs/service/emit` gains the observation-widening helpers used by guard/zod/standard. Observed return types in generated `.d.ts` and runtime validators are now wider by design (a call-site sample is not a function domain); asserted cases keep exact literals. These are additive or stricter-correctness changes, not API removals.
- Updated dependencies [b888b76]
  - @nudojs/core@1.20.3
  - @nudojs/service@1.12.5
  - @nudojs/harvester@0.6.5
  - @nudojs/env@0.5.13
  - @nudojs/parser@1.5.13

更早版本（63）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.13 {#pkg-parser}

## 1.5.13

### Patch Changes

- Updated dependencies [b888b76]
  - @nudojs/core@1.20.3

更早版本（63）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.10.5 {#pkg-lsp}

## 1.10.5

### Patch Changes

- Updated dependencies [b888b76]
  - @nudojs/core@1.20.3
  - @nudojs/service@1.12.5
  - @nudojs/parser@1.5.13

更早版本（67）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.13 {#pkg-env}

## 0.5.13

### Patch Changes

- Updated dependencies [b888b76]
  - @nudojs/core@1.20.3

更早版本（63）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.6.5 {#pkg-harvester}

## 0.6.5

### Patch Changes

- b888b76: Close the BUG-174..238 audit batch: one judgment per fact across the evaluator, projection faces, migration tools, and reporting surfaces.
  
  **Evaluation and domains** — rest tuples keep their fixed prefix instead of collapsing to a single array element type; TS `null` / `undefined` / `void` annotations map to terms instead of degrading the whole annotation to `any`; optional parameters (`x?: T`) enter the entry domain with `undefined`; arrow parameters inherit contextual function types; `Object.prototype.toString` covers union / any / unknown receivers; computed array keys consult `Array.prototype`; `Object.assign` propagates the open-key-set marker; Proxy `ownKeys` honours trap-only and non-enumerable keys; `Map` / `Set` `forEach` forwards `thisArg`; `URLSearchParams.forEach` runs its callback; reflector symbol keys stay symbols; sparse-array descriptors skip holes and honour `enumerable`; typed arrays expose `@@iterator`.
  
  **Classes and effects** — `X.prototype` identity is keyed by class binding, so same-named classes in different scopes/modules no longer share prototype writes; `class X extends Array` keeps the subclass instance face; generator `.throw()` into a `try/catch` records may-throw only when the transpile-time catch facts allow a rethrow (`YIELD_CATCH_THROWS`); `JSON.parse(<abstract text>)` records `SyntaxError`; union receivers record the nullish arm only for declared entry domains, keeping guard-derived slot reads quiet.
  
  **Dts / export** — overload sets are emitted without implementation signatures (free functions) and with full overload sets (methods); inline-object method names, same-module enum type refs, and string/template literal types survive resolvability checks; default parameter values are type evidence; contract `any()` slots no longer mint generic parameters; namespace constants and annotated `const f: T = …` keep their declared types; inherited members substitute base type arguments and preserve `private` / `protected`; constructor overloads and parameter-property optionality, symbol members, and type-only export aliases are emitted; observed return values / guard-zod domains are widened to base types (including a single call-site sample), while asserted `@nudo:case` literals stay exact.
  
  **Migrate / strip** — folded YAML scalars preserve more-indented command lines; `migrate verify --with-tsc` rejects files outside the tsconfig project instead of reporting `ok`; strip keeps imports referenced from destructuring defaults, elides proven type-only re-exports, and surfaces package-specifier retain notes.
  
  **Reporting / tooling** — the per-function analysis cache no longer replays pre-synthesis snapshots or stale diagnostics across case modes; `health` prints the drift line alongside file errors and no longer labels a rewrite as `+1 new`; directive witnesses render as `debug "call@…"` instead of masquerading as call sites; `contract --from-dts --write` writes alias-shaped drafts; `contract --emit --json --dry-run` carries `dryRun: true` with an empty `written` list; `.d.mts` / `.d.cts` resolve `.mjs` / `.cjs` runtime siblings; vite `include` literals use the same path-shaped matcher as the service watcher.
  
  Compatibility notes: `@nudojs/core/internal` gains `absTypeForTsTypeText`; `@nudojs/service/emit` gains the observation-widening helpers used by guard/zod/standard. Observed return types in generated `.d.ts` and runtime validators are now wider by design (a call-site sample is not a function domain); asserted cases keep exact literals. These are additive or stricter-correctness changes, not API removals.
- Updated dependencies [b888b76]
  - @nudojs/core@1.20.3
  - @nudojs/env@0.5.13
  - @nudojs/parser@1.5.13

更早版本（63）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.7.6 {#pkg-vite-plugin}

## 0.7.6

### Patch Changes

- b888b76: Close the BUG-174..238 audit batch: one judgment per fact across the evaluator, projection faces, migration tools, and reporting surfaces.
  
  **Evaluation and domains** — rest tuples keep their fixed prefix instead of collapsing to a single array element type; TS `null` / `undefined` / `void` annotations map to terms instead of degrading the whole annotation to `any`; optional parameters (`x?: T`) enter the entry domain with `undefined`; arrow parameters inherit contextual function types; `Object.prototype.toString` covers union / any / unknown receivers; computed array keys consult `Array.prototype`; `Object.assign` propagates the open-key-set marker; Proxy `ownKeys` honours trap-only and non-enumerable keys; `Map` / `Set` `forEach` forwards `thisArg`; `URLSearchParams.forEach` runs its callback; reflector symbol keys stay symbols; sparse-array descriptors skip holes and honour `enumerable`; typed arrays expose `@@iterator`.
  
  **Classes and effects** — `X.prototype` identity is keyed by class binding, so same-named classes in different scopes/modules no longer share prototype writes; `class X extends Array` keeps the subclass instance face; generator `.throw()` into a `try/catch` records may-throw only when the transpile-time catch facts allow a rethrow (`YIELD_CATCH_THROWS`); `JSON.parse(<abstract text>)` records `SyntaxError`; union receivers record the nullish arm only for declared entry domains, keeping guard-derived slot reads quiet.
  
  **Dts / export** — overload sets are emitted without implementation signatures (free functions) and with full overload sets (methods); inline-object method names, same-module enum type refs, and string/template literal types survive resolvability checks; default parameter values are type evidence; contract `any()` slots no longer mint generic parameters; namespace constants and annotated `const f: T = …` keep their declared types; inherited members substitute base type arguments and preserve `private` / `protected`; constructor overloads and parameter-property optionality, symbol members, and type-only export aliases are emitted; observed return values / guard-zod domains are widened to base types (including a single call-site sample), while asserted `@nudo:case` literals stay exact.
  
  **Migrate / strip** — folded YAML scalars preserve more-indented command lines; `migrate verify --with-tsc` rejects files outside the tsconfig project instead of reporting `ok`; strip keeps imports referenced from destructuring defaults, elides proven type-only re-exports, and surfaces package-specifier retain notes.
  
  **Reporting / tooling** — the per-function analysis cache no longer replays pre-synthesis snapshots or stale diagnostics across case modes; `health` prints the drift line alongside file errors and no longer labels a rewrite as `+1 new`; directive witnesses render as `debug "call@…"` instead of masquerading as call sites; `contract --from-dts --write` writes alias-shaped drafts; `contract --emit --json --dry-run` carries `dryRun: true` with an empty `written` list; `.d.mts` / `.d.cts` resolve `.mjs` / `.cjs` runtime siblings; vite `include` literals use the same path-shaped matcher as the service watcher.
  
  Compatibility notes: `@nudojs/core/internal` gains `absTypeForTsTypeText`; `@nudojs/service/emit` gains the observation-widening helpers used by guard/zod/standard. Observed return types in generated `.d.ts` and runtime validators are now wider by design (a call-site sample is not a function domain); asserted cases keep exact literals. These are additive or stricter-correctness changes, not API removals.
- Updated dependencies [b888b76]
  - @nudojs/core@1.20.3
  - @nudojs/service@1.12.5

更早版本（66）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
