---
"@nudojs/core": patch
---

Short-circuit operators evaluate their left operand exactly once.

`$fork` only guarantees that the *test* is evaluated once and that the
arms run lazily — the test value is not handed back to the arms, so
emitting the left operand's source into an arm evaluated it a second
time. A getter, a call or a computed key therefore ran twice (four
times for nested `??`), and an incrementing getter returned a different
value on the second read, so the result and the surrounding state were
wrong (`o.x ?? 5` folded `2` instead of `1` for a getter counting its
own reads; `a[i++] ?? "d"` folded `"undefined|2"` instead of `"x|1"`).

An impure left operand (getter / call / computed key / increment) that
is reused by an arm is now bound to a temporary first, and the test and
the arms all refer to that binding. Pure left operands (identifier /
literal / `this`) keep their previous shape, since re-reading them is
not observable.
