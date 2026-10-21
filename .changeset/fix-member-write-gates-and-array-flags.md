---
"@nudojs/core": patch
---

Writing a member now goes through the same checks JavaScript does.

- A write only looked at the receiver's own slots, own accessors and own
  attribute flags: the `writable: false` flag was never consulted for
  functions, class values or indexed properties, and the prototype chain
  was not walked at all. Writing to a read-only property inherited from a
  prototype succeeded silently, and a setter on the prototype was never
  called. The write now follows the ordinary internal method: the
  prototype chain is walked, an accessor without a setter raises a
  `TypeError`, a non-writable or frozen property raises a `TypeError`, and a
  setter is invoked. An instance of a user class is covered too.
- A write through a proxy rejected only the literal `false` returned by
  the trap, so a trap returning `0`, `""`, `null` or `undefined` was
  accepted. Every falsy result is now a rejection.
- A write to a built-in prototype was shadowed by the built-in method
  table: after `Array.prototype.push = 5`, reading `Array.prototype.push`
  still returned the built-in function and the write was ignored. The
  receiver's own slot now wins, as the specification's lookup order
  requires.
- An array's `length` accepted values that are not numbers: `a.length =
  undefined` and `a.length = {}` did not raise a `RangeError`. The value
  is converted to a number first, then checked to be an integer in range.
- A sealed array accepted a truncating `length` write, `pop()` and
  `shift()` without raising a `TypeError`. The empty array still behaves
  like the original, and an array that was only made non-extensible still
  accepts the truncation, exactly as in JavaScript.
- `delete a.length` was reported as successful. The `length` property of
  an array is not configurable, so the delete now raises a `TypeError`.
