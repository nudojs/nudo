---
"@nudojs/core": minor
---

ABS-09: coinductive `leqAbs` for recursive types.

- `leqAbs` now keeps a path-scoped `(src, tgt)` assumption set: a pair already being checked is assumed to hold, which is the maximal-fixpoint semantics of equirecursive subtyping. Recursive lists/trees, mutually recursive shapes, and recursive brands no longer fail with `leq depth exceeded`.
- Assumptions are removed on exit (including failed branches), so a failure in one branch can never be rewritten as success on retry (no false greens).
- Genuine mismatches still report the shortest field path (`field value: ...`), not a depth failure.
- The depth guard stays as a bounded safety net for non-recursive deep structures (raised 32 → 64, since real recursion now terminates coinductively).
- New fixtures: isomorphic-but-distinct recursive lists, value-domain mismatch, mutual A/B recursion, recursive brand inner, and the deep-nesting safety net.
