---
"@nudojs/core": patch
---

fix(contract): array return contracts distribute over sum arms

`assertImplies` distributed **shape** contracts (`constraint.fields`) over the
members of a `sum` return value, but the **array** branch was reached with the
sum still intact and rejected it outright:

```
return shape sum ⊭ array(...)
```

Any function built from the idiomatic "start empty, push conditionally" shape
therefore reported a false `nudo:constraint-violated`:

```js
export function pick(n) {
  const out = [];
  if (n > 0) out.push(n);
  return out;          // [] | [n]  ⊭  array(number().gt(0))
}
```

Each arm is an array on its own (`[]` and `[n]` both satisfy the contract), so
the sum is too. Array contracts are structural like shape contracts, so they
now distribute over sum members the same way (`any`-derived members are still
skipped, keeping the existing gold-FP protection). Non-array arms still report.

Measured on a consumer project (npm-safe): `vetoFindings` / `decide` return
contracts went from `nudo:constraint-violated` errors to clean, with no other
diagnostic movement.
