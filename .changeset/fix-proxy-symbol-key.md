---
"@nudojs/core": patch
---

Proxy traps now receive the real `Symbol` key, not the engine's internal
`"@@X"` string projection.

- The engine stores symbol-keyed properties under an internal `"@@X"` slot
  name. `obj[Symbol.x]` was transpiled into `$get(obj, "@@x")`, and the
  Proxy `get` / `set` / `has` trap dispatch passed that internal name on as
  the trap's key argument. Handlers that dispatch on the key therefore all
  failed: `typeof k` was `"string"` instead of `"symbol"`, `String(k)` was
  `"@@iterator"` instead of `"Symbol(Symbol.iterator)"`, and
  `k === Symbol.iterator` was always `false`.
- `Symbol.iterator in proxy` was worse: the `has` trap was never dispatched
  at all, because the `in` operator bailed out early on symbol keys.
- Symbol-projected keys are now restored to the real symbol at the trap
  boundary. The `in` operator looks the key up by its host identity, so the
  `has` trap fires and a symbol-keyed own property is reported correctly.
- A user-written string literal `"@@iterator"` stays a string key: it is a
  different property key from `Symbol.iterator` and is still handed to the
  trap as a string.
