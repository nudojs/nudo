---
"@nudojs/core": patch
---

Boxed primitives and prototype objects now look the way the language
looks.

- `Object(1n)` keeps its internal value. `typeof Object(1n).valueOf()` is
  `"bigint"` again, and `Object(1n) + 1` throws the `TypeError` the
  language throws for mixing a bigint with a number.
- `Object(Symbol("x")).description` is `"x"` instead of `undefined`.
- `Object.getPrototypeOf(Function.prototype)` is `Object.prototype`.
- `Error.prototype` has its own `name` and `message` properties, so
  `Object.prototype.hasOwnProperty.call(Error.prototype, "name")` is
  `true`.
- The prototype chain of the built-in prototypes is no longer flattened:
  `Object.getPrototypeOf(Uint8Array.prototype)` is not
  `Object.prototype` any more.
- `String(x)` no longer reports a possible `TypeError` for every
  object. `String(new Date(0))`, `String(new Map())` and
  `` `${new Date(0)}` `` are all accepted, and they now agree with each
  other.
- `Intl.NumberFormat.name` is `"NumberFormat"` and
  `Intl.DateTimeFormat.name` is `"DateTimeFormat"`, instead of the
  internal dispatch key `Intl.NumberFormat`. The same applies to
  `Intl.Collator.name` and `Intl.Locale.name`.
