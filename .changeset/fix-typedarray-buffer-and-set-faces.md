---
"@nudojs/core": patch
---

Typed array construction and `set` now reject what the language rejects.

- `new Uint8Array(buffer)` checks that the remaining bytes are a whole
  number of elements. A buffer whose length is not a multiple of the
  element size now throws a `RangeError` instead of being silently
  truncated to a shorter array.
- `%TypedArray%.prototype.set` checks that source and target hold the
  same kind of element. Copying an `Int8Array` into a `Uint8Array` is
  rejected with a `TypeError`; copying between two arrays of the same
  element type keeps working.
- `%TypedArray%.prototype.set` converts every element with `ToNumber`
  (or `ToBigInt` for bigint arrays) and reports the failure. A source
  holding a value that cannot be converted now throws a `TypeError` (or
  a `SyntaxError` for a non-numeric string) instead of being accepted
  silently.
