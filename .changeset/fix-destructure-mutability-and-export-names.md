---
"@nudojs/core": patch
---

Destructured bindings follow the mutability of the binding they come from,
and a destructuring export exports the real names.

- A binding that came from a destructuring pattern was always emitted as
  `const`, even when the binding itself is mutable: a parameter, a `let` or
  `var` loop head. Assigning to such a binding inside the body threw a
  `TypeError` although the original code does not throw, which turned into
  a false `entry may throw` report and an `unknown` return value. A
  parameter or a `let` / `var` head now keeps its binding mutable, while a
  `const` head still throws.
- `export const { a } = …` and `export const [a] = …` exported the
  internal temporary name instead of the destructured names, so the real
  export was missing and importing it from another module produced
  `unknown`. The export now lists the names that were actually bound.
