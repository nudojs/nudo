---
"@nudojs/core": patch
---

`Object.defineProperty` evaluates its arguments once, and `delete` /
`Object.defineProperty` now take effect at the point where they are
evaluated.

- `Object.defineProperty(o, key, desc)` was emitted twice in statement
  position: once as the call itself and once as the write-back, and the
  write-back re-evaluated the argument expressions. A side effect in the
  key or in the descriptor therefore ran twice. The write-back now happens
  inside the call's own evaluation, so every argument is evaluated once.
- `delete o[k]` and `Object.defineProperty(o, …)` used to be emitted as a
  read-only value plus a separate statement-level write-back. When they
  appeared inside a larger expression, the write-back could only run
  after the whole statement, so a read that followed the `delete` in the
  same expression still saw the old value (`delete a[0]` followed by
  `0 in a` reported `true`). Both now delete / define at the point of
  evaluation, so later reads in the same expression observe the change.
