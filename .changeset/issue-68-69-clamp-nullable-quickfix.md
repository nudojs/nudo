---
"@nudojs/core": minor
"@nudojs/service": minor
"@nudojs/lsp": minor
"nudojs": minor
---

feat: clamp bounds + scalar-over-sum + action-map quickfixes (#68 #69)

## #68 inference

- `Math.min` / `Math.max` / `Math.round` (and floor/ceil/trunc) propagate
  operand numeric bounds: `max(0, min(100, n))` derives `[0, 100]`.
- NaN is explicit (option 1): a possibly-NaN operand yields `NaN | number@bounds`,
  so clamp contracts stay honest; `if (Number.isNaN(n)) return …` narrows the
  false arm (`ne(n, NaN)`) and the guarded clamp is provable.
- Scalar return contracts now distribute over sum arms like shape/array
  (`nullable(c)` + multi-return `null | number` is provable). Gold-FP
  protection kept: any-widened bare-prim arms downgrade siblings to
  `unproven-return` warnings instead of errors.

## #69 DX

- `actionsForIssue` kinds are materialized as LSP quickfixes with
  `[fix]` / `[silence]` / `[review]` / `[adjust]` / `[scaffold]` titles.
- `nudo check --fix [--only <code>] [--write]` reuses the same edit layer
  (default dry-run prints unified diffs).
- Body-read fields auto-fill types from usage (`node.type === "x"` →
  `string()`, arith → `number()`, no evidence → `any()`); never emit empty
  `shape({})`.
- L2 `entry-may-throw` suggestions include a copyable sidecar clause.
