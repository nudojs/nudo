---
"@nudojs/core": patch
---

The function shape now carries which parameters may be omitted, and a
TypeScript `this: T` annotation is no longer emitted as a runtime parameter.

- A parameter with a default value may be omitted by the caller, but the
  parameter list only ever carried its bare name, so it was counted as a
  required argument: assigning `(x = 1) => x` to a function that accepts no
  arguments was reported as a mismatch even though the arrow function can be
  called with no arguments at all. The function shape now carries a per-position
  "may be omitted" flag (defaults, `?` parameters and rest parameters), and the
  required-argument count is derived from it. The public `requiredFnArity`
  signature and behaviour are unchanged; the flag is consulted first and the
  name-suffix rule remains the fallback.

  The flag is populated on every path that produces a function value: function
  expressions and arrow functions, object methods, function declarations and
  exported functions.

- A TypeScript `this: T` annotation is a receiver annotation, not a runtime
  parameter, but the transpiler emitted it as one. The emitted function was
  therefore syntactically invalid — `this` is not a legal parameter name — so
  loading the module threw and every evaluation of that module degraded to
  `unknown`. The annotation is now skipped in the emitted signature, in the
  argument-slot binding (it does not occupy an argument position, so the
  arguments after it were bound to the wrong parameters), and in the host
  signature of class methods.

- The index of a default parameter inside the emitted host signature is now
  taken from the emitted signature itself rather than from the source
  parameter list. The two coincide as long as every source parameter produces
  exactly one signature entry, which is no longer the case now that the `this`
  annotation is skipped.
