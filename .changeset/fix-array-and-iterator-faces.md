---
"@nudojs/core": patch
---

Arrays, iterators and the prototype methods now behave like the
language.

- `Array.from` reads an array-like whose `length` or whose indices are
  accessors. The getters are now called; before, the result was an
  empty array and a borrowed call saw zeroes.
- `Array.from` and `TypedArray.from` pass their third argument
  (`thisArg`) to the callback, so the callback sees the right `this`.
- `Object.prototype.toLocaleString` delegates to `this.toString()`.
  A user-defined `toString` is now honoured, and a `null`-prototype
  receiver throws the `TypeError` the language throws.
- `Array.prototype.join` / `toString` / `toLocaleString` report the
  `TypeError` they throw when the receiver is `null` or `undefined`.
- The `@@iterator` method of an iterator object returns the iterator
  itself. `it[Symbol.iterator]() === it` is now `true` for the
  iterators of an array, a string, a `Set` and a `Map`; the `Set` and
  `Map` ones used to throw.
