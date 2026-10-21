---
"@nudojs/core": patch
---

Destructuring with a computed key now reads the property the key points at.

- In `const { [k]: v } = o`, a bare identifier used as a computed key was
  taken as the *name* of the key instead of being evaluated, so the engine
  read `o["k"]` and returned `undefined` for every such destructuring — and
  `k` was never evaluated at all.
- A computed key is now evaluated and the property it selects is read. The
  key expression is evaluated once, as in JavaScript, and the same value is
  used for the read and for the rest element's exclusion set — so
  `const { [k]: v, ...r } = o` no longer leaves `k`'s property behind in
  `r`.
- Literal computed keys (`{ [1]: v }`, `{ ["x"]: v }`) and plain keys
  (`{ x: v }`) are unaffected.
