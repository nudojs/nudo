---
"@nudojs/core": patch
---

Fix false `nudo:unproven-return` warnings when a return value was widened to a prim domain top by the loop-carried-binding widener (issue #151):

- `postcondition.ts` now treats `conf="widened"` loop-widen products under the same policy as issue #115 partial arms: widening loses bound/path evidence but not the prim value domain, so domain membership against an unbounded bare prim contract is provable.
- The whole-value `isValueSetUnknown` gate in `assertImplies` no longer swallows `conf="widened"` returns before arm distribution; the per-arm gates in `assertImpliesSingle` (new proved exit) and `assertSumArms` keep everything else conservative.
- `isWidenedSumArm` also accepts arm-level `conf="widened"` (loop-widen sums carry widened on both parent and arm), enabling the existing `provesBarePrimDomain` discharge for union members such as `union(string(), lit(null))`.
- Guards unchanged: widened arms with mismatched prim or bounded contracts (`number().gt(0)`), and any-derivation FP protection, stay `unprovable` (never `proved`, never `disproved`); non-widened exact-arm semantics are untouched.
