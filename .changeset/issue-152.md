---
"@nudojs/core": minor
---

Add `@nudo:assume <param> <= <param>` user lemmas: cross-variable bound premises participate in relational division folding, so return contracts like `1 - d/max ∈ [0,1]` become provable (#152).

- `@nudo:assume a >= b` is normalized to `le(b, a)`; malformed lemmas or names outside the formal parameter list report `nudo:assume-invalid` (error).
- Premises are seeded per target-function entry evaluation and never inherited across call boundaries (callee frames are cleared — same-name re-anchoring cannot produce false precision). Recursive calls are conservatively cleared.
- Division folding derives the correlated bound `le(a,b) ∧ b > 0 ⇒ a/b ≤ 1` (plus mirrors), which plain interval propagation cannot express; downstream `+`/`-`/`*` folding consumes it as usual.
- Proofs that rely on lemmas surface `nudo:assume-relied` (info) — user axioms stay audit-visible.
- Constraint builders now throw on non-numeric bounds (`number().le("max")` previously built a silent string-literal predicate); use `@nudo:assume` for cross-variable references.
