---
"@nudojs/core": minor
"@nudojs/service": minor
---

ABS-11: contract conjunction and projection precision.

- `and()` (`andC`) now conjoins structural forms: shape ∧ shape (field-level, missing fields preserved, same-field constraints recursively conjoined), array ∧ array (element-level; node preds such as length bounds kept), union ∧ union (member cross-product, capped at 16), and fn ∧ fn (per-parameter and return conjunction; throws merged as a union). Contradictory forms stay fail-closed: prim mismatch, structural × incompatible prim, different structural kinds, and binder/ref/rel conjunction conflicts throw the same conflict path as before.
- `formatConstraint` renders structural nodes' own predicates and optional flags (`array(number()).min(2)`, `shape(...).optional()`), so length obligations are no longer invisible in diagnostics/derivation output.
- dts projection treats contract and derived HOF relations as a **conjunction**: when a hand-written contract covers some parameters, HOF α variables are structurally unified with the contract Abs (elements / tuple slots / object slots / fn params+returns) and uncovered parameters plus the return position keep their β links instead of degrading to `unknown` (e.g. `processItems<B_transform>(items: number[], transform: (x0: number) => B_transform): B_transform[]`).
- Discriminant exhaustiveness warnings are intentionally deferred: the plan requires zero false positives, and no low-noise heuristic is available in this batch (documented in the test header).
