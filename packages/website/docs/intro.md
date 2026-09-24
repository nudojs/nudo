---
slug: /intro
description: Nudo executes JavaScript, prints signatures on check, and gates contracts + entry throws — sharper than declared types.
---

# Introduction

**Welcome back to JavaScript.**

Your JS stays JS. **Nudo** does not restrict how you write JavaScript — it faithfully observes intermediate values and results, and enforces **contracts** sharper than ordinary TypeScript types.

Write plain `.js`. Optional sidecar contracts (`*.nudo.js` / `@nudo:refine`) when you need obligations. Even without explicit contracts, export boundary may-throw is gated (L2). Entry unconstrained params display as **`any`**; true **`unknown`** means inference failed.

**Product face:** Day 0 = `nudo check` (signatures + gate). Day 1 = `nudo contract` + `nudo check`. Ecosystem = `nudo export`. Observation is check signatures + IDE hover — there is **no** observation verb. `nudo test` is an optional debug case reporter, not the main path.

## How to use these docs

| You are | Start here |
|---------|------------|
| JS engineer evaluating a type/CI gate | [Mental model](./getting-started/mental-model.md) → [Quick Start](./getting-started/quick-start.md) → [nudo check](./guides/check.md) |
| TypeScript user | [Mental model](./getting-started/mental-model.md) → [Nudo vs TypeScript](./guides/vs-typescript.md) → [Migrate from TS](./guides/migrating-from-typescript.md) |
| **AI coding agent / tooling** | **[AI-native DX](./guides/ai-native-dx.md)** → [Agents](./reference/agents.md) → [Agent integration](./guides/agent-integration.md) |
| Existing JS package | [Migrating existing JS](./guides/migrating-js.md) → [Contracts](./guides/contract.md) |
| CI / platform | [Recipes](./guides/recipes.md) → [Diagnostics](./reference/diagnostics.md) → [Error faces](./guides/error-faces.md) |

Non-goals: Nudo is **not** a TypeScript compiler; it does not invent required slots from body AST scans; `@nudo:case` is debug-only and never the contract product. See [Limits](./concepts/limits.md).

## From source to gate

```javascript verify
// calc.js
export function scale(x) {
  return x + 1;
}

scale(5);
```

```javascript verify-sidecar
// calc.nudo.js — explicit contract (obligation)
import { number, fn } from "@nudojs/core";
export const scale = fn({ x: number().gt(0) }, number());
```

```bash
npx nudojs check calc.js
```

```text
signatures
  scale(x: number) => number
```

With a violating call `scale(0)`:

```text
issues
  [ERROR L6 scale] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
```

[Open this idea in the Playground](/playground).

In the IDE, the same Abs surfaces as inlay hints on intermediates — not only a return “type”.

## Day 0 vs Day 1

| Layer | What you write | What you get |
|-------|----------------|--------------|
| **Day 0** | Plain JS + call sites | `nudo check` signatures + L2 entry may-throw |
| **Day 1** | `*.nudo.js` / `@nudo:refine` | `nudo check` L1 obligations (`actual ⊭ expected`) |
| **Ecosystem** | nothing extra | `nudo export` dts / guard / schema (lossy Abs projections) |
| **Advanced** | Abs algebra, envs, mocks | String/number algebra, HOFs, module graphs |

`@nudo:case` remains available as a **debug witness** for scenario runs (`nudo test`, LSP case switching) — it is not the contract product.

## Why not “just TypeScript”

| | TypeScript | Nudo |
|---|---|---|
| Primary artifact | Declared types on `.ts` | Observed Abs from executing `.js` |
| Contracts | Type language + assignability | Sidecar `*.nudo.js` / `@nudo:refine` + L2 entry throws |
| Precision | Often widens (`string`, `number`) | Can keep literals, template structure, loop sums |
| Observation | Hover shows declared type | `check` signatures / IDE hover show term / pred / conf |
| CI gate | `tsc --noEmit` | `nudo check` (prints signatures on success too) |

`"a,b,c".split(",")` → `["a", "b", "c"]`. With `@nudo:refine x positive`, `scale` carries `(x + 1) > 1`. That is validation + observability, not a second type language.

Honest comparison: [Nudo vs TypeScript](./guides/vs-typescript.md). Limits: [what Nudo does not claim](./concepts/limits.md).

## What's next

- **[Mental model](./getting-started/mental-model.md)** — 10 minutes, no type language
- **[Why Nudo](./why-nudo.md)** — work modes, Abs contract face, ecosystem
- **[Installation](./getting-started/installation.md)** — CLI, VS Code extension, Vite plugin
- **[Quick Start](./getting-started/quick-start.md)** — first check + first contract
- **[Error faces](./guides/error-faces.md)** — violations next to `tsc`
- **[Contracts](./guides/contract.md)** — draft / accept / `nudo contract`
- **[nudo check](./guides/check.md)** — L1 + L2 gate on Abs
- **[Migrate from TypeScript](./guides/migrating-from-typescript.md)** — retire `tsc`
- **[Abs](./concepts/type-values.md)** — `shape × term × pred × conf`
- **[Directives](./concepts/directives.md)** — `@nudo:refine` / sidecar grammar (reference)
- **[Playground](/playground)** — browser observation
- **[Recipes](./guides/recipes.md)** — CI, monorepo, export
- **[Diagnostics](./reference/diagnostics.md)** — stable codes
- **[Agents](./reference/agents.md)** — agent-facing product rules
