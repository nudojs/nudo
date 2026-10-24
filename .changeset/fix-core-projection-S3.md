---
"@nudojs/core": patch
---

Inlay hints now show readable return types instead of engine-internal text.

- The return hint of an arrow function with an expression body was anchored at
  the **start** of the returned expression, so the annotation was pushed
  between `=>` and the expression and split the source line
  (`const arrow = (v) => : v * 2  v * 2;`). Block-bodied functions are
  unchanged (the hint still sits right before `{`); for an expression body the
  hint is now anchored at the **end** of the expression, the same place
  TypeScript puts its own return-type hint.
- The return hint could show the engine's internal abstract variable id
  (`len#0`, minted by a process-wide counter), which is neither a type the
  user wrote nor reproducible across recomputations. Internal length ids are
  now shown as the stable, readable `len`.
- A literal `-0` was rendered as `0`, and because the union members were
  de-duplicated with a key that did not distinguish `-0` from `0`, one of the
  two union members was dropped entirely (`0 | -0` displayed as `0`). Literal
  text and the de-duplication key now follow the repository's canonical
  literal rendering, so `-0` survives and both union members are kept.
