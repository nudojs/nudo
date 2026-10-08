---
"@nudojs/core": patch
---

Propagate member truthy-guard facts into union containers (issue #129). `$removeMemberNullish` now classifies sum members per the guarded key: members whose slot is definitely nullish (closed shape without the key — lenient read yields `undefined` — or an all-nullish slot value) cannot survive the truthy arm and are pruned; members with `T | nullish` slot values or `optional` flags are rebuilt with the nullish members stripped and the flag dropped (same refinement the single-object branch has applied since #118). `if (!node.property) return` followed by a chained re-read `node.property.type` on a discriminated union with a lenient catch-all arm no longer records a false `property 'type' on undefined` may-throw. Open shapes (absent key reads unknown), `any`/`unknown` slot values, and non-object members stay conservatively; all-pruned sums pass through unchanged and single-member remainders collapse, matching `$narrowMemberEq` conventions.
