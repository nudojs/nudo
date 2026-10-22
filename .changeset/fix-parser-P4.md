---
"@nudojs/parser": patch
"@nudojs/core": patch
---

Directive parsing no longer loses or over-applies directives: malformed mock
tags are reported instead of evaporating, file-level directives only apply
where they are written, and a case expectation is no longer voided by a
trailing comment.

- A file-level `/// @nudo:mock-module "fs" from "./mock-fs.js"` was caught by
  the function-level `@nudo:mock` tag pattern, so a correct file produced a
  fabricated `nudo:directive-syntax` warning ("Malformed @nudo:mock …").
  The mock tag now requires a name boundary that excludes the `-` suffix of
  the file-level family.
- `@nudo:mock` with an empty payload (`@nudo:mock fetch =`, `@nudo:mock g
  from`) matched neither strict grammar, so the directive evaporated silently
  — no mock, no diagnostic, and the analysis ran against the real API. The
  three mock grammars are now closed: a tag that matches the lenient pattern
  but neither strict one is reported through `nudo:directive-syntax`.
- `@nudo:skip=> number()` (no space between the tag and the payload) dropped
  the whole payload, so the declared return type never took effect and the
  signature degraded from `f() => number` to `f() => any` — an `any` leak into
  the product surface. The separating whitespace is no longer part of the
  required structure.
- `@nudo:mockfetch = …` (no space between the tag and the name) did not even
  match the lenient tag pattern, so the whole mock was invisible to the
  scanner: zero diagnostics and the analysis ran against the real
  implementation. The lenient pattern now sees the glued spelling and reports
  that a space is required.
- A `@nudo:case` expectation with a trailing comment (`=> string() // the
  result is a number`) failed to parse and fell back to an explicit `unknown`,
  which satisfies every expectation — the assertion was silently voided and
  the command reported "1 passed" with exit code `0`. The trailing comment is
  now stripped before the expectation is parsed.
- A malformed `@nudo:case` did not register an argument-region mask, so
  `@nudo:mock` / `@nudo:skip` written inside its arguments leaked out as real
  directives (false positives, methods dropped from the emitted declaration).
  Malformed cases now mask their argument region as well; the malformed-name
  diagnostic is unchanged.
- A file-level `@nudo:env` / `@nudo:mock-module` written inside a function
  body was promoted to whole-file scope: the environment or the module
  replacement applied to the entire file, with zero diagnostics. File-level
  directives are now position-gated — a line comment inside a function body is
  ignored and reported through `nudo:directive-syntax`, while top-level
  positions (file header, `export` line, between statements) keep working. The
  same gate is applied to the text-level extraction used by `@nudo:import`, so
  the three file-level families now behave alike.
