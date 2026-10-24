---
"@nudojs/core": patch
---

Numeric literals that overflow to infinity are no longer folded to `null`.

Babel parses `1e400` as a `NumericLiteral` whose value is `Infinity`
(the raw text stays "1e400"). The transpiler rendered the literal back to
source with `JSON.stringify(expr.value)`, and `JSON.stringify(Infinity)`
returns the four-character string `"null"` — JSON has no representation
for infinity. That text was pasted into the generated code, so `1e400`
became `$lit(null)`, the JS `null` literal rather than the string "null".

`return 1e400` folded `null` instead of `Infinity`, `-1e400` folded `-0`
instead of `-Infinity`, `Number(1e400)` folded `0` and `String(1e400)`
folded `"null"`. Non-finite numbers are now emitted the same way the
intrinsics are (`1/0` / `-1/0`, which do not depend on any identifier),
and `-0` keeps its sign.
