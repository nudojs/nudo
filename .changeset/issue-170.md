---
"@nudojs/core": minor
---

Guard-equality path facts and sum anchoring close the normalised-similarity derivation chain (#170) — `@nudo:assume d <= max` now proves `1 - d/max ∈ [0,1]` when `max` comes from `Math.max(a.length, b.length)` and the body guards `max === 0`, with no per-callee sidecar bounds.

- `===` / `!==` on undecided operands now carry symbolic `eq`/`ne` predicates (previously folded to an unconstrained boolean), so `$fork` pushes the equality fact into branch Φ — the else arm of `max === 0 ? … : …` knows `ne(max, 0)`
- `numericBounds` tightens an endpoint when a `ne(x, n)` fact matches its value: `x ≠ 0 ∧ x ≥ 0 ⇒ x > 0` (cross-source order-independent: the bound and the exclusion may live on the pred and Φ respectively); supplies the strict positive denominator that relational division folding requires
- `cmp` no longer applies brand `ToPrimitive` unboxing for `eq`/`ne` — strict equality has no coercion (`new Number(5) === 5` stays false)
- `@nudo:assume` local anchoring descends into fork-join sums: each member's term α-renames to the local's name (on that arm the member's value **is** the local), so a `d = cond ? 0 : Math.max(...)` callee result still matches the lemma; literal members keep their exact identity
- `0 / x` with a provably non-zero, non-NaN denominator folds to literal `0` — the literal arm of such a sum no longer poisons the joined quotient bounds
