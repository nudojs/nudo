---
"@nudojs/service": patch
---

`nudo test --freeze` now writes call-site witnesses without disturbing the
source file it writes into: the new `@nudo:case` block lands at the
declaration's own column, it keeps the file's line-ending convention, and a
witness that cannot be expressed faithfully is dropped instead of being
written as a different (wrong) value.

- **The frozen JSDoc block was indented by the `function` keyword's column
  instead of the declaration's.** For `export function greet(u) { … }` the
  function node starts at column 7 (`export default function` at column 15),
  so the whole block was shifted right and no longer lined up with the
  declaration it documents. The block is now indented like the declaration
  line it is inserted above, which keeps nested functions at their own
  indentation.
- **Writing into a CRLF file produced mixed line endings.** The existing
  lines kept their `\r\n`, but the newly inserted block was written with bare
  `\n`, so `file(1)` started reporting "with CRLF, LF line terminators" and
  the file's line-ending convention was silently rewritten. Newly inserted
  lines now follow the file's dominant line ending, and the existing lines
  keep the endings they already had.
- **A sparse tuple's holes were frozen as explicit `undefined` elements.**
  The hole of `[1, , 3]` carries the same abstract value as an explicit
  `undefined` element, so the witness could not tell them apart and was
  written as `[1, undefined, 3]`. Reading that back says the array is dense:
  the very same call site flipped from `false` to `true`, i.e. the freeze
  rewrote an observed fact into its opposite. The case-argument grammar has
  no spelling for a hole, so such a witness is now skipped (like a witness
  with a rest slot) instead of being approximated.
