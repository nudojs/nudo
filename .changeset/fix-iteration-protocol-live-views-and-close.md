---
"@nudojs/core": patch
---

Iteration follows the protocol of the value being iterated, and the
iteration protocol is now honoured when it is left early.

- A `Map` or a `Set` was iterated over a snapshot taken when the iterator
  was created, so an entry added during the iteration was never visited
  and a deleted entry was still visited. The iterator is now a live view
  of the receiver.
- An iterator that is left early — through `break`, `return` or `throw` —
  never told the iterated value about it. The `return` method of a user
  iterator is now called when the iteration is left early, as the
  specification requires, including the cases where the method is missing,
  is not callable, or does not return an object.
- `for..in` over an instance of a class only visited the own slots of the
  instance and skipped everything on the prototype chain. The prototype
  chain is walked now.
- A tagged template object was modelled as a plain object: its
  properties were enumerable, it was not frozen, and the array methods
  were missing. It is now a frozen array exotic object, and
  `Array.isArray` reports `true` for it, as in JavaScript.
- A `String` wrapper object was not iterable, so spreading one was
  reported as a possible `TypeError` even though JavaScript spreads it
  into its characters. A `Number` wrapper is still not iterable, and is
  still reported as a possible error.
- A user-defined `@@iterator` method was never called by `for..of` or by
  `Array.from`: the loop ran once and the element domain was unknown.
  The iteration protocol is now used, and the number of elements is taken
  from the iterator when it reports that it is done.
- The members of a user-defined iterable are now read in iteration order
  and with the value the iterator yields, instead of being read as index
  properties.
