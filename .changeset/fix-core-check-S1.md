---
"@nudojs/core": patch
---

`nudo check` no longer dies on an assignment whose recorded value is not an
abstract value, so one bad file can no longer cut a whole check run short.

- The assignment channel records the **runtime** value of a binding and of
  the right-hand side. Those values are abstract values for ordinary
  expressions, but they are plain host values in two cases: an environment
  global that is a function or a constructor (`parseInt`, `String`,
  `Promise`, `setTimeout`, …) is injected as a host function, and a
  function declaration is an ordinary host function object after
  transpilation. The structural-assignment gate assumed every recorded
  value was abstract and read `.shape` on it, so `let g = parseInt; g = 1;`
  or `f = h` (with `h` a function declaration) threw a `TypeError` that
  killed the whole `nudo check` run — no signatures, no diagnostics, and
  every file queued after the failing one was never analysed.
- The gate now checks that a recorded value is abstract before reading its
  shape. A recorded host value carries no comparable shape, so the record
  is skipped (fail-closed): the run continues, the remaining files are
  checked, and assignments between abstract values are still reported as
  before.
