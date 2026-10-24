---
"@nudojs/core": patch
---

`for` loop stepping now follows the UpdateExpression (`ToNumeric` ± 1)
semantics and no longer takes the step expression's value as the loop
state.

- A `for (let i = …; …; i++)` counter lowered `i++` to `$add(i, 1)`,
  which is the binary `+`: a bigint counter raised `TypeError`
  (`bigint + number` takes the mixed-bigint arm) and a string counter
  concatenated (`"5"++` is `6` natively, the engine produced `"51"`,
  `"511"`, … and ran to the iteration bound). The main `for` path now
  uses `$updateAdd` / `$updateSub`, matching the three other step
  lowerings in the tree.
- The step closure's return value was used as the `$for` state thread.
  For a sequence step (`i++, n++`) that value is the last element's
  value — the postfix increment's old value — so the loop variable
  stalled or over-ran (`for (let i = 0; i < 3; i++, n++) { n += 10 }`
  folded `11` instead of `33`). The step now only contributes side
  effects and the state thread is always the loop variable itself, the
  same contract the non-declaration `for` fallback path already used.
