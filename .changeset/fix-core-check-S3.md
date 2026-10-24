---
"@nudojs/core": patch
---

Five `nudo check` diagnostics that never fired now fire, and three false
positives / wrong paths are gone.

- **Call-site verification is no longer dead code** (Bug 364). `checkArg` /
  `checkCall` had no producer, so the documented call-site verification
  surface was silent: `nudo:arg-count` and friends never appeared in
  `nudo check`. The call-site scan now runs the generalized parameter face
  check as well (`nudo:arg-count` for a missing required argument, the
  argument obligation codes, `nudo:partial-result` as info). Argument
  counting uses the *required* arity (default and rest parameters do not
  consume an argument slot), extra arguments are a warning rather than an
  error (JavaScript allows them), and `checkArg` now aligns the expected
  predicate with the argument's own term so a non-literal argument is no
  longer reported as `nudo:constraint-unproven` for a constraint it may well
  satisfy. `nudo:fn-not-found` stays on the public API only — whether a
  callee resolves is decided by the call-site scan.
- **`Error` covers user-defined Error subclasses** (Bug 365).
  `@nudo:throws Error` and `package.json#nudo.check.ignoreThrows: ["Error"]`
  promised `instanceof` semantics ("covers every subclass"), but coverage was
  decided with a static set of built-in names, so `class MyError extends
  Error {}` was not covered and the L2 gate reported a false positive. The
  decision now walks the runtime inheritance chain.
- **A bounded return obligation is only "disproved" when there is bound
  evidence** (Bug 370). The check asked "is there a predicate at all", so a
  `typeof` predicate counted as falsifiable evidence: the same obligation
  was an error for `return x` and a warning for `return x + 1`. With an
  unbounded `x` the obligation can neither be proven nor disproved, so the
  evidence test now looks for an actual bound (`gt` / `ge` / `lt` / `le`) in
  the combined evidence (`Φ ∧ ret.pred`).
- **CI annotations no longer point at a file that does not exist** (Bug 373).
  The GitHub Actions / GitLab Code Quality path trimmed the workspace root
  with a bare `startsWith`, so a sibling directory (`app` vs `app2`) was
  trimmed to `2/src/x.js`. The prefix now has to end on a path boundary.
- **Signature details no longer report the wrong function name** (Bug 377).
  The signature format cache was keyed by the `Abs` object identity, but the
  cached detail embeds the function name, so the second and third function
  sharing one `never` value showed the first function's name. The cache key
  now covers the function name as well.
