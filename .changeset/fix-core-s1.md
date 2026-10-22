---
"@nudojs/core": patch
---

The constraint builders now reject arguments they cannot honor, instead of
turning them into a weaker or empty contract.

- `length(...)` accepts a finite numeric bound only, like its sibling
  builders. `string().length(NaN)` used to build a contract that no string
  could satisfy, and `string().length("3")` used to build a contract that was
  never checked at all; both are refused while the contract is built.
- `shape(...)` takes an object of field constraints. A number, an array or a
  string used to collapse the whole shape into an empty one — the contract
  then held for every object — and a missing argument reported the raw
  `TypeError` of the host. Both now report which builder got the wrong
  argument.
- `array(...)` requires an element constraint. Without one the element became
  `undefined`, so every ordinary array argument was reported as a violation.
  Write `array(lit(undefined))` when undefined elements are meant.
- The field tables of `shape`, `partial`, `omit` and `pick` are built without a
  prototype. A field named `__proto__` was written as the prototype of the
  table instead of a key of its own, so the field vanished from the contract
  and the check accepted every argument. The field survives now, and the
  builders report a field table that lost a key instead of quietly accepting a
  weaker contract.
