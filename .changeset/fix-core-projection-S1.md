---
"@nudojs/core": patch
"nudojs": patch
---

Type renderings no longer read as the wrong type, and `nudo check --what-if
--target` prints a real return domain instead of `?`.

- A function type inside an array or a union is now grouped with
  parentheses. `formatShape` rendered an array of functions as
  `(number) => number[]`, which TypeScript reads as "a function returning
  `number[]`" rather than "an array of functions", and rendered a union of a
  function and a number as `(number) => number | number`, where the `|` binds
  to the function's return type. The `.d.ts` renderer already grouped both,
  so the two renderers disagreed about the same abstract value. Function
  members and function elements are now parenthesized; other member kinds are
  unchanged.
- `nudo check --what-if --target <function>` printed `() => ?` for the
  targeted function: the top-level binding's abstract value carries no
  return type, while the signature table reads a different abstract value.
  The target now takes the function's real return domain, so the two faces
  agree; the `?` placeholder itself is unchanged.
