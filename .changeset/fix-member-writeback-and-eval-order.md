---
"@nudojs/core": patch
---

Assignments, calls and object literals now evaluate their parts in the order
JavaScript specifies.

- An assignment to a member expression evaluated the right-hand side before
  the object and the computed key. The member write was emitted as an
  immediately-invoked function whose *argument* was the right-hand side, so
  the value was computed first and the reference second; a computed key was
  inlined into both the read and the write and therefore ran twice. The
  reference (the object, every key, every intermediate value) is now
  evaluated into temporaries first, the right-hand side comes after, and a
  computed key is evaluated once and shared by the read and the write.
- `o.m(args)` evaluated the arguments before reading `o.m`, so a getter on
  `o.m` ran after the arguments instead of before them. The receiver and the
  member are now read before the arguments are evaluated, and the getter runs
  exactly once.
- `__proto__: <expr>` in an object literal had its value expression moved to
  the end of the literal, so the side effects of the properties ran in the
  wrong order. The value is now evaluated in place, in source order.
- `o.a.b = v` wrote back through every level of the path, so a getter on
  `o.a` was also assigned to. Only the last level is written back now; the
  intermediate levels are read, never written.
- The write-back of a member update (`o.n++`) is pinned by a regression
  test: it must happen at the moment the expression is evaluated, so that
  `if` tests, `switch` discriminants and loop steps see the value before the
  write.
