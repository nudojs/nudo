---
"@nudojs/core": patch
---

Mutation/state/write-back cluster (root-cause class C3) from the differential
bug report: statement-position write-back now covers member targets
(`Object.defineProperty(o.p, …)`, `C.prototype`) and optional-chain
`delete o?.a` (Bug 87/111); `String.prototype.match/matchAll` honor the
pattern brand's tracked `lastIndex` with the spec `matchAll` flag rewrite
(Bug 94); argument-position global `match/replace/replaceAll` reset the
regex binding's `lastIndex` (Bug 96); `RegExp.prototype.compile` recompiles
the receiver — source/flags/flag getters/lastIndex fold fresh values and
invalid patterns throw `SyntaxError` (Bug 126); `String.prototype.replace/
replaceAll` dispatch through a `@@replace` slot installed on the pattern
(Bug 81); accessor→data descriptor redefinition drops the stale getter and
merges flags (Bug 84); `Object.defineProperty/defineProperties` on
tuple/array receivers install/truncate/extend indexes and length instead of
silently dropping (Bug 86); descriptor keys coerce via `ToPropertyKey` —
symbol/boolean/null/undefined keys install (well-known symbols behind the
`@@X` projection) (Bug 117); non-primitive descriptor `value`s (fn/obj/
tuple/bigint/symbol) keep their Abs instead of folding `undefined`
(Bug 118); `Object.assign` uses `[[Set]]` semantics — the `__proto__`
accessor fires and inherited non-writable data properties throw (the
`proto-slot-key` assign pin is re-anchored to native) (Bug 128);
Set/Map deduplicate non-literal keys by reference identity with exact
size/get/has/delete folding and soundness guards (Bug 88);
`new RegExp(undefined)` folds the empty pattern `(?:)` (Bug 95).
