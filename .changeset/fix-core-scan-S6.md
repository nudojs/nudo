---
"@nudojs/core": patch
---

Union, nullable and literal contracts no longer skip legal arguments, and
arguments that cannot possibly satisfy a literal contract are no longer
let through.

- A union or nullable contract was reported as violated for *every* nullish
  argument, before the disjunction was looked at branch by branch. An
  argument that satisfies one of the branches — `null` against
  `union(number().gt(0), lit(null))`, `undefined` against
  `nullable(number().gt(0))` — was still reported. The disjunction is now
  decided branch by branch and one satisfied branch is enough to pass.
  `null` and `undefined` remain two separate domains, so `null` against
  `union(number().gt(0), lit(undefined))` is still reported.
- An argument that is not a scalar literal — an object, an array, a bigint —
  was skipped by the literal branch altogether, so a contract such as
  `lit(1n)` accepted every such argument. The literal branch now reaches
  those arguments: a definite mismatch in the argument's shape is reported
  as a violation, while an argument whose shape cannot be determined is
  still left alone. A disjunction is decided the same way, and a branch
  that is known to fail is now enough to report the violation even when
  another branch cannot be decided.
- A bigint literal argument (`f(1n)`) could not be read at the call site,
  so the call site had nothing to enforce and was skipped in function
  bodies. Bigint literals are read now, so `f(2n)` against `lit(1n)` is
  reported and `f(1n)` against `lit(1n)` passes.
- The two places that judge literal identity answer different questions and
  keep their own answers: the assignment side asks whether two values are
  the same value (`Object.is`, so `-0` and `0` differ), while the contract
  side asks whether a value falls inside a contract's domain (`===` plus a
  `NaN` special case, so `-0` *is* `0`). A pin now records this division so
  the two are not made to look alike later.
