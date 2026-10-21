---
"@nudojs/core": patch
---

`Math.min` and `Math.max` now keep a satisfiable range.

The bounds of `min` and `max` were merged the wrong way round, so
`Math.min(x, 0)` claimed both `> 0` and `≤ 0` at the same time. A
function that always returns `0` satisfied a `@nudo:contract return
number().gt(0)` contract, and the value was reported as exactly
`"pos"`. The bounds are now merged the right way round, so the
contract is rejected and the value is reported as `"nonpos"`.
