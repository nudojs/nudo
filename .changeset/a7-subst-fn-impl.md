---
"@nudojs/core": patch
---

Fix: `substAbs` no longer drops the fn impl side-table when rebuilding a fn shape (architecture debt A7, engine half of Bug 810).

- α instantiation (interface type-argument substitution in the harvester, and `instantiateReturn`'s return-type instantiation in the engine) rebuilt fn shapes without carrying the `attachFnImpl` side-table, silently degrading every substituted fn to a shape-only relation: the D path lost impl-exclusive data (`relation.inferFrom` / `condFallback` / `throws` / `fingerprint`), so generic method calls folded to `any`/`unknown` where the un-substituted signature was precise.
- Carrying discipline (`substFnImpl` in `hof.ts`): behavior facets (`apply` / `body` / closure env) and scalar facets (`params` / `kind` / `fnKind` / `length` / `optionalParams` / `bindThis` / `strict` / `effectFree` / `closed` / `pureName` / `fingerprint`) are α-independent and carried verbatim (`fingerprint` sharing matches the documented same-signature budget-key semantics); the `relation` slot is Abs data and is substituted by the map, sharing references with the substituted shape slots (the `relationFn` double-write discipline).
- The whole-α replacement path (map value is itself an impl-carrying fn) also keeps the impl instead of degrading to shape-only.
- The fn shape rebuild no longer drops `optionalParams` (Bug 399 per-position optionality) and `slots` (dual-facet callable-with-members), matching the `snapshotAbs` fn-branch discipline; slot values are substituted by the map.
