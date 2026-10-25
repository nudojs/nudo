---
"@nudojs/core": major
"@nudojs/service": patch
"@nudojs/parser": patch
---

Evaluator engine correctness, host transpile cutover, and dedupe.

- Fix `Object.assign` second-class calls (`const g = Object.assign; g(target, src)`, `.call`/`.apply`) so obj/tuple targets are mutated in place with native alias visibility; direct and builtin paths now share one `performObjectAssign` core.
- Fix function-value join/dedupe: branch-dependent expando slots, nested function values, anonymous/named same-shape functions, `optionalParams`/`ctor`/`paramTypes`/`returnType` differences no longer fold to a wrong exact value. `$copy` snapshots fn shapes independently and migrates impl/slot ownership, null-proto, and fresh-instance identity.
- Make `renameShape`/`snapshotAbs` structure-preserving: tuple `holes`/`rest`, fn `slots`/`optionalParams`/`ctor`, obj slot `symbolKey`/`internal`/`inherited`, brand/eff metadata.
- Fix compiled-body lexical scope and strictness: block-scoped `let`/`const`/`for`/`catch`/class/static-block bindings no longer hide enclosing closures; `strict` is threaded from ESM/CJS source through core/service/parser Abs-fn constructors, and class bodies are always strict.
- Replace the transpile→ESM-text→regex-rewrite round-trip with `transpileModule()` metadata + host-target emission (`__nudoBindImport`/`__nudoExport*`, no runtime import line, no generated-code re-parse). Analyze-mode top-level stripping now happens during emission.
- Dedupe shared machinery: fork-arm wrapper, structural Abs keys, dependency-aware memo store + module identities, class-instance bridge, numeric bounds, internal-slot visibility, env-skip derivation from `NAMESPACE_GLOBALS`, proto walk, path projection, sum-arg dispatch, `undefAbs`, RegExp brand predicate, export-call exception skeleton.
- Remove the dead public engine symbols instead of deprecating them: the module-level `phi` stack (`currentPhi`/`pushPhi`/`popPhi`/`resetPhi`/`withPhiConstraint`/`describePhi`), `$while`/`$forIter`/`$asyncReturn`/`$staticInit`/`$thisGet`/`$thisSet`, the HOF promotion helpers (`createHofCollectCtx`/`promoteParamShape`/`tryPromote*`/`HofCollectCtx`/`AstEnv.hofCollect`), and `generalizeAll`. `$staticInvoke` stays implemented but engine-internal for the `check-may-throw` class bridge. Retire dead internal `language.ts` exports (keep `getClassChain`/`wrapPromise`).
- Rename `exec/class-regex.ts` to `exec/regexp-runtime.ts` to match its RegExp-brand role.
