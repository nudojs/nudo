---
"@nudojs/core": patch
---

Fix false `entry-may-throw` reports under three guard forms over optional slots / nullable params (issue #118): (1) member truthy guards — `if (o.p)` truthy arm / `if (!o.p)` fall-through now rebind the base to `$removeMemberNullish($removeNullish(o), key)`, stripping nullish members of the slot value **and** the `optional` flag (the `$get` join with `undefined` was the FP source for `property 'grade' on undefined`); (2) composite mixed disjunction/conjunction — `!doc || typeof doc !== 'object'` fall-through now narrows `doc` (a single side that is itself a nullish guard suffices; both-sides-different-names stays conservatively un-narrowed); (3) optional-chain truthy guards — `if (!files?.length)` fall-through narrows `files` before `for (const f of files)` (no more `iteration over possibly non-iterable value`). Single-level member paths only (computed keys and nested `o.p.q` guards are not recognized); unguarded reads/iterations still report.
