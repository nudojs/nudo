---
"@nudojs/core": patch
---

fix(check): return-shape contract distributes over branch sums

`checkReturnConstraint` only accepted `ret.shape.k === "obj"`, so a return value
that is a **sum** (e.g. `if (flag) obj.extra = x; return obj;` — the two branch
shapes join into a sum when their key sets differ) was reported as
`nudo:constraint-violated` even when every member satisfied the declared
`shape({...})` contract. Real-world hit: sidecar `fn({...}, shape({...}))`
returns with a conditional field.

Shape contracts now recurse into sum members (each member must satisfy the
contract, issues deduped). Scalar contracts (prim / numeric bounds / domain)
still do not distribute: sum members can be operator-derived unions from
unconstrained operands (`any + any` → `number | string`) and reporting those
is a false positive per the check-gold precision discipline.
