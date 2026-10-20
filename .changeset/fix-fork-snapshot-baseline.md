---
"@nudojs/core": patch
---

Statement-level `if` / `switch` no longer roll back the side effects of
their own test / discriminant.

The fork snapshot (`__fk0_*` for `if`, `__sw0_*` for `switch`) is the
baseline each branch is restored to when it starts. The baseline has to be
taken *after* the test / discriminant was evaluated: the snapshot used to
be emitted before `$fork(...)`, while the test is the first argument of
that call and is therefore evaluated later — so every side effect of the
test (a call, a getter, an assignment, an increment) was undone when the
branch started.

`if (f()) { … }` folded `0` instead of `1`, `if ((n = 5) > 0) { … }`
folded `0` instead of `5`, and `switch (f()) { … }` folded `0` instead of
`1`. The test / discriminant is now evaluated into a temporary first, the
snapshot is taken afterwards, and `$fork` / `$switch` use that temporary.
