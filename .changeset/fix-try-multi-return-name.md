---
"@nudojs/core": patch
---

Two `return` statements in the same lexical block inside a `try` no
longer break the whole module.

A `return` inside a `try` region is emitted with a fixed temporary name
(`const __nudoRet = …`). Two such returns in the same block were a
duplicate `const` declaration, which fails at compile time with
`SyntaxError: Identifier '__nudoRet' has already been declared` — the
whole module then fails closed, so every function in the file degraded to
`unknown` / `never` and `nudo check` lost the signatures of unrelated
functions. Merely having the two returns in the source was enough; the
dead code never had to run.

Each return now takes its temporary in a block of its own, so the
bindings no longer collide. The `return` stays inside that block, which
does not change the function-exit semantics.
