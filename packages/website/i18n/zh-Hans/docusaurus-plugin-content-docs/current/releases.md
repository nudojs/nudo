---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.17.0 |
| `@nudojs/service` | 1.10.1 |
| `nudojs (CLI)` | 1.7.1 |
| `@nudojs/parser` | 1.5.4 |
| `@nudojs/lsp` | 1.8.1 |
| `@nudojs/env` | 0.5.4 |
| `@nudojs/harvester` | 0.4.4 |
| `vite-plugin-nudo` | 0.6.1 |
| `nudo-vscode` | 0.3.52 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.17.0 {#pkg-core}

## 1.17.0

### Minor Changes

- 6ebf5a4: Evaluator engine correctness, host transpile cutover, and dedupe.
  
  - Fix `Object.assign` second-class calls (`const g = Object.assign; g(target, src)`, `.call`/`.apply`) so obj/tuple targets are mutated in place with native alias visibility; direct and builtin paths now share one `performObjectAssign` core. Frozen targets only reject a real `[[Set]]` (empty/null/undefined sources no longer report a false TypeError; unknown key sets become may-throw), and sealed targets dispatch own accessors through `$set` (setters still run; getter-only still rejects).
  - Fix function-value join/dedupe: branch-dependent expando slots, nested function values, anonymous/named same-shape functions, `optionalParams`/`ctor`/`paramTypes`/`returnType` differences no longer fold to a wrong exact value. `$copy` snapshots fn shapes independently and migrates impl/slot ownership, null-proto, and fresh-instance identity. Alias groups are scoped lexically, so fork snapshots (`$copy`) no longer break `const b = a` alias identity across nested functions or shadowed blocks.
  - Make `renameShape`/`snapshotAbs` structure-preserving: tuple `holes`/`rest`, fn `slots`/`optionalParams`/`ctor`, obj slot `symbolKey`/`internal`/`inherited`, brand/eff metadata.
  - Fix compiled-body lexical scope and strictness: block-scoped `let`/`const`/`for`/`catch`/class/static-block bindings no longer hide enclosing closures; `strict` is threaded from ESM/CJS source through core/service/parser Abs-fn constructors, and class bodies are always strict. An explicit `"use strict"` directive prologue now marks a CJS script source strict, and CJS class-method bodies compile as strict too.
  - Replace the transpile→ESM-text→regex-rewrite round-trip with `transpileModule()` metadata + host-target emission (`__nudoBindImport`/`__nudoExport*`, no runtime import line, no generated-code re-parse). Analyze-mode top-level stripping now happens during emission. Namespace-only `import * as ns` now emits valid ESM.
  - Fix `$set` fail-closed on nullish/non-Abs receivers: the host-write handler now reports hits explicitly instead of using `undefined` as a sentinel, so a write to a non-Abs receiver returns that receiver instead of crashing on `.shape`.
  - Fix `$switch` implicit no-match arm: it no longer contributes an empty yield collector, so single-arm switches keep precise generator element types instead of degrading to `unknown`. The switch-level snapshot/join set is pinned to outer bindings only: arm-local `let`/`const`/`function`/`class` (including nested blocks, `for` heads and `catch` params) never enter it, so an arm-local name can no longer copy/rebind a same-named outer binding and break its alias identity.
  - Fix free-write collection for nested functions: hoisted `var` / function-declaration names of a nested function body now shadow writes inside that body instead of being recorded as free writes of the enclosing unit (previously emitted `$copy(<name>)` for a binding that does not exist there, yielding a false `ReferenceError`/`never` and an error-level `nudo:entry-may-throw`). Block-scoped declaration shadowing is now per statement list rather than a recursive union, so a nested-block `let` no longer drops a legitimate sibling write from the fork set.
  - Module top level is now an alias-group scope boundary: `const b = a` at module scope keeps its alias identity across a top-level fork instead of leaving one name on the pre-fork object.
  - `Object.assign` onto a sealed / non-extensible brand (prototype) target now rejects a new own key with TypeError (native parity) while existing writable keys, own setters and owner-class members still assign.
  - Dedupe shared machinery: fork-arm wrapper, structural Abs keys, dependency-aware memo store + module identities, class-instance bridge, numeric bounds, internal-slot visibility, env-skip derivation from `NAMESPACE_GLOBALS`, proto walk, path projection, sum-arg dispatch, `undefAbs`, RegExp brand predicate, export-call exception skeleton.
  - **BREAKING**: Remove the dead public engine symbols instead of deprecating them: the module-level `phi` stack (`currentPhi`/`pushPhi`/`popPhi`/`resetPhi`/`withPhiConstraint`/`describePhi`), `$while`/`$forIter`/`$asyncReturn`/`$staticInit`/`$thisGet`/`$thisSet`, the HOF promotion helpers (`createHofCollectCtx`/`promoteParamShape`/`tryPromote*`/`HofCollectCtx`/`AstEnv.hofCollect`), the dead relation helpers `alphaOf`/`betaOf`, and `generalizeAll`. `$staticInvoke` also leaves the public surface (previously exported from `.` and `./exec`): it is now engine-internal, still implemented for the `check-may-throw` class bridge. Retire dead internal `language.ts` exports (keep `getClassChain`/`wrapPromise`).
  
    Migration: every removed name was a dead engine internal with no product-surface consumer — drop the imports from `@nudojs/core` / `@nudojs/core/exec`; `$staticInvoke` is no longer reachable from a host.
  - Rename `exec/class-regex.ts` to `exec/regexp-runtime.ts` to match its RegExp-brand role.

### Patch Changes

- 0438f10: Fix evaluator correctness and remove duplicated machinery:
  
  - Respect user bindings named `undefined` / `NaN` / `Infinity` (module bindings, parameters) instead of unconditionally folding them; keep exact literal folding for unshadowed reads, suppress undefined-literal narrowing facts when the name is bound, and honor the same bindings in callee position (`NaN(1)`) and at the expression entry (declarations inside the expression itself).
  - Separate private top-level functions from the module export surface: `export *` precedence is restored, private named imports now report `nudo:missing-export`, `transpileSource` no longer emits `export` for private functions, and analysis keeps a non-enumerable local-function table (so same-name re-exports/CJS exports do not shadow analyzed locals).
  - Make the generated runtime import list a single source of truth (it is now self-consistent with `@nudojs/core/exec`), dedupe `RUNTIME_IMPORT_RE`, and share the `new Function` compile scaffold.
  - Dedupe the A/B call budgets and the two `@nudo:pure` memo caches behind shared factories; either public clear API now invalidates both.
  - Single-pass, memoized function facet analysis; dedupe Error/mutator/class-chain/nullish tables; remove dead service evaluator modules.
  - Split the evaluator's largest dispatch functions (`$invokeInner`, `$get`/`$set`, `invokeArrMethod`, `transpileStatement`) and move narrowing ops out of `runtime/async.ts`.

更早版本（55）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.10.1 {#pkg-service}

## 1.10.1

### Patch Changes

- 0438f10: Fix evaluator correctness and remove duplicated machinery:
  
  - Respect user bindings named `undefined` / `NaN` / `Infinity` (module bindings, parameters) instead of unconditionally folding them; keep exact literal folding for unshadowed reads, suppress undefined-literal narrowing facts when the name is bound, and honor the same bindings in callee position (`NaN(1)`) and at the expression entry (declarations inside the expression itself).
  - Separate private top-level functions from the module export surface: `export *` precedence is restored, private named imports now report `nudo:missing-export`, `transpileSource` no longer emits `export` for private functions, and analysis keeps a non-enumerable local-function table (so same-name re-exports/CJS exports do not shadow analyzed locals).
  - Make the generated runtime import list a single source of truth (it is now self-consistent with `@nudojs/core/exec`), dedupe `RUNTIME_IMPORT_RE`, and share the `new Function` compile scaffold.
  - Dedupe the A/B call budgets and the two `@nudo:pure` memo caches behind shared factories; either public clear API now invalidates both.
  - Single-pass, memoized function facet analysis; dedupe Error/mutator/class-chain/nullish tables; remove dead service evaluator modules.
  - Split the evaluator's largest dispatch functions (`$invokeInner`, `$get`/`$set`, `invokeArrMethod`, `transpileStatement`) and move narrowing ops out of `runtime/async.ts`.
- 6ebf5a4: Evaluator engine correctness, host transpile cutover, and dedupe.
  
  - Fix `Object.assign` second-class calls (`const g = Object.assign; g(target, src)`, `.call`/`.apply`) so obj/tuple targets are mutated in place with native alias visibility; direct and builtin paths now share one `performObjectAssign` core. Frozen targets only reject a real `[[Set]]` (empty/null/undefined sources no longer report a false TypeError; unknown key sets become may-throw), and sealed targets dispatch own accessors through `$set` (setters still run; getter-only still rejects).
  - Fix function-value join/dedupe: branch-dependent expando slots, nested function values, anonymous/named same-shape functions, `optionalParams`/`ctor`/`paramTypes`/`returnType` differences no longer fold to a wrong exact value. `$copy` snapshots fn shapes independently and migrates impl/slot ownership, null-proto, and fresh-instance identity. Alias groups are scoped lexically, so fork snapshots (`$copy`) no longer break `const b = a` alias identity across nested functions or shadowed blocks.
  - Make `renameShape`/`snapshotAbs` structure-preserving: tuple `holes`/`rest`, fn `slots`/`optionalParams`/`ctor`, obj slot `symbolKey`/`internal`/`inherited`, brand/eff metadata.
  - Fix compiled-body lexical scope and strictness: block-scoped `let`/`const`/`for`/`catch`/class/static-block bindings no longer hide enclosing closures; `strict` is threaded from ESM/CJS source through core/service/parser Abs-fn constructors, and class bodies are always strict. An explicit `"use strict"` directive prologue now marks a CJS script source strict, and CJS class-method bodies compile as strict too.
  - Replace the transpile→ESM-text→regex-rewrite round-trip with `transpileModule()` metadata + host-target emission (`__nudoBindImport`/`__nudoExport*`, no runtime import line, no generated-code re-parse). Analyze-mode top-level stripping now happens during emission. Namespace-only `import * as ns` now emits valid ESM.
  - Fix `$set` fail-closed on nullish/non-Abs receivers: the host-write handler now reports hits explicitly instead of using `undefined` as a sentinel, so a write to a non-Abs receiver returns that receiver instead of crashing on `.shape`.
  - Fix `$switch` implicit no-match arm: it no longer contributes an empty yield collector, so single-arm switches keep precise generator element types instead of degrading to `unknown`. The switch-level snapshot/join set is pinned to outer bindings only: arm-local `let`/`const`/`function`/`class` (including nested blocks, `for` heads and `catch` params) never enter it, so an arm-local name can no longer copy/rebind a same-named outer binding and break its alias identity.
  - Fix free-write collection for nested functions: hoisted `var` / function-declaration names of a nested function body now shadow writes inside that body instead of being recorded as free writes of the enclosing unit (previously emitted `$copy(<name>)` for a binding that does not exist there, yielding a false `ReferenceError`/`never` and an error-level `nudo:entry-may-throw`). Block-scoped declaration shadowing is now per statement list rather than a recursive union, so a nested-block `let` no longer drops a legitimate sibling write from the fork set.
  - Module top level is now an alias-group scope boundary: `const b = a` at module scope keeps its alias identity across a top-level fork instead of leaving one name on the pre-fork object.
  - `Object.assign` onto a sealed / non-extensible brand (prototype) target now rejects a new own key with TypeError (native parity) while existing writable keys, own setters and owner-class members still assign.
  - Dedupe shared machinery: fork-arm wrapper, structural Abs keys, dependency-aware memo store + module identities, class-instance bridge, numeric bounds, internal-slot visibility, env-skip derivation from `NAMESPACE_GLOBALS`, proto walk, path projection, sum-arg dispatch, `undefAbs`, RegExp brand predicate, export-call exception skeleton.
  - **BREAKING**: Remove the dead public engine symbols instead of deprecating them: the module-level `phi` stack (`currentPhi`/`pushPhi`/`popPhi`/`resetPhi`/`withPhiConstraint`/`describePhi`), `$while`/`$forIter`/`$asyncReturn`/`$staticInit`/`$thisGet`/`$thisSet`, the HOF promotion helpers (`createHofCollectCtx`/`promoteParamShape`/`tryPromote*`/`HofCollectCtx`/`AstEnv.hofCollect`), the dead relation helpers `alphaOf`/`betaOf`, and `generalizeAll`. `$staticInvoke` also leaves the public surface (previously exported from `.` and `./exec`): it is now engine-internal, still implemented for the `check-may-throw` class bridge. Retire dead internal `language.ts` exports (keep `getClassChain`/`wrapPromise`).
  
    Migration: every removed name was a dead engine internal with no product-surface consumer — drop the imports from `@nudojs/core` / `@nudojs/core/exec`; `$staticInvoke` is no longer reachable from a host.
  - Rename `exec/class-regex.ts` to `exec/regexp-runtime.ts` to match its RegExp-brand role.
- Updated dependencies [f1d4958]
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/env@0.5.4
  - @nudojs/core@1.17.0
  - @nudojs/parser@1.5.4
  - @nudojs/harvester@0.4.4

更早版本（57）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.7.1 {#pkg-nudojs}

## 1.7.1

### Patch Changes

- 0438f10: Fix evaluator correctness and remove duplicated machinery:
  
  - Respect user bindings named `undefined` / `NaN` / `Infinity` (module bindings, parameters) instead of unconditionally folding them; keep exact literal folding for unshadowed reads, suppress undefined-literal narrowing facts when the name is bound, and honor the same bindings in callee position (`NaN(1)`) and at the expression entry (declarations inside the expression itself).
  - Separate private top-level functions from the module export surface: `export *` precedence is restored, private named imports now report `nudo:missing-export`, `transpileSource` no longer emits `export` for private functions, and analysis keeps a non-enumerable local-function table (so same-name re-exports/CJS exports do not shadow analyzed locals).
  - Make the generated runtime import list a single source of truth (it is now self-consistent with `@nudojs/core/exec`), dedupe `RUNTIME_IMPORT_RE`, and share the `new Function` compile scaffold.
  - Dedupe the A/B call budgets and the two `@nudo:pure` memo caches behind shared factories; either public clear API now invalidates both.
  - Single-pass, memoized function facet analysis; dedupe Error/mutator/class-chain/nullish tables; remove dead service evaluator modules.
  - Split the evaluator's largest dispatch functions (`$invokeInner`, `$get`/`$set`, `invokeArrMethod`, `transpileStatement`) and move narrowing ops out of `runtime/async.ts`.
- Updated dependencies [f1d4958]
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/env@0.5.4
  - @nudojs/core@1.17.0
  - @nudojs/service@1.10.1
  - @nudojs/parser@1.5.4
  - @nudojs/harvester@0.4.4

更早版本（54）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.4 {#pkg-parser}

## 1.5.4

### Patch Changes

- 6ebf5a4: Evaluator engine correctness, host transpile cutover, and dedupe.
  
  - Fix `Object.assign` second-class calls (`const g = Object.assign; g(target, src)`, `.call`/`.apply`) so obj/tuple targets are mutated in place with native alias visibility; direct and builtin paths now share one `performObjectAssign` core. Frozen targets only reject a real `[[Set]]` (empty/null/undefined sources no longer report a false TypeError; unknown key sets become may-throw), and sealed targets dispatch own accessors through `$set` (setters still run; getter-only still rejects).
  - Fix function-value join/dedupe: branch-dependent expando slots, nested function values, anonymous/named same-shape functions, `optionalParams`/`ctor`/`paramTypes`/`returnType` differences no longer fold to a wrong exact value. `$copy` snapshots fn shapes independently and migrates impl/slot ownership, null-proto, and fresh-instance identity. Alias groups are scoped lexically, so fork snapshots (`$copy`) no longer break `const b = a` alias identity across nested functions or shadowed blocks.
  - Make `renameShape`/`snapshotAbs` structure-preserving: tuple `holes`/`rest`, fn `slots`/`optionalParams`/`ctor`, obj slot `symbolKey`/`internal`/`inherited`, brand/eff metadata.
  - Fix compiled-body lexical scope and strictness: block-scoped `let`/`const`/`for`/`catch`/class/static-block bindings no longer hide enclosing closures; `strict` is threaded from ESM/CJS source through core/service/parser Abs-fn constructors, and class bodies are always strict. An explicit `"use strict"` directive prologue now marks a CJS script source strict, and CJS class-method bodies compile as strict too.
  - Replace the transpile→ESM-text→regex-rewrite round-trip with `transpileModule()` metadata + host-target emission (`__nudoBindImport`/`__nudoExport*`, no runtime import line, no generated-code re-parse). Analyze-mode top-level stripping now happens during emission. Namespace-only `import * as ns` now emits valid ESM.
  - Fix `$set` fail-closed on nullish/non-Abs receivers: the host-write handler now reports hits explicitly instead of using `undefined` as a sentinel, so a write to a non-Abs receiver returns that receiver instead of crashing on `.shape`.
  - Fix `$switch` implicit no-match arm: it no longer contributes an empty yield collector, so single-arm switches keep precise generator element types instead of degrading to `unknown`. The switch-level snapshot/join set is pinned to outer bindings only: arm-local `let`/`const`/`function`/`class` (including nested blocks, `for` heads and `catch` params) never enter it, so an arm-local name can no longer copy/rebind a same-named outer binding and break its alias identity.
  - Fix free-write collection for nested functions: hoisted `var` / function-declaration names of a nested function body now shadow writes inside that body instead of being recorded as free writes of the enclosing unit (previously emitted `$copy(<name>)` for a binding that does not exist there, yielding a false `ReferenceError`/`never` and an error-level `nudo:entry-may-throw`). Block-scoped declaration shadowing is now per statement list rather than a recursive union, so a nested-block `let` no longer drops a legitimate sibling write from the fork set.
  - Module top level is now an alias-group scope boundary: `const b = a` at module scope keeps its alias identity across a top-level fork instead of leaving one name on the pre-fork object.
  - `Object.assign` onto a sealed / non-extensible brand (prototype) target now rejects a new own key with TypeError (native parity) while existing writable keys, own setters and owner-class members still assign.
  - Dedupe shared machinery: fork-arm wrapper, structural Abs keys, dependency-aware memo store + module identities, class-instance bridge, numeric bounds, internal-slot visibility, env-skip derivation from `NAMESPACE_GLOBALS`, proto walk, path projection, sum-arg dispatch, `undefAbs`, RegExp brand predicate, export-call exception skeleton.
  - **BREAKING**: Remove the dead public engine symbols instead of deprecating them: the module-level `phi` stack (`currentPhi`/`pushPhi`/`popPhi`/`resetPhi`/`withPhiConstraint`/`describePhi`), `$while`/`$forIter`/`$asyncReturn`/`$staticInit`/`$thisGet`/`$thisSet`, the HOF promotion helpers (`createHofCollectCtx`/`promoteParamShape`/`tryPromote*`/`HofCollectCtx`/`AstEnv.hofCollect`), the dead relation helpers `alphaOf`/`betaOf`, and `generalizeAll`. `$staticInvoke` also leaves the public surface (previously exported from `.` and `./exec`): it is now engine-internal, still implemented for the `check-may-throw` class bridge. Retire dead internal `language.ts` exports (keep `getClassChain`/`wrapPromise`).
  
    Migration: every removed name was a dead engine internal with no product-surface consumer — drop the imports from `@nudojs/core` / `@nudojs/core/exec`; `$staticInvoke` is no longer reachable from a host.
  - Rename `exec/class-regex.ts` to `exec/regexp-runtime.ts` to match its RegExp-brand role.
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/core@1.17.0

更早版本（54）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.8.1 {#pkg-lsp}

## 1.8.1

### Patch Changes

- 0438f10: Fix evaluator correctness and remove duplicated machinery:
  
  - Respect user bindings named `undefined` / `NaN` / `Infinity` (module bindings, parameters) instead of unconditionally folding them; keep exact literal folding for unshadowed reads, suppress undefined-literal narrowing facts when the name is bound, and honor the same bindings in callee position (`NaN(1)`) and at the expression entry (declarations inside the expression itself).
  - Separate private top-level functions from the module export surface: `export *` precedence is restored, private named imports now report `nudo:missing-export`, `transpileSource` no longer emits `export` for private functions, and analysis keeps a non-enumerable local-function table (so same-name re-exports/CJS exports do not shadow analyzed locals).
  - Make the generated runtime import list a single source of truth (it is now self-consistent with `@nudojs/core/exec`), dedupe `RUNTIME_IMPORT_RE`, and share the `new Function` compile scaffold.
  - Dedupe the A/B call budgets and the two `@nudo:pure` memo caches behind shared factories; either public clear API now invalidates both.
  - Single-pass, memoized function facet analysis; dedupe Error/mutator/class-chain/nullish tables; remove dead service evaluator modules.
  - Split the evaluator's largest dispatch functions (`$invokeInner`, `$get`/`$set`, `invokeArrMethod`, `transpileStatement`) and move narrowing ops out of `runtime/async.ts`.
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/core@1.17.0
  - @nudojs/service@1.10.1
  - @nudojs/parser@1.5.4

更早版本（58）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.4 {#pkg-env}

## 0.5.4

### Patch Changes

- f1d4958: Update env source comments: the env-skip list is now the derived `getEnvShadowSkipGlobals` (namespace identity routing + host intrinsic names) rather than the old `ENV_SHADOW_SKIP_GLOBALS` constant. Comment-only; no runtime behaviour change.
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/core@1.17.0

更早版本（54）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.4.4 {#pkg-harvester}

## 0.4.4

### Patch Changes

- Updated dependencies [f1d4958]
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/env@0.5.4
  - @nudojs/core@1.17.0
  - @nudojs/parser@1.5.4

更早版本（54）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.6.1 {#pkg-vite-plugin}

## 0.6.1

### Patch Changes

- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/core@1.17.0
  - @nudojs/service@1.10.1

更早版本（57）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
