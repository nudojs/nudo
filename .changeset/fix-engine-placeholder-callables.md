---
"@nudojs/core": patch
---

Placeholder-callable cluster (root-cause class C5) from the differential
bug report: the generator `@@iterator` slot is now a self-returning
method (`it[Symbol.iterator]() === it` folds true; re-entering through
the slot — `.next()` / spread — no longer proves a phantom TypeError)
(Bug 83); user-class instance/static method first-class values carry an
`apply` hook that re-enters ordinary dispatch with the caller-supplied
receiver, so borrowed `m.call(c)` / `m.apply(c, [])` / `m.bind(c)()` and
HOF-passed method values fold the real result instead of exact
`undefined` (Bug 89). Bug 12 (WeakMap/WeakSet method calls) was already
fixed by a prior wave (verified, no change).
