---
"@nudojs/parser": patch
---

String literals in `@nudo:case` / `@nudo:skip` / `@nudo:mock` now follow
JavaScript string semantics, and a text that is not a single string literal
is no longer folded into a wrong value.

- A string literal was taken by slicing off the first and the last
  character, so escape sequences were never interpreted: `"a\tb"` became the
  four-character string `a\tb` (with a literal backslash) instead of
  `a<TAB>b`. A witness therefore did not denote the same string as the
  sidecar contract, which is evaluated as real JavaScript, and the contract
  gate reported `witness ⊭ contract` for a witness that was in fact
  correct. Escapes are now interpreted with JavaScript semantics (`\t`,
  `\n`, `\\`, `\"`, `\uXXXX`, …).
- The same slice accepted any text that merely started and ended with a
  quote, so `"a" + "b"` was folded into the string `a" + "b` — a value
  nobody wrote. The expectation of a case, a case witness, the declared
  return type of `@nudo:skip` and the payload of `@nudo:mock` all carried
  that wrong value, and the reported expectation was unreadable text. A
  string is now recognised only when the whole text is one string literal;
  anything else is reported as unrecognized (`nudo:directive-syntax`) and
  no longer produces a confident wrong value.
- The rule lives in one place (`directives/string-literal.ts`), so the case
  argument, the expectation, `@nudo:skip` and `@nudo:mock` share it.
