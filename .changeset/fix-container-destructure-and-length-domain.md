---
"@nudojs/core": patch
---

Destructuring, array holes and the length of a union are now modelled the
way JavaScript models them.

- `Array.prototype.sort` and `toSorted` turned the holes of a sparse array
  into elements, so the array gained a key, `in` reported the key as
  present and the higher-order methods stopped skipping it. The holes stay
  holes.
- The rest of an object destructuring did not call the getters, so the
  side effects of the getters were lost. The getters are called now.
- A property written to an array under a key that is not an index was
  dropped, and reading it back reported a confident `undefined` — a value
  that is narrower than the truth and contradicts the engine's own rule
  that it must not be falsely precise. Reading it back is not precise any
  more, and the write is no longer dropped.
- The `length` of a union was read as `number`, whatever the members were,
  so a contract of `number()` was always accepted and nothing was ever
  reported. The length of each member is kept now.
