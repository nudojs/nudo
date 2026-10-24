---
"@nudojs/core": patch
---

Union and nullable contracts now enforce their members, and a bigint literal
contract is no longer a contract that can never fail.

- A contract written as a union or as a nullable is instantiated into a
  disjunction of atoms, and the enforcement side decides each atom on its
  own. The atoms that carry a nullish literal could not be decided — the
  literal value of `undefined` cannot be told apart from "no value" — so
  the disjunction was reported as "cannot tell" and the whole contract was
  skipped. Every argument outside the contract passed silently. The nullish
  atoms are now decided on their own terms, with `null` and `undefined` kept
  as two separate domains, so `f(0)` against `union(number().gt(0),
  lit(null))` is reported while `f(3)` still passes.
- A union over primitive types is instantiated into `typeof` atoms, and those
  atoms could not be decided either, which left contracts such as
  `union(number(), string())` without any enforceable content. The decision
  side now reads the primitive shape of the argument and compares it with the
  type the atom asks for, so `f(true)` against `union(number(), string())` is
  reported.
- `lit(1n)` was instantiated into an equality atom whose literal side could
  not be read, because only number, string and boolean were recognised as
  literal values. The atom was therefore never decidable and the contract
  accepted every argument: `f(2)` against `lit(1n)` passed. Bigint literals
  are read as literals now, and the expected value keeps its `n` suffix in
  the diagnostic.
