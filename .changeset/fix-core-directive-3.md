---
"@nudojs/core": patch
"@nudojs/parser": patch
---

`@nudo:case` witnesses no longer evaporate in silence: an escaped quote in an
argument no longer swallows the whole case, the `=> expected` part is read on
CRLF sources, on the next line and behind a `!! throws` suffix, redundant
brackets around the expectation are stripped, and a glued
`@nudo:case"name"` tag is diagnosed instead of vanishing.

- `@nudo:case "k" ("a\"b") => 3` was dropped entirely. The bracket scanner was
  string-aware but not escape-aware, so the `\"` inside the string ended the
  string, the bracket closed early and the whole case was discarded. What
  remained on screen was a misattributed "unclosed argument list" warning.
  Balancing now follows JavaScript escape semantics first; a string that never
  closes (not valid JavaScript) still falls back to the previous lenient
  reading, so the argument count seen by the check face and by `nudo test`
  stays the same.
- `=> expected` was lost in a CRLF source file. The line was split on `\n` and
  the trailing `\r` stayed in the expectation text, so the expectation failed
  to parse and was dropped: the case became `[unchecked]`, the assertion never
  ran, `nudo test` exited `0` and nothing was reported. Lines are now split on
  `\r?\n`.
- A `!! throws [Kind]` suffix on the case line was read as the expectation
  text. With the suffix before `=>` the expectation disappeared entirely; with
  the suffix after `=>` the text `1 !! throws` was parsed and rejected. The
  suffix is now stripped from the expectation expression only — the case line
  itself is never rewritten, so the function-level `!! throws` declaration
  still sees it.
- `=> (999)` / `=> ("a")` / `=> ({ b: 1 })` never parsed, because the
  expectation kept its outer brackets while the argument side had always
  stripped them. The expectation now drops its redundant outer brackets, the
  same way the arguments do. An arrow function (`(x) => y`) is left alone.
- An expectation on the line after `=>` was silently discarded, and an
  expectation that was written but empty was discarded just as silently. The
  value is now read from the next line, and an empty `=>` is reported as
  `nudo:directive-syntax` instead of passing unnoticed.
- `@nudo:case"c1" (1, 2)` — no space between the tag and the name — was
  neither extracted (the extractor requires a space) nor reported (the
  diagnostic side accepted it). The case vanished with no diagnostic and
  `nudo test` ran no case at all. Both sides now share one grammar, and the
  glued form is reported as `nudo:directive-syntax`, the same way a glued
  `@nudo:mock` name is.
