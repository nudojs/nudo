---
"@nudojs/core": patch
---

Type guards now keep the structural obligations the type actually carries.

- A branded value (`Date`, `Map`, …) was projected as "is an object", so
  `{}`, `[]` and `new Map()` passed a guard that was supposed to accept a
  `Date`. The guard now checks the brand identity
  (`instanceof Reflect.get(globalThis, "<Brand>")`); a brand whose constructor
  is not a global is let through, matching the standard-schema face.
- A required object slot was only checked through its value guard, so a slot
  whose value is unconstrained (`any()` / `unknown`) lost its "the key must
  exist" rule entirely, and a slot whose value domain contains `undefined`
  could not tell a missing key from an explicit `undefined`. The existence
  rule is now an independent clause, and the object check no longer accepts
  arrays.
- A length bound (`string().length(3)` / `max(3)` / `min(2)`) was dropped
  from the guard, so every string passed. Length bounds are now projected as
  `value.length` comparisons.
