---
"@nudojs/core": patch
---

`@nudo:pure` now memoizes by **value** instead of by **variable identity**.

- The memo key was built from the argument's *term* — the identity of the
  variable the argument was read from — not from the argument's value. Every
  call that read the same variable collapsed onto one cache entry, so
  rebinding that variable to a different value still hit the previous entry
  and returned a **stale result**. On the product path (`_memoize` marker on
  a host function) `use()` returned `"2,2"` where the runtime returns
  `"2,4"`.
- The memo key is now derived from the value: literal values use the literal
  itself, and objects/tuples are compared by their slot and element content.
  Rebinding a variable to a different value invalidates the cache entry and
  the call is recomputed; two different variables holding the same value share
  one cache entry, which is what memoizing by value promises.
- Arguments whose value cannot be decided (functions, class instances, open
  objects, promises, primitives without a literal value) are **not** cached at
  all: the engine rather misses a cache hit than computes a wrong one, since
  a wrong hit is exactly the stale value this fix removes.
- The call-budget and cycle-detection keys keep their previous
  *call-identity* meaning; only the pure-memo channel uses the new
  value-based key.
