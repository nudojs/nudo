---
"@nudojs/core": patch
---

Calling a class without `new`, calling a proxy whose target is not callable,
calling a proxy at all, and calling an unknown value now behave like the
runtime does.

- A class value (a `class` declaration or a class expression) only has a
  `[[Construct]]` slot. Calling it as a plain function threw a `TypeError`
  natively ("Class constructor A cannot be invoked without 'new'"); the
  engine folded the call into `unknown` and did not record a `may-throw`, so
  `nudo check` reported the entry as never throwing.
- A proxy only gets a `[[Call]]` slot when its target is callable. A proxy
  over `{}`, `[]` or a class therefore throws a `TypeError` natively; the
  engine treated every proxy as callable and reported "never throws".
- A proxy call never reached the target and never dispatched the `apply`
  trap: the trap name was missing from the proxy trap table, so trap
  side effects were dropped and the result was always `unknown`. The `apply`
  trap is now dispatched with the native argument order
  `(target, thisArg, args)`, and a proxy without an `apply` trap falls back
  to the target's own call.
