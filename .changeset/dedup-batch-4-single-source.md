---
"@nudojs/core": minor
"@nudojs/parser": patch
"@nudojs/service": minor
"@nudojs/lsp": patch
---

Dedup batch 4 (jscpd `--min-tokens 70` audit of code-level clones; website
EN↔zh mirrors and CHANGELOGs excluded as mechanism products): close the three
remaining comment-pinned manual-sync pairs and the largest in-file twins.
Pure refactor — outputs byte-identical (vitest --changed 15548 passed,
verify:examples 251 checks, public-api freeze 9/9).

Comment-confessed sync pairs now single-sourced:

- lsp hover `formatEntryParamShapeLike` → core `formatEntryParamShape` via
  `@nudojs/core/internal` (the old comment claimed "core adds no export";
  the internal face is the sanctioned route).
- lsp `server-code-actions` `norm`/`resolveRel` copy of the synthesized-sidecar
  base (already drifted: lsp had an extra direct-equality check + loader
  fallback) → `@nudojs/service/emit` exports `normPosixPath` /
  `resolveRelativeSpec`; the lsp-only extensions stay at the call site.
- standard-schema brand ctor list: `GLOBAL_BRAND_CTOR_NAMES` local array +
  Set → schema-generator `RUNTIME_GLOBAL_CTOR_NAME_LIST` (single array
  source; Set + `isRuntimeGlobalCtorName` predicate derive from it; the
  embedded validator serializes the same array, byte-identical).

In-file twins single-sourced:

- core `hof.ts`: `predUsesMappedVars` / `mapHasShapeOnlyVar` → parameterized
  `predAnyVar` walker.
- core `scan/literal-shapes.ts`: 21 structurally identical
  `constraintViolated` issue pushes → `pushPrecondIssue` (message/suggestion
  templates byte-identical).
- core `builtins/promise.ts`: then/catch rejected-arm microtask twins →
  `definiteRecoveryPromise` / `unsettledRecoveryPromise`; then-microtask dual
  reject arms → `joinRejectedArm`; `Promise.all` dual reject faces →
  `allRejectFace`.
- core `check.ts`: handwritten return-contract recording block (skip branch +
  main branch) → `recordReturnContract`.
- core `leq.ts`/`postcondition.ts`: duplicate `primOf` single-sourced in leq.
- core `builtins/object/methods.ts`: TA own-keys tuple (keys/gOPN faces) →
  `taOwnKeysTuple`; gOPD class/Error/`.prototype` slot→descriptor arms →
  `ownSlotDescriptor`; 8 identical nullish-receiver guards →
  `throwIfNullishRecv`.
- core `builtins/array.ts` + `template.ts`: tuple join folding loops →
  `tupleJoinParts(recv, onSymbol)` (symbol element: throw vs abstract —
  the real semantic fork, parameterized).
- core exec runtime: `$whileSeq`/`$forOf` `applyExitJoin` closures → new pure
  `loop-exit-join.ts` `applyLoopExitJoin` (the discovered `exhausted && widen`
  gate difference is an explicit parameter; `$forOf` passes `exhausted: true`,
  provably equivalent).
- core `directive-scan.ts` ↔ parser `fn-directives.ts`: `CASE_TAG_REGEX` scan
  loop → core `iterCaseTags(text, caseArgSpans)` via `@nudojs/core/internal`
  (Bug 978 diagnostic actions and downstream regexes stay consumer-side).
- service `dts-generator.ts`: `DtsClassMemberSurface` base interface —
  `scanClassSurface` return type no longer re-declares the member fields
  (BUG-168/151 docs live once).
- lsp: `replay.ts` async env-preload twins share `preloadEnvsThen`, function
  scope walkers share `walkFnScope`; `server-navigation.ts` references/rename
  share the gate+parse prologue; `hover.ts` generalize blocks share
  `tryGeneralizeEnclosing`.

Skipped as intentional parallel data or non-identical semantics: env
node/web table clones (MessagePort ports, dual Storage, exec options),
dts obj-slot widen pair (Bug 240 selective flags vs whole-slot spread),
object methods string char-tuple pair (values vs entries elements).
