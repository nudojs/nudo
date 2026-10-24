---
"@nudojs/core": patch
---

`nudo check` no longer reports an assignment that only fails a refinement
it never carried, and no longer attaches the callee's own precision to
every call site.

- **Assignments are compared by shape.** `nudo:assign-mismatch` used to
  demand that the new value also imply every refinement the *previous*
  value carried. That refinement is usually a fact about the **caller's**
  variable, not a constraint on the binding being assigned: in `ms@2.1.3`
  the statement `str = String(str)` compares a new `string` against an old
  `string` whose refinement said `typeof text = "string"` (derived at the
  call site `parseAge("2d")`). The two have the same shape — the
  assignment is sound at runtime — yet the gate reported
  `str: assignment ⊭ existing shape` and turned
  `nudo check docs/examples/retire-real/after/src/age.js` red. The gate
  now compares the **shape** of the binding, which is what its own
  message promises: shape changes (`let n = 1; n = "str"`), missing
  members (`let a = {x: 1}; a = {y: 2}`) and element retypes are still
  reported, and conditional reassignments are still exempt.
- **Call sites no longer report the callee's precision.** Wiring the
  call-site verification into `nudo check` also started emitting
  `nudo:partial-result` for every call whose callee had a partial or
  opaque result. That is the callee's own precision problem, not the
  call site's, and it filled the info channel with one line per call —
  it moved the documented `nudo check` summary of the troubleshooting and
  errors-versus-TypeScript guides from `0 info` / `1 info` to `1 info` /
  `2 info`. The product path no longer emits it. The code and the
  `checkCall` public API that has always reported it are unchanged.
