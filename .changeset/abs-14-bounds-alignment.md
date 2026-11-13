---
"@nudojs/core": patch
---

Fix ABS-14's `TypeParam.bounds` always being empty.

`entryReqs[].pred` comes from `instantiateConstraint(c, paramName)` and therefore uses **argument names** (`typeof x = number`, `x > 0`), while the bound registration validated it against `TypeParam.id` / formals in **alpha space** (`A1`, `A2`). Every variable was rejected as unbound, so `bounds` was never written.

- `key/summary-bounds.ts` gains `alignSimpleBounds`: rename `params[i] -> ids[i]` via `renamePred`, then apply the existing `collectSimpleBounds` simple-condition / one-way-dependency checks. Unmapped names (binders, undeclared vars) and `app` terms stay fail-closed and are dropped.
- `generalize.ts` now registers bounds through that helper. `entryReqs` and Phi keep their original argument-name space (display and body monotonicity propagation depend on it), so `display`, `symbolic`, `check` and `export` output are byte-identical.
- With `fn({ x: number().gt(0) })`, `typeParams[0].bounds` goes from `undefined` to `[typeof A1 = number, A1 > 0]`; with two parameters the bounds land on `A1` and `A2` respectively.
- Covered by `abs14-bounds-integration.test.ts` (11 cases: end-to-end generalize, pure-function negative cases, and proof that the bounds are well-formed α-space `Pred`s that `implies` can decide directly and that behave correctly when used as a summary entry's `pre`). Reverting the rename makes 8 cases fail.

`TypeParam.bounds` is **write-only** in this phase — no product consumer reads it. The fast path is gated on the full formation-time Φ recorded in the summary entry, not on these bounds; the fixture above only proves the metadata is well-formed and directly consumable by a future consumer. Design boundary, intentionally not changed: `opts.refine` still disables `summaryScope` (ABS-10), so contract-bearing functions do not write function-level summaries. `attachHofSnapshot` not passing `refine` is correct design, not a defect.
