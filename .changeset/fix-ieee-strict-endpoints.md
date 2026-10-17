---
"@nudojs/core": patch
---

Fix unsound strict numeric endpoints under IEEE rounding. Strict bounds
(`gt`/`lt`) synthesized by endpoint arithmetic (add/sub/mul/div, linear
interval propagation) could round *inward* past the true infimum/supremum and
produce false proofs — e.g. `x >= 1 && y > 1e-16` proved `x + y > 1` while
`f(1, 1.05e-16)` returns exactly `1` in IEEE arithmetic. Strict endpoints are
now calibrated with a float-discreteness witness (`x > a ⟺ x ≥ nextUp(a)`):
when the witness result collides with the endpoint, the bound steps one ulp
outward (`gt(nextDown(E)) ⟺ ge(E)`), so `x > 0 ⟹ x + 1 > 1` now correctly
reports `> 0.9999999999999999`. Non-strict bounds are unaffected (fl
monotonicity). Also: `gt(x, NaN)` (a vacuously-false predicate from `0/0`
literals) is no longer collected as a numeric bound endpoint, matching the
existing NaN exclusion semantics. Contracts that relied on the old false
strict bounds (e.g. the `interface-derivation` example's `x>0 ⟹ x+4>4`) now
correctly fail — the example and docs were updated to sound forms
(`ge(0) ⟹ ge(4)`).
