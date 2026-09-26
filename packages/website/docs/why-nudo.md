---
slug: /why-nudo
description: Why Nudo — per-variable precise derivations for code understanding; contracts sharper than type systems for robustness; logic and contracts stay JavaScript with no second type language.
---

# Why Nudo

JavaScript development rarely requires another type language. It requires three capabilities:

1. **Code understanding** — precise derivation of every variable, not a broad type name. Sources stay free of type annotations; there is no need to master a value language and a type language in parallel.
2. **Code robustness** — contracts that state conditions which must hold, sharper than type systems, checked and diagnosed during development.
3. **Language continuity** — logic remains JavaScript. The tool adapts to the code; the codebase is not rewritten into another language surface.

This page first examines whether a type system is required, then explains how Nudo answers.

## Do you need a type system?

When developers say they “want types,” they usually mean outcomes, not machinery:

| Actual goal | Common means | Limitation |
|---|---|---|
| See how each intermediate value is derived while reading | Type annotations in source | Annotations form a second language and distract from the code; they yield broad types without a derivation trail |
| Detect obvious errors before merge | `tsc --noEmit` | Structural assignability is not a runtime obligation (`0` is valid for `number`, not for `ms > 0`) |
| Constrain API boundary input | Zod-style runtime checks | Runtime boundary only; silent about how the function computes internally |
| Retain understanding over long-term maintenance | Comments and tests | Tests provide samples, not signatures; comments decay |

**Conclusion: what is required is precise behavior facts and checkable obligations — not necessarily a second type language.**

- **Readability** comes from per-variable derivation, not from annotation text.
- **Robustness** comes from precise, checkable constraints (bounds, shapes, entry may-throw), not from structural assignability.
- **Velocity** comes from JavaScript remaining JavaScript; contracts are JS modules, so there is no migration into a type language.

TypeScript encodes obligations as source annotations — capable, with explicit non-goals (no soundness promise, no reliance on runtime type information). Nudo takes a complementary path: **execute on JavaScript, observe from facts, diagnose through explicit contracts.**

## How Nudo answers

**Nudo executes JavaScript on abstract values, reports what the code actually computes, and validates the contracts you accept. Sources remain plain `.js`.**

| Goal | Code understanding | Code robustness | Language continuity |
|---|---|---|---|
| **Nudo** | per-variable precise derivations · `check` signatures · call-site evidence | contracts sharper than types · `actual ⊭ expected` | logic and contracts are JS · no annotation noise · Abs is the source of truth |

### 1. Code understanding — per-variable precise derivation

When reading code, Nudo provides the **exact derivation of each variable**, not a broad type name:

- IDE hover / inlay shows how intermediates are computed: term, constraints, confidence — observation granularity close to a debugger’s watch window, without executing the program.
- **Call sites are evidence**: `call@L18 (12, 3) => 36`, not “approximately `number`.”
- `nudo check` **prints signatures even on success** (params / return / may-throw); observation needs no separate command.
- **Sources stay free of type annotations**: plain JavaScript remains plain JavaScript; reading never requires switching between a value language and a type language.
- Unconstrained entry params display as **`any`**. True **`unknown`** means inference failed (engine debt) and is independent of coding style.

### 2. Code robustness — contracts sharper than types

Type systems usually express only “roughly this.” Contracts state the **conditions that must hold**:

| Type systems can state | Contracts can state |
|---|---|
| `number` | `ms > 0` |
| `{ host: string; port: number }` | `port ∈ [1, 65535]`; missing fields are rejected |
| returns `number` | returns `> 0` |
| (throws are not shown) | entry may throw `TypeError`, included in diagnostics |

Contracts live in a sidecar `*.nudo.js` or as `@nudo:contract` — **ordinary JS modules**:

```js
// logic.js
export function lineTotal(price, qty) {
  return price * qty;
}

// cart.nudo.js — contract (also JS)
import { number, fn } from "@nudojs/core";
export const lineTotal = fn(
  { price: number().gt(0), qty: number().ge(1) },
  number().gt(0)
);
```

```bash
npx nudojs check logic.js --from calls.js
```

Violations report **values and predicates**, not type names:

```text
actual:   0  #exact
expected: price > 0
→ use a value satisfying price > 0, or relax the precondition on price
fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

Diagnostics have two layers; neither requires a type language:

| Layer | Source | Examples |
|---|---|---|
| **L1 explicit contracts** | Accepted `*.nudo.js` / `@nudo:contract` | `price > 0`, missing shape fields, return bounds |
| **L2 entry may-throw** | JavaScript runtime export boundary (default: error) | `user.name` on `any` may throw `TypeError` |

No explicit contract does not mean no obligation: the fallback is JavaScript runtime boundary semantics. Entry may-throw reports as error by default; use `--ignore-throws` when intentional. `nudo check` provides checking and diagnostics and may be attached to any local or automated workflow.

### 3. Language continuity — one source of truth; project only for the ecosystem

- Logic is plain JavaScript; contracts are plain JavaScript. **Type annotations are never required.**
- `nudo check` **only validates**.
- `.d.ts` / Zod / Standard Schema / guards come from **`nudo export`** — one-way, **lossy** projections of Abs. Abs remains the source of truth.
- Use `nudo contract --draft` for a draft. **Accepting a draft creates the obligation**; nothing is invented silently.

```text
Logic first ──► contract draft ──► *.nudo.js ──┐
                                                ├──► nudo check  (validate only)
Contracts first ──► *.nudo.js / refine ────────┘         │
                                                          ▼
                         Abs (source of truth) ──► nudo export ──► .d.ts
                                                          │            Zod
                                                          │            Standard Schema
                                                          └──► IDE / LSP · Agent / MCP
```

There is no need to choose “types first” or “logic first.” Both orders meet on the **same contract face** (`shape × term × pred × conf`). The checker validates that face; it does not invent types.

## Why this is not “just annotations”

Annotations describe **what was written**, and often only broadly. Nudo’s engine **executes** logic on abstract values and records precise facts from that execution. Call sites are evidence, not comments.

| | Annotations / declared types | Nudo |
|---|---|---|
| Code understanding | Hover shows the broad type written in source | Per-variable derivation: intermediates, constraints, call-site truth |
| Cognitive load | Value language and type language in parallel | JavaScript only; contracts are JS modules as well |
| Code robustness | Structural assignability; often admits `0`; throws are invisible | Precise constraint implication + entry may-throw |
| Precision | Often widens to `string` / `number` | Can retain literals, template structure, loop sums |
| Source of truth | Source annotations | Abs from execution; projections are lossy and one-way |

Comparison: [Nudo vs TypeScript](./guides/vs-typescript.md). Violation shapes: [Error faces](./guides/error-faces.md).

## Scope of fit

- **JS-first packages** that need signatures, contracts, and a check gate without rewriting to TypeScript
- Teams that prioritize **runtime-shaped obligations** (bounds, shapes, entry throws) and **precise derivations** over annotation style
- Pipelines that need diagnostics and **mocks / schema** from the same facts
- Packages intended to **retire `tsc`** one-way (`nudo migrate`)

TypeScript should remain primary for annotation-first `.ts` codebases, heavy generic/conditional type programming, and ecosystems built around `tsc` project references. See [vs TypeScript](./guides/vs-typescript.md).

## Next

- [Mental model](./getting-started/mental-model.md) — Observation
- [Introduction](./intro.md) — product face and docs map
- [Quick Start](./getting-started/quick-start.md)
- [nudo check](./guides/check.md) — signatures and diagnostic gate
- [Error faces](./guides/error-faces.md) — actual / expected / fix
- [nudo contract](./guides/contract.md) — draft and accept
- [Limits](./concepts/limits.md) — what the engine does not claim
- [Migrate existing JS](./guides/migrating-js.md)
- [Playground](/playground)
