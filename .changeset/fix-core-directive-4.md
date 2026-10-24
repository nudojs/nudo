---
"@nudojs/core": patch
"@nudojs/parser": patch
---

Malformed `@nudo:` directives are diagnosed instead of evaporating in silence:
an empty or glued `@nudo:assume` / `@nudo:invariant` / `@nudo:contract` /
`@nudo:throws` now raises a syntax diagnostic, and a `!! throws` suffix is only
read where it is actually a directive.

- `@nudo:assume` with an empty payload, or `@nudo:assumed d <= max` (a space
  missing between the tag and the payload), matched no branch at all: the
  scanner returned nothing and nothing was reported. The lemma was dropped
  without a word, so the return contract fell back from "proved" to "unproved"
  and the only sign was a `nudo:unproven-return` whose text blamed inference
  precision instead of the rejected lemma. An empty or glued
  `@nudo:assume` / `@nudo:invariant` now produces a bad segment and raises
  `nudo:assume-invalid` / `nudo:invariant-invalid`; a glued or empty
  `@nudo:contract` / `@nudo:throws` raises `nudo:contract-syntax` /
  `nudo:directive-syntax`. The strict grammar is unchanged — a tag still needs
  a separating space — the loose forms are only reported.
- `!! throws` was matched anywhere in a function's comment block, so a prose
  line ("this helper uses `!! throws`") or a case **name** that happens to
  contain that text was read as a function-level throw declaration. The
  declaration then covered every throw, `filterGateThrows` let them all
  through, and the `nudo:entry-may-throw` gate was silently switched off while
  the signature still printed `throws TypeError`. The suffix is now only read
  where it is a directive: after the argument list of a `@nudo:case` line, or
  on the continuation line of such a case. The documented case-suffix form
  (`@nudo:case "neg" (0) !! throws`) keeps working exactly as before.
- The same glue was invisible to the inline directives of the parser package:
  `@nudo:replaceFoo x number()` matched neither the strict nor the loose
  pattern, so the whole inline directive disappeared. It now raises
  `nudo:directive-syntax`. The `@nudo:as` side keeps the behaviour already
  merged for Bug 842: a tag whose name is extended (`@nudo:asXYZ`) is not an
  `@nudo:as` directive and stays silent.
