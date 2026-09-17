---
"@nudojs/core": patch
"@nudojs/env": patch
---

Fix soundness issues in Abs evaluation:

- `parseInt` honors hex/octal/binary prefixes and explicit radix (no forced radix 10)
- `Array.isArray` returns unknown boolean for any/unknown/sum, and sees through brand
- `Date.now()` is an unknown number, not a folded wall-clock timestamp
- strict numeric bounds win over non-strict at equal value (order-independent)
- `boundsSatisfiable` no longer downgrades strict bounds via redundant ge/le
- structural `absShapeKey` stops join/dedup collapsing distinct arrays, overloads, brands
- `denoteGuard` renders NaN/±Infinity correctly
- `String.split` with non-literal separator returns `arr<string>`, not a 1-tuple
