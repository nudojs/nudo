---
"@nudojs/core": patch
"@nudojs/service": patch
---

The directive grammar now has a single enforcement face: the case-argument
grammar of the check product, the case emitter, the function census and the
diagnostic positions are aligned with the parser.

- The check product parses a case witness with its own literal grammar (a
  decimal regular expression, and a string sliced off its first and last
  character). A witness written as `1e3` or `"a\tb"` therefore did not denote
  the value the user wrote, and the contract gate reported
  `witness ⊭ contract` for a witness that was in fact correct — while the
  same file, read by the parser, held a different value. The check product
  now uses the same literal grammar as the parser: JavaScript number
  semantics (exponent, hex, binary, octal, separators) and JavaScript string
  semantics (escapes), and a text that is not a single literal is no longer
  folded into a confident wrong value.
- The case emitter wrote a string value into the directive text verbatim, so a
  value containing a backslash or the quote character produced a directive
  that no longer re-parsed to the same value — `nudo test --freeze` wrote out
  a case that failed on the next run. The emitter now escapes what the
  grammar requires. Non-finite numbers (`NaN`, `Infinity`) and bigint
  literals were dropped from the emitted case entirely (the whole case was
  abandoned); they are now expressible.
- A static class method was visible in the signature surface of `nudo check`
  but invisible in the function census of `nudo test` / `nudo health` /
  `nudo contract`, because the census only collected instance methods. The
  census now collects static methods as well, matching the check product.
- A directive diagnostic carried no position, so every occurrence of the same
  problem was reported at the same place and the product surfaces could not
  point at the offending directive. Diagnostics now carry the position of the
  offending directive.
- The union splitter of the what-if surface did not treat a backslash as an
  escape inside a string, so a type expression containing `\"` was split in
  the wrong place.
