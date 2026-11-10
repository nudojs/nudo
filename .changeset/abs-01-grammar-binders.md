---
"@nudojs/core": minor
"nudojs": minor
---

ABS-01: constraint / lemma grammar — arithmetic relations, dependent return contracts, and contract-internal binders.

- `@nudo:assume` and `@nudo:invariant` accept simple arithmetic expressions (`name`, `number`, `name ± number`): `@nudo:assume i + 1 <= n`, `@nudo:invariant i < n`. Multiplication / division / parentheses stay malformed with the existing fail-closed diagnostics.
- `@nudo:contract return <rel> <expr>` builds a dependent return obligation on the return term (`return > x`). IEEE-sound proof rule added for non-strict offset comparisons (`round(b + c) >= b`, `c >= 0`); strict `>` / `<` on unbounded operands report an honest unprovable warning (2^53 + 1 = 2^53 is a real counterexample), never a false red.
- Contract-internal binders: `bind(name, constraint)`, `ref(name)`, `ref(name).at(path)` with scope = one constraint tree. `EffectiveContract` carries a cross-slot binder table so `fn({...}, array(ref("b")))` can reference a binder declared in a callback slot. Unbound refs fail closed (`nudo:contract-load`) and never degrade to `any()`.
- Refs are resolved before proofs / instantiation / entry-Abs projection, so a ref slot cannot pass as an obligation-free `any()`.
- Public surface additive: `bind` / `ref` / `rel` builders plus `BinderTable` and resolver helpers (public API snapshot updated).
