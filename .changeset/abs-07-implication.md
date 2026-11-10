---
"@nudojs/core": minor
---

ABS-07: sound implication upgrades — order closure, square lower bounds, DNF, oracle caching.

- Order closure (the provable difference fragment): pure order facts between single atoms (`x <= y` / `x < y`, no arithmetic shift, no rounding) are stored as a graph and closed with a BFS that tracks strictness. Transitive goals (`x<=y ∧ y<=z ⇒ x<=z`), strict chains, and dual directions now prove; unsound directions stay unproven.
- Simple non-linearity: `A*A >= c` proves when `A` has non-NaN evidence (`c <= 0`), or a non-strict lower bound `L >= 0` with `fl(L*L) >= c` (monotone rounding). Strict targets stay unproven — `x > 0 ⇒ x*x > 0` is false at `x = 5e-324` (underflow).
- DNF rewrite for conjunctions with nested disjunctions (`A ∧ (B ∨ C)`) is an equivalence-preserving expansion (cap 32) — only fewer misses, no new proofs of invalid goals.
- IEEE counterexamples are pinned as must-stay-unproven: `x <= y ⊬ x-y <= 0` (`Inf - Inf = NaN`) and `x >= y+1 ⊬ x-y >= 1` (`2^53 + 1 = 2^53`).
- Optional implication oracle: answers are cached per oracle identity and `(phi, pred)` (512 entries, deterministic-oracle contract). Default remains fail-closed with no oracle.
- Gold suites (recall = precision, real-package zero-FP) stay green.
