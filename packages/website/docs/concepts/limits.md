---
slug: /concepts/limits
description: Honest limits and non-goals — what Nudo does not claim, call-site ceilings, and when TypeScript should stay primary.
---

# Limits & non-goals

**You'll leave with:** where Nudo is the right JS-first gate, where it is not, and which boundaries are product discipline (not bugs).

Young tools earn trust by being explicit. This page is the user-facing extract of design limits — full engineering notes live in the monorepo (`docs/design/limitations.md`).

## Non-goals

1. **Not a TypeScript compiler.** Nudo does not reimplement `tsc` project references, declaration merging, or full assignability.
2. **No body-AST slot invention.** Obligations come from explicit contracts (`*.nudo.js` / `@nudo:refine`) or call-site facts — never from scanning the function body for “required fields” as check errors.
   - **`nudo:missing-slot` is observation, not obligation.** With `analysis.evalMissingSlot: "warning"` (default `"off"`), evaluation that actually hits a missing field on a known shape emits a **warning** — it never invents check errors; contracts still gate through `nudo:constraint-violated`.
3. **`@nudo:case` is debug only.** It feeds `nudo test` / LSP scenarios, not the contract product.
4. **`check` only validates.** Artifacts (`.d.ts`, Zod, guards) come from `nudo export` — one-way, lossy projections of Abs.
5. **HOF promote ≠ check error.** Body-usage promotion of HOF relations is a **warning** (suggestion). Only explicit refine / relation contracts are L1 errors.
6. **No observation verb.** Signatures and cases print from `check` / IDE; there is no `nudo infer` product verb.

## `any` vs `unknown`

Unconstrained entry params display as **`any`**; true **`unknown`** means inference failed (engine debt). Full contract (sources, operations, narrowing): [Abs — any vs unknown](./type-values.md#any-vs-unknown).

## Call-site discovery ceiling

`--from` mines usage evidence. Honest boundaries:

| Category | Behavior |
|----------|----------|
| Runtime / native callbacks | No call records → `entry@` fallback |
| Functions never touched by tests | `entry@` (`any` params) — coverage gap, not inference failure |
| Nested functions | Not attributed from outer call records (correctness first) |
| Dual package entrypoints | browser/node records do not cross files |
| Dynamic `require` / native | Literal / constant-folded specs resolve; computed specs stay honest `unknown`. Env may type the name; side effects need mocks |

## Evaluator gaps (summary)

Some constructs still degrade (with honest shapes, not false precision): JSX → `unknown`; `import.meta` → `{ url: string }`; `import()` → `Promise` of an open module namespace; mixed `+` that cannot decide number vs concat → `number | string`. Prefer the modeled alternatives in [Language semantics](../concepts/semantics.md).

Env harvest coverage rates are **not** completeness promises.

**`/// @nudo:env <name>` degrades the `check` face (known gap).** A file declaring an env directive currently loses the symbolic face entirely: `nudo check` prints `unknown` plus `nudo:unknown-inference` for every function — including ones that never touch env APIs — while `nudo test` (per-call-site evaluation) stays precise on the same file:

```text
$ nudo check envfile.js        # /// @nudo:env node + home() { return process.cwd(); }
  home() => unknown            # warning: signature has true unknown (inference failed)

$ nudo test envfile.js
  call@L7  () => string        # per-call-site result is precise
```

Workaround while the symbolic path learns env injection: rely on `nudo test` / IDE hover for env-bearing files, or move env-dependent code behind a module boundary that the checked file imports.

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

The algebra this gate sits on: [Abs](./type-values.md). Why this is not a prover: [Competitive landscape](../guides/competitive-landscape.md).

## When TypeScript should stay primary

- The codebase is `.ts`-first and annotations/generics are the product
- You need the full TS type language (conditional/mapped types as programming)
- Ecosystem is DefinitelyTyped / project references
- The gate you need is “assigns like tsc”

Honest map: [Nudo vs TypeScript](../guides/vs-typescript.md). Coexistence: [guide](../guides/coexistence.md).

## What is disciplined product behavior (do not “fix” as bugs)

- Success still prints `signatures` from `check` (not silent)
- L2 only gates **entry/export** may-throw, not every internal helper
- Drafts never auto-bind as contracts
- Projections never round-trip into analysis

## Next

- [Abs](./type-values.md)
- [nudo check](../guides/check.md)
- [Diagnostics](../reference/diagnostics.md)
- [vs TypeScript](../guides/vs-typescript.md)
