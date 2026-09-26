---
slug: /concepts/limits
description: Limits and non-goals — what Nudo does not claim, call-site ceilings, evaluator gaps, and the TypeScript type-language boundary.
---

# Limits & non-goals

Boundaries are product discipline, not bugs. This page is the user-facing extract of design limits — full engineering notes live in the monorepo (`docs/design/limitations.md`). Comparison of replacement dimensions: [Nudo vs TypeScript](../guides/vs-typescript.md).

## Non-goals

1. **Not a TypeScript compiler.** Nudo does not reimplement `tsc` project references, declaration merging, or full assignability.
2. **No body-AST slot invention.** Obligations come from explicit contracts (`*.nudo.js` / `@nudo:contract`) or call-site facts — never from scanning the function body for “required fields” as check errors.
   - **`nudo:missing-slot` is observation, not obligation.** With `analysis.evalMissingSlot: "warning"` (default `"off"`), evaluation that actually hits a missing field on a known shape emits a **warning** — it never invents check errors; contracts still gate through `nudo:constraint-violated`.
3. **`@nudo:case` is debug only.** It feeds `nudo test` / LSP scenarios, not the contract product.
4. **`check` only validates.** Artifacts (`.d.ts`, Zod, guards) come from `nudo export` — one-way, lossy projections of Abs.
5. **HOF promote ≠ check error.** Body-usage promotion of HOF relations is a **warning** (suggestion). Only explicit refine / relation contracts are L1 errors.
6. **No observation verb.** Signatures and cases print from `check` / IDE; there is no `nudo infer` product verb.

## `any` vs `unknown`

Unconstrained entry params display as **`any`**; true **`unknown`** means inference failed (engine debt). Full contract (sources, operations, narrowing): [Abs — any vs unknown](./abs.md#any-vs-unknown).

## Call-site discovery ceiling

`--from` mines usage evidence. Honest boundaries:

| Category | Behavior |
|----------|----------|
| Runtime / native callbacks | No call records → `entry@` fallback |
| Functions never touched by tests | `entry@` (`any` params) — coverage gap, not inference failure |
| Nested functions | Not attributed from outer call records (correctness first) |
| Dual package entrypoints | browser/node records do not cross files. **Now signaled** — analyzing/checking one entry variant emits `nudo:dual-entry` (info; zero false-positives on single-entry packages). Still a ceiling, just no longer silent |
| Dynamic `require` / native | Literal / constant-folded specs resolve; computed specs stay honest `unknown`. Env may type the name; side effects need mocks |

## Evaluator gaps (summary)

Some constructs still degrade (with honest shapes, not false precision): JSX → `unknown`; `import.meta` → `{ url: string }`; `import()` → `Promise` of an open module namespace; mixed `+` that cannot decide number vs concat → `number | string`. Prefer the modeled alternatives in [Language semantics](../concepts/semantics.md).

Env harvest coverage rates are **not** completeness promises.

**`/// @nudo:env <name>` loads named envs into both `check` and `test`.** Named envs (`es` / `web` / `node`) are injected into the symbolic path so `nudo check` prints the same signatures as `nudo test`. Functions that never touch env APIs are not collateral-degraded. When an env cannot be resolved (e.g. a path-based `@nudo:env ./missing.ts`), only the functions that actually reference free identifiers (env-provided globals) fail-closed to `unknown` — pure functions stay precise.

## Predicate implication (bounded)

`nudo check`’s L1 gate is Pred implication on Abs (`actual ⊭ expected`). The built-in prover is deliberately bounded — it covers the linear fragment and equality-class goals, not all of arithmetic:

| Fragment | Built-in |
|----------|----------|
| Linear forms (`+` / `-` / `*const`), cross-term interval synthesis | yes |
| Equality-class (`x = y`), `ne` tightened to strict bounds | yes |
| Conjunction targets; and/or commutative equality | yes |
| Nonlinear (`x * y`, powers) / quantifiers | **incomplete by design** — fail-closed |

When the built-in side cannot discharge a goal, the goal is simply not promoted. An optional escape hatch exists for embedders:

```js
import { setImplicationOracle, getImplicationOracle } from "@nudojs/core";

// ImplicationOracle = (phi, pred) => boolean | undefined
// true → lift the goal; false / undefined → stay fail-closed
setImplicationOracle((phi, pred) => mySolverImplies(phi, pred));
```

- **Off by default.** Nudo ships with no solver dependency; the built-in fragment is the product gate. The oracle is consulted only when the built-in side cannot prove a goal, and only a `true` answer lifts it.
- **Power feature, not the product face.** Outwardly Nudo is a JS engineering gate — not a theorem prover / SMT product. No proof certificates, no “verified” claims.
- **Fail-closed either way.** Without an oracle (or when it returns `false` / `undefined`), an unprovable goal stays unproven.

The algebra this gate sits on: [Abs](./abs.md). Why this is not a prover: [Competitive landscape](../guides/competitive-landscape.md).

## TypeScript type-language boundary

Nudo replaces `tsc` as the **check gate**; it does not reimplement the TypeScript **type language**:

- Conditional / mapped / template-literal types as programming devices are **non-goals**
- Declaration merging and project references are not product IR
- The gate is Pred implication on Abs (and some `leqAbs`), not bit-for-bit `tsc` assignability
- No soundness claims

If **the product is the type language itself** (type-level libraries, DefinitelyTyped-style surfaces), use TypeScript for that work. For ordinary packages, the gate still ends at `nudo check` + `nudo migrate retire` — the tree being `.ts` today is not a reason to keep `tsc` (annotations strip; `migrate` is one-way).

Comparison: [Nudo vs TypeScript](../guides/vs-typescript.md). Migration coexistence: [guide](../guides/coexistence.md).

## What is disciplined product behavior (do not “fix” as bugs)

- Success still prints `signatures` from `check` (not silent)
- L2 only gates **entry/export** may-throw, not every internal helper
- Drafts never auto-bind as contracts
- Projections never round-trip into analysis

## Next

- [Abs](./abs.md)
- [nudo check](../guides/check.md)
- [Diagnostics](../reference/diagnostics.md)
- [vs TypeScript](../guides/vs-typescript.md)
