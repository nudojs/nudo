---
"@nudojs/core": patch
---

Fix: conjunctive guard facts now accumulate across parameters (issue #185), without weakening the NaN complement red line.

- `matchRelIdentLitComposite` keeps **every** guarded name in a relational conjunction (`x >= 1 && y >= 2`), exposing the non-first names as `RelGuard.others`; `narrowRelArmThunk` applies them all as `$refineRel` shadow rebindings in the fact arm. Same-name bounds stay in `extra` (tightest per operator, unchanged).
- `&&` short-circuit cons arm (right operand) now receives the left operand's relational guard (`relGuardOf(expr.left)`) — `x >= 1 && (y >= 2 ? x + y : 3)` keeps `x`'s bound inside the right side.
- New `relGuardOfNegation` / `narrowRelNegationArmThunk`: when the test is `!(A ∧ …)`, the **false** arm (early-return rest path, `if` else arm, ternary alternate, `||` right operand) soundly asserts every relational conjunct of `A` — `!` is exact boolean negation, so NaN cannot slip through (`!(x < k)` false ⟺ `x < k` true). Bare relational complements (`if (x < k) return …;` rest path) remain un-narrowed per Bug 1115.
- Result: `x >= 1 && y >= 2 ? x + y : 3`, `if (x >= 1 && y >= 2) { return x + y } return 3`, and `if (!(x >= 1 && y >= 2)) return 3; return x + y` now discharge `return number().ge(3)`; the sequential guard-clause and De Morgan spellings stay `nudo:unproven-return` because `number()` admits NaN (`add6(NaN, 5) = NaN`), which is the correct verdict.
