---
"@nudojs/core": patch
---

Borrowed `String.prototype` and `Error.prototype` methods no longer throw
where the language does not, and borrowed `Array.prototype` methods now
follow the spec on non-array receivers.

- The brand-check table treated the whole `String.prototype` as
  brand-checked, so every one of its 30 generic methods threw a `TypeError`
  when borrowed onto another value (`String.prototype.toUpperCase.call(1)`
  is `"1"` natively). Only `toString` and `valueOf` really require a
  `String` receiver; the rest are generic (`RequireObjectCoercible` plus
  `ToString`) and are now dispatched on the coerced receiver.
- `Error.prototype.toString` is an ordinary method: it reads `this.name`
  and `this.message` and has no brand check. Borrowing it onto a plain
  object threw a `TypeError` instead of returning `"X: y"`. The error
  family no longer takes part in the brand check, and the generic
  implementation is used for object receivers.
- The `Array.prototype` mutators (`push`, `pop`, `shift`, `unshift`,
  `splice`, `sort`, `reverse`, `fill`, `copyWithin`) threw a `TypeError`
  on every primitive receiver. Only a string receiver throws, because
  `ToObject("ab")` has a non-writable `length`; every other primitive
  becomes an ordinary extensible object, so `push.call(5, 1)` is `1` and
  `pop.call(5)` is `undefined`.
- `Array.prototype.concat` spread the receiver even when it was not an
  array, so `concat.call("ab")` produced two elements instead of one. The
  spec only copies the receiver's elements when `IsArray(O)` holds;
  otherwise the receiver is appended as a single element.
- `sort`, `reverse`, `fill` and `copyWithin` operate in place and return
  the receiver, but a non-array receiver was materialized into an empty
  array. They now return the receiver itself.
- `Array.prototype.with` always throws a `RangeError` on a primitive
  receiver, because the receiver's length is `0` and the index is out of
  range. The engine reported no throw at all, so the L2 gate reported a
  false green.
