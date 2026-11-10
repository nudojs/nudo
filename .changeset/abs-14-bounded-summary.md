---
"@nudojs/core": minor
"@nudojs/service": minor
---

ABS-14: bounded function-level summaries (5 commits on branch `abs-14`).

- Single summary cache: `key/fn-summary.ts` now carries optional formals/bounds/pre/eff/shapeSig and a per-function entry (`fn\0<scope>`) on the SAME Map; `fnSummaryStats()` keeps its instance-level meaning, function-level hits are exposed by `fnSummaryFnLevelStats()`.
- Simple bounds with one-way alpha dependency (`key/summary-bounds.ts`): reverse deps, unbound vars and complex app terms fail closed; `TypeParam.bounds` is additive and write-only in this phase.
- Fast path (`key/summary-fastpath.ts`): hits only when shape signature, formal arity, free-var coverage, arg mapping and bound implication all hold, then `substAbs(post, map)` instead of re-running the body. `crossModule` channel is on by default; `bodyUnavailable` / `budgetTruncated` are off (would replace fail-closed unknown and break the equivalence gate).
- Equivalence gate: `abs14-equivalence-baseline.test.ts` (7 pinned body-path samples) plus `abs14-fastpath.test.ts` calling `diffAgainstBodyBaseline` with all entries equal.
- dts projection: HOF signatures no longer emit type parameters that are not referenced by any parameter or return position (`abs14-dts-reachable.test.ts`).
