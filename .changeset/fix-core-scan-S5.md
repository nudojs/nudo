---
"@nudojs/core": patch
"@nudojs/service": patch
---

Regression pins for three call-site contract enforcement reports whose
symptoms are already gone. No behaviour changes: these bugs were fixed
earlier (by the `lit(null)` / `lit(undefined)` literal fix, by the
`export default` dts export-name fix, and by resolving a callee's
`@nudo:import` sidecar against the callee's own directory). The pins
exist so the fixed behaviour cannot silently regress.

- A parameter whose contract is exactly `lit(null)` or `lit(undefined)`
  now has a pin that spells out both directions: the one allowed value
  passes with no diagnostic, and every other value is reported as a
  violation. `null` and `undefined` are two distinct domains, so
  `lit(null)` rejects `undefined` and `lit(undefined)` rejects `null`.
  The pin also records that a bare literal contract (one `eq` atom) and
  a `union` / `nullable` contract (nullish as a *member*) are different
  shapes handled by different channels; only the bare literal shape is
  pinned here.
- The dts projection now has a pin for all four `export default` shapes
  — named function, class, anonymous function and arrow — and asserts
  that the emitted export name is `default` in each case, so a default
  export can no longer be projected as a named export that does not exist
  at runtime.
- A cross-file call now has a pin that the callee's sidecar is resolved
  against the callee's directory, not the caller's: the sidecar next to
  the callee loads without an `nudo:interface-load` or
  `nudo:contract-syntax` diagnostic, and the call site still reports the
  real precondition violation.
