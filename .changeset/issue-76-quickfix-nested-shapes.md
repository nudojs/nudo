---
"@nudojs/core": minor
"@nudojs/service": minor
---

fix #76 (quickfix self-defeating `any()` + false-positive call-site errors):

- service/body-read-types: collect full member-read **paths** (`node.loc.start.line`), not just first-level keys. Dereferenced intermediate fields materialize as **nested shapes** (`loc: shape({ start: shape({ line: any() }) })`) instead of `any()` — an `any()` slot value keeps its member reads counted as may-throw, so the generated contract could not clear the L2 it targeted (issue: 1/7 warnings cleared; now the nested-read cases clear too). Method accesses (`.toLowerCase()`) still type the field directly and stop the chain. `BodyReadField` gains optional `fields?: BodyReadField[]`; `shapeDslFromFields` recurses.
- core/scan: `any` actuals against a shape precondition are no longer `nudo:constraint-violated` errors — no info, don't guess, matching the scalar-pred channel ("any ≤ 任意目标") and the same function's `unknown` handling. Determined non-object and missing-field actuals still violate (controls pinned).
