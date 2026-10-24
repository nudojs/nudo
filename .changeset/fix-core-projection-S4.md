---
"@nudojs/core": patch
"@nudojs/service": patch
"nudojs": patch
---

String unions are now concatenated member by member, and generated line
comments no longer carry a block-comment escape.

- A value that is one of several string literals was concatenated as if the
  literals were one piece of text. `("a" | "b") + "!"` was reported as the
  single string `"ab!"` — a value no call can produce, because the real
  answers are `"a!"` and `"b!"`. The same happened to `` `v=${x}` ``, which
  was reported as `"v=ab"`. A union now keeps its members apart while it is
  converted to text, and the two sides are combined member by member, so the
  result is the union `"a!" | "b!"`.
- The comment cleaner escaped the end of a block comment everywhere it was
  used, including inside `//` line comments, where it has no meaning. The
  contract draft printed by `nudo contract --draft` — the text a user is
  asked to copy into the sidecar — showed `/* no evidence — tighten *\/`
  instead of `/* no evidence — tighten */`. Line comments now keep the text as
  it is; a line break inside a comment is still flattened, so a comment can
  never spill out of its line. Block comments (the JSDoc in the emitted
  `.d.ts`) still escape it, because there the escape is what keeps the
  comment from ending early.

- **Member results are combined with the engine's existing "same primitive"
  rule** (`joinValues`), not as a raw union. Two *literal* members still form an
  enumeration (`"a!" | "b!"`), but a literal combined with a same-primitive arm
  that carries no narrowing evidence collapses to that primitive — the same
  rule the rest of the algebra uses. Without it, a union member whose rendering
  is already `string` would sit next to a literal and print as
  `"NaN days" | "NaN day" | string | …`: harder to read than the type it
  describes, and inconsistent with the signature the same function has
  everywhere else (`formatAge(durationMs: number) => string`).
