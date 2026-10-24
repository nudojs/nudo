---
"@nudojs/lsp": patch
---

The "inline variable" refactoring of the language server now refuses to inline
a value it cannot prove is safe.

- A variable was inlined even when it was reassigned or captured by a closure,
  which changed the program's behaviour. The refactoring now only offers an
  inline action when the variable is provably single-assignment and not
  captured.
- A variable was inlined across an export boundary, so the module's public
  API changed silently. Exports are now detected and left alone.
- The refactoring was offered for a binding that the selected range does not
  actually cover, and it sometimes inlined the wrong occurrence of a shadowed
  name.
