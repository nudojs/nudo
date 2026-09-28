---
"@nudojs/env": patch
---

fix(env): `Math.min` / `Math.max` / `Math.hypot` are variadic

The ES env declared them as binary (`envFn([prim.num(), prim.num()], num)`), so
`Math.min(a, b, c)` — the ordinary usage — no longer matched the arity, and the
call degraded to `unknown`. On a real project this turned an OSA
Damerau–Levenshtein implementation into `unknown` and failed 8 case assertions
the moment `nudo.env` was declared.

They now use `envFnVariadic(prim.num(), prim.num(), { apply: numImplVAbs(...) })`:
any number of literal numeric args fold (`Math.min(3, 1, 2) === 1`), and
non-literal args yield `number` instead of `unknown`.
