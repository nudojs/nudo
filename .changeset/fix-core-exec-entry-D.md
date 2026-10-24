---
"@nudojs/core": patch
---

`structuredClone` now models its own argument contract instead of inheriting
the generic "abstract argument may throw" fallback.

- The host-global literal guard recorded a `may throw TypeError` (with a
  "Symbol coercion" cause) for **every** abstract argument. That reasoning
  only holds for host functions that coerce their argument (`parseInt`,
  `Number`, `decodeURIComponent`, `btoa`, …): `structuredClone` runs the
  structured clone algorithm and never coerces its argument. Every cloneable
  shape — plain object, array, `Date`, `Map`, `Set`, `RegExp`, `ArrayBuffer`,
  typed arrays, class instances — was therefore reported as possibly throwing
  although the native engine clones it silently, and the CI gate (`L2`
  `nudo:entry-may-throw`) turned legal code red. Cloneable shapes no longer
  record a throw.
- The shapes the native engine really rejects — functions, `Symbol`,
  `WeakMap` / `WeakSet` / `WeakRef`, `Promise`, generators, and objects
  carrying a function-valued property — were reported as `TypeError`, while
  the host throws a `DOMException` whose name is `DataCloneError`. The throws
  face now carries `DataCloneError`, so `@nudo:throws DataCloneError` is
  accepted and the diagnostic text matches the host.
- The argument contract is classified by the **shape** of the argument (never
  by feeding an abstract value into the host): primitives and cloneable
  containers are cloneable, `fn` / `symbol` / `eff` / the `Weak` family are
  not, and an unconstrained (`any`) argument still honestly records a
  `DataCloneError` may-throw.
