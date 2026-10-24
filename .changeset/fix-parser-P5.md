---
"@nudojs/parser": patch
---

Inline directives and mock payloads keep their meaning: an `@nudo:as` payload is
no longer dropped when it is written without a separating space, a trailing
comment no longer turns a valid type into `unknown`, an inline mock keeps its
`async` flag and its parameter bindings, and two identical malformed
directives in one file are no longer collapsed into a single diagnostic.

- `@nudo:as(string())` (no space between the tag and the payload) matched
  neither the "payload" pattern (which required whitespace) nor the "bare
  tag" pattern (which only accepted `@nudo:as` on its own), so the whole
  directive evaporated with zero diagnostics and the type override never took
  effect. The separating whitespace is now optional, an outer pair of
  balanced parentheses is unwrapped (`@nudo:as(string())` is
  `@nudo:as string()`), a tag whose name continues with an identifier
  character (`@nudo:assume`, `@nudo:ascii`) is still not an `@nudo:as`
  directive, and an empty payload is reported explicitly.
- A trailing comment without a preceding space (`@nudo:as string()// why`) was
  merged into the type expression, so a valid type was judged "unsafe" and
  degraded to `unknown` — the type override silently stopped applying.
  Trailing comments are now detected by lexical boundary; a `//` that follows
  a numeric literal and a digit is still read as a division, and comment
  markers inside a string literal are still ignored.
- `@nudo:mock f = async (x) => x + 1` lost its `async` flag during parsing,
  so the mock was modelled as a synchronous function and the call site
  `f(1).then(…)` was reported as "method 'then' missing on number receiver" —
  an error-level false positive (native returns a promise). The scan result now
  carries the `async` flag.
- The parameters of an inline mock payload had no binding semantics: a
  destructuring parameter was replaced by a placeholder name, a default-value
  parameter was dropped entirely, and a rest parameter kept its literal `...`.
  The mock body therefore read undeclared globals (`ReferenceError`) and the
  emitted declaration said `never`. The parameter list now keeps the source
  form, the parameter ASTs and the bound names, all aligned one-to-one.
- The deduplication identity of a directive diagnostic was the code plus the
  message text, with no position, so two word-for-word identical malformed
  directives in one file collapsed into a single diagnostic and the second
  occurrence was completely invisible. A diagnostic now carries the position
  of the offending directive and the identity includes it: the same problem at
  the same place is still reported once, while the same text at two different
  places is reported twice.
