---
"@nudojs/core": minor
"@nudojs/service": minor
---

ABS-14: bounded function-level summaries (5 commits on branch `abs-14`, soundness gate revised 2026-11-13).

- Single summary cache: `key/fn-summary.ts` now carries optional `formals` / `argKeys` / `bounds` / `pre` / `eff` and a per-function entry (`fn\0<scope>`) on the SAME Map; `fnSummaryStats()` keeps its instance-level meaning, function-level hits/rejections are exposed by `fnSummaryFnLevelStats()` (`hits` = entry found, `applied` = actually substituted).
- Simple bounds with one-way alpha dependency (`key/summary-bounds.ts`): reverse deps, unbound vars and complex app terms fail closed; `TypeParam.bounds` is additive and write-only in this phase (no product consumer yet).
- Fast path (`key/summary-fastpath.ts`): a hit requires all of
  - **positional formals** (`formals[j]` = the top-level var of the j-th argument; non-var or aliased arguments fail closed) — storing the sorted `varOrder` used to transpose arguments (`f(z,y)` → `f(p,q)` returned `q - p`);
  - **arg isomorphism**: per-position α-normalized `absKeyWithConf` keys (shape × term × pred × conf) — a kind-only signature used to reuse `{x:1}` summaries for `{y:"s"}`, length-2 summaries for length-3 tuples, and `Date` summaries for `RegExp`;
  - **full precondition**: the formation-time Φ (`pre`, renamed formals → current argument vars) must be implied by the current Φ — checking only the simple `bounds` projection dropped `app`-term conjuncts, so `x % 2 === 0`-formed summaries leaked to unconstrained calls.
  Then `substAbs(post, map)` is applied instead of re-running the body. `bounds` stays as observable metadata only.
- All three conservative channels are on by default (`crossModule`, `bodyUnavailable`, `budgetTruncated`); the degraded channels are verified independently (`abs14-degraded-channels.test.ts`), gated off `symbolic` runs on the read side as well, and their substituted results stay in the instance memo only (cross-instance summaries keep "came from a real body evaluation" provenance).
- Equivalence gate: `abs14-equivalence-baseline.test.ts` (7 pinned body-path samples) plus `abs14-fastpath.test.ts` calling `diffAgainstBodyBaseline`. The fast side now clears the cache stack, uses a fresh PolyFn and a witness Φ (`ABS14_GATE_PHI`), so layers 1/2 must miss and the test asserts `applied` grew — the earlier version re-read the same memo entry and never exercised the function-level path.
- dts projection: HOF signatures no longer emit type parameters that are not referenced by any parameter or return position (`abs14-dts-reachable.test.ts`).
