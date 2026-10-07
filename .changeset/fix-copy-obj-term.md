---
"@nudojs/core": patch
---

Preserve `term`/`pred` when `$copy` snapshots obj-shaped Abs values. `objOf` builds values without a term slot, so the obj branch of `$copy` (unlike tuple/arr/sum/eff/brand) silently dropped them; args crossing the export bridge lost their terms, every level of a recursive call collapsed to the same `callBudgetKey` fingerprint, and the cycle guard cut parent/child frames as a false cycle — the truncated `unknown#opaque` result then poisoned signatures and return-contract proofs (surfaced by issue #120's recursive `lazy` templates).
