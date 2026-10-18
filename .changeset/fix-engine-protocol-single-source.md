---
"@nudojs/core": patch
---

Protocol single-source cluster (root-cause class C8) from the differential
bug report: array destructuring of `Set`/`Map` consumes the same element
side tables as spread/`for..of`/`Array.from` (`[a, b] = new Set([1,2])`
binds real elements; `Map` destructuring yields `[k, v]` tuples) instead
of folding `undefined` and false TypeErrors (Bug 82); `for..in`
re-checks key presence per iteration over the live binding, so keys
deleted before being visited are skipped (Bug 98); TypedArray HOF
callbacks run once per element for known lengths (≤1024 unroll cap),
making side-effect counts exact (Bug 100); `Array.from` consults the
object's `@@iterator` before the array-like half — a non-callable
iterator throws, a callable/abstract one yields the iterator path instead
of an exact empty array (Bug 110).
