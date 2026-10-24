---
"@nudojs/service": patch
---

Emit products: the zod `number` schema now covers the whole JavaScript number
domain, the type guards are valid TypeScript, and a literal that only came
from an uncertain observation is no longer projected as the exit domain.

- **The zod schema rejected the very value the exported function returned.**
  An Abs `number` primitive covers every JavaScript number, NaN and
  ±Infinity included, but zod's `z.number()` only accepts finite numbers (its
  parse requires `!Number.isNaN(input) && Number.isFinite(input)`). The
  projection was therefore *narrower* than the type it claims to describe: a
  function returning `0 / 0` was described by a schema that rejected its own
  return value, so consumers validating the result got a false red. The zod
  dialect now widens an unrefined `number` to the full domain
  (`z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity))`).
  A `number` that carries a refinement keeps the narrow form, because the
  refinement itself already excludes the non-finite values (`x > 5`,
  `Number.isInteger(x)`). The shared schema node is unchanged, so the
  standard dialect keeps its current (NaN-accepting) number check.
- **The generated type guards did not compile.** `<file>.nudo.guard.ts` is a
  TypeScript file, but the guard signature carried no type annotation
  (`export function isUserOutput(data) { … }`), so under `tsc --noEmit
  --strict` the parameter was an implicit `any` (`TS7006`) and the product
  could not be used in a strict project. The guards now take `value: unknown`
  and return `boolean`; inside the body the checked value is narrowed to the
  narrowest type that lets the predicate compile — the primitive type for a
  primitive or literal, a dynamic object shape for a structural form, and the
  union of the member types for a union. Only built-in TypeScript type names
  are used, so a product never references a user class name (`TS2304`).
- **A literal observed once was projected as if it were the exit domain.**
  When the only evidence about a return value is an uncertain observation (a
  join of several call sites, a mock, or a fallback evaluation), its literal
  is not the function's exit domain: a rest parameter observed through the
  fallback evaluation was projected as `literal(1)` by the zod, standard and
  guard dialects, and those products then rejected the exported function's
  own return value. Literals from uncertain observations are now widened to
  their base type in all three dialects, and the widening is recorded in the
  `dropped` ledger. Literals that are certain (`exact` confidence) and
  literals coming from a hand-written contract keep their exact form.
