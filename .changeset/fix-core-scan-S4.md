---
"@nudojs/core": patch
"@nudojs/service": patch
---

Sidecar sections are now recognised by nudo's own marker and nudo's own
boundaries, and a class's static and instance methods no longer share one name.

- A sidecar comment that merely **mentions** `@generated` (for example
  `// handwritten contract: this mentions @generated`) was treated as nudo's
  own section header. The whole handwritten contract then lost its
  obligations — a call site that violated the contract was not reported at
  all and `nudo check` exited 0 — and `nudo contract --emit --all` replaced
  the handwritten contract with the observed values. A header now counts only
  when the comment starts with `@generated` and names nudo, and a section
  boundary stops at a `const` that the export does not reference. The
  legitimate generated shapes (the alias section, the composite downstream
  section with its prelude `const`, a multi-step prelude, a header directly
  above the export) are still recognised.
- A static method and an instance method with the same name were both listed
  as `C.m`, so the two records replaced each other in the tables indexed by
  name and the signature mixed parts of both methods. The instance method
  now takes the name on its own, and the generated TypeScript declaration no
  longer repeats the member.
- `get` and `set` members of a CommonJS object literal were collected as
  exported functions, which invented an entry point and a spurious "may
  throw" error. They are not callable entries and are no longer collected.
- A CommonJS member assignment whose value is a named function expression was
  named after the function's own inner id instead of the export slot, so the
  sidecar contract never bound and the exported symbol was missing from the
  signature table. The export slot name wins now.
