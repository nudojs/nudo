---
"@nudojs/core": patch
"@nudojs/lsp": patch
---

Return-contract diagnostics now carry the position of the function they
belong to, name the constraint source they really came from, and only claim
that a proof relied on a user lemma when the proof actually consumed it.

- **Position.** `checkSource` built its return-contract issues without a
  `line` / `column`, so every consumer fell back to the top of the file:
  the LSP drew the diagnostic at line 1 column 0, `nudo check --gha`
  annotated `line=1,col=1`, GitLab Code Quality reported `lines.begin: 1`,
  and `--json` emitted no position at all — even when the offending
  function was declared on line 10. The issues are now built with the
  declaration position of the function, so the LSP, the CI annotations and
  the JSON machine contract all point at the real line.
- **Constraint source.** The message of a violated return contract always
  said `@nudo:contract return <name>`, even when the constraint came from
  the return slot of a sidecar `fn({...}, <ret>)` binding — a directive
  that does not exist in the source file. The message now names the real
  source: `@nudo:contract return <name>` for a source directive,
  `sidecar fn() return slot (...)` for a sidecar return slot.
- **Lemma attribution.** The `nudo:assume-relied` audit note claimed that
  a proof relied on a user lemma whenever the function declared one and
  the return contract happened to be provable — even when the lemma took
  no part in the proof (`return 0` is provable regardless of
  `@nudo:assume d <= max`). The engine now records which lemmas a proof
  actually consumed and attributes the note to those, so an unused lemma no
  longer produces a false "proved via @nudo:assume" claim. The proof
  result itself is unchanged: the note is an audit annotation, not a gate.
