---
"@nudojs/core": patch
---

Logical assignment (`||=` / `&&=` / `??=`) only writes in the branch that
actually assigns.

Only the branch that performs the assignment does a PutValue — `o.a ||= 2`
does not write when the left-hand side is truthy (no setter call, no
`TypeError` on a read-only accessor). The write-back used to wrap the whole
short-circuit result, so the "keep the original value" branch wrote as well:
a getter-only property raised a spurious `TypeError` (the `nudo check` gate
reported `may throw TypeError` for code that never throws) and a property
with a setter had its setter called one time too many.

The write-back now lives inside the assigning branch, while the "keep the
original value" branch just returns the value it read. The write-back root
joins the fork binding set, so a write performed inside a branch is joined
across branches instead of letting the later branch overwrite the earlier
one.
