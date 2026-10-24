---
"@nudojs/core": patch
---

A literal contract now reaches bigint arguments in every argument position,
not only in the scalar one.

- A scalar argument was already checked against a bigint literal contract:
  `f(2n)` against `lit(1n)` was reported and `f(1n)` against `lit(1n)`
  passed. The same contract in an object field or an array element was not
  checked at all, because the literal branch only admitted number, string,
  boolean, null and undefined arguments: `f({ v: 2n })` against
  `shape({ v: lit(1n) })` and `f([2n])` against `array(lit(1n))` passed
  silently. One contract now gets one verdict in all three positions, so the
  two out-of-domain arguments are reported and the in-domain ones still
  pass.
- The union of bigint literals is decided the same way in a field as it is
  in the scalar position: `union(lit(1n), lit(2n))` reports `3n` and passes
  `1n` and `2n`.
- The `typeof` label of a bigint literal is matched against bigint values,
  so a bigint is no longer treated as a value of some other type.
