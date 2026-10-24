---
"@nudojs/parser": patch
---

`@nudo:case` / `@nudo:mock` payloads no longer lose structure or optionality.

- The object / array literal branch of the case-argument grammar only checked
  the first and the last character of the text, so trailing text was folded
  into the value: `[1][0]` became the tuple `[unknown]` and
  `{ a: 1 } + { b: 2 }` became `{ a: unknown }`. The engine then reported a
  confident wrong value and the assertion failed even though the expected
  value was plain JavaScript. The whole text is now validated as exactly one
  literal; anything else is treated as "not recognized" (`unknown`) and is
  reported through the existing `nudo:directive-syntax` channel.
- An object literal property without a top-level colon (a getter, a method
  shorthand or a shorthand property) was silently dropped, so a `@nudo:mock`
  payload lost that property without a word and the mock value became a
  confident wrong value. Such a literal is now rejected as "not recognized"
  and the offending property is named in a `nudo:directive-syntax`
  diagnostic.
- The `optional` flag of a `shape({ … .optional() })` field was dropped when
  the expected value was projected into an Abs, so an optional field became
  mandatory and a legal actual value failed the assertion, and the reported
  `expected` text did not show `?`. The flag is now projected into the slot,
  matching the contract (sidecar) face of the same grammar.
