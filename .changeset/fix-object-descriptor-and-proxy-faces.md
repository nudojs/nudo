---
"@nudojs/core": patch
---

`Object.defineProperty` now validates the descriptor, and the reflection
helpers behave like the spec instead of guessing.

- `Object.defineProperty` runs `ValidateAndApplyPropertyDescriptor`.
  Redefining a non-configurable or non-writable property used to succeed
  silently and rewrite the value; it now throws a `TypeError`, and a new
  key on a non-extensible target is rejected instead of accepted.
- `Object.defineProperties(o, 42)` no longer throws. The second argument
  goes through `ToObject`, so a primitive becomes a wrapper with no own
  properties and nothing is defined.
- `Object.create(o, undefined)` no longer throws. Passing `undefined`
  explicitly skips the whole step, exactly like omitting it.
- `Reflect.defineProperty(proxy, …)` returns `false` when the trap
  refuses, instead of throwing a `TypeError`.
- `Reflect.get` now runs getters, so an object literal with a getter
  returns the getter's value rather than `undefined`.
- `Reflect.set` honors its fourth argument (the receiver) and uses
  `[[Set]]` semantics on a proxy, so a trap that returns `false` yields
  `false` rather than a thrown `TypeError`.
- `Reflect.set(array, "length", 3)` now actually changes the length.
- `Object.keys` / `values` / `entries` no longer claim an exact empty
  tuple for an object with an open key set (the shape produced by
  `Object.groupBy`); they report a `string[]` domain instead of a
  confidently wrong `[]`.
