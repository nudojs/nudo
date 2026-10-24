---
"@nudojs/service": patch
---

`nudo export --format dts` now derives its parameter table from the declared
formals instead of from the observed call arity, and renders optionality the
way TypeScript means it.

- The parameter table used to be cut to the number of arguments seen at call
  sites, so a rest parameter produced `export declare function sum(...xs:
  number): number;` — not valid TypeScript (`TS2370`) — and a second call
  shape appended `arg1` / `arg2` after the rest parameter (`TS1014`). The
  table now follows the declared formals: a rest parameter absorbs the
  trailing arguments and is always last, and its type is promoted to an
  array.
- A parameter declared by a contract but never exercised by a case used to
  disappear from the `.d.ts` (`addAll(a: number)` for a two-parameter
  contract), while `nudo check`, the zod face and the standard face all kept
  it. The declaration is now authoritative for the table's length; cases only
  contribute types.
- A parameter with a default value was rendered as required, so consumers
  calling `def()` or `optNoEvidence(1)` — both legal in the implementation —
  hit `TS2554`. Optionality now comes from the contract, then from the
  declared default, then from the shortest observed call.
- A contract that marks a top-level parameter optional
  (`number().optional()`) lost that marker in the `.d.ts` and rejected calls
  the contract allows (`TS2345`). The contract face now carries the
  optionality flag and the declaration renders `x?: number`.
- A destructured parameter lost the whole handwritten contract and was
  declared `act(_p0: unknown)`, leaving TypeScript consumers with no type
  checking at all. The contract's field-level entries are now projected into
  the parameter's shape and the declaration uses the binding-pattern name
  (`act({ a, b }: { a: number; b: number })`).
- Optional object slots were rendered as `k: T | undefined`, which in
  TypeScript still requires the key — the projection was *stricter* than the
  contract, the zod face, the standard face and `nudo check`, and rejected
  values those four accept (`TS2345` / `TS2741`). They are now rendered as
  the optional property `k?: T`, matching the `?` already used for top-level
  parameters.
