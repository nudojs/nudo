---
"@nudojs/core": patch
---

Reassigning a `const` binding declared inside a block scope now throws
`TypeError` again, in every block scope.

- The `constNames` set that decides whether an assignment target is immutable
  was only computed for function bodies and plain blocks. `try` / `catch` /
  `finally` bodies and `for` / `for-of` / `for-in` / `while` / `do-while`
  bodies are block scopes too, but their statements were transpiled without
  recomputing the set, so a `const` declared there was not treated as
  immutable. Assigning to it silently wrote the new value, and the throws
  domain was folded to `never`.
- Every block-scope emission point now recomputes the immutable-name set for
  its own scope, the same way the plain-block path already did. A `const`
  reassignment in those scopes throws `TypeError` (and the entry point is
  reported as `throws TypeError`), while `let` / `var` bindings and inner
  `let` shadowing stay mutable.
