---
"@nudojs/service": patch
---

`nudo contract` no longer loses recursive contracts, crashes on bigint
literals, or prints the contract's parameter names as the function's
formal parameter list.

- The contract surface cached constraints with
  `JSON.parse(JSON.stringify(c))`. A `lazy()` slot is a thunk (a
  function), and `JSON.stringify` silently drops function-valued
  properties, so a recursive constraint collapsed into an empty optional
  slot: the first run printed the expanded recursive shape, every later
  run printed `any().optional()`, and the cached surface was weaker than
  the `nudo check` gate for the same file. Constraints are now encoded
  with a dedicated codec: literals keep their type (`bigint`,
  `±Infinity`, `NaN`, `-0`, `undefined`), and a `lazy()` slot is stored
  as an index into a node table that is rebuilt into a thunk on read-back,
  so a cold run and a cache-hit run print the same thing.
- `JSON.stringify` cannot represent a `bigint`, so a contract with a
  bigint literal made the whole `nudo contract` command fail with a bare
  `Do not know how to serialize a BigInt` (exit 1, no file, no diagnostic
  code) while `nudo check`, `nudo health` and `nudo test` stayed green on
  the same file. Bigint literals are now encoded losslessly and the
  command prints the contract normally.
- The printed effective contract used the parameter names declared by the
  contract, so a contract binding `zzz` printed `(zzz: …)` for a function
  whose parameter is `x`, while `nudo check` printed `scale(x: any)` for
  the same file. The printed parameter list now comes from the declared
  formal parameter list (the same source as the `nudo check` signature),
  and a contract parameter that binds to no formal parameter is listed
  separately and marked `(not a formal parameter)` instead of taking over
  a parameter name.
