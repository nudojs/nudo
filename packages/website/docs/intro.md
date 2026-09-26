---
slug: /intro
description: Nudo lets developers see variables close to runtime inside the source — per-variable precise derivations, not broad type names; contracts sharper than types; logic stays JavaScript.
---

# Introduction

**Nudo exists for one outcome: see variables close to how they look at runtime, right in the source.**

When reading code, one usually sees only broad type names (`number`, `string`), often with another layer of annotations. Nudo executes JavaScript on abstract values so each variable carries what it will actually compute — literals, shapes, constraints — surfaced next to the source as signatures, IDE inlays, and call-site evidence.

```javascript
// calc.js
export function scale(x) {
  return x + 1;
}

scale(5);
scale(0); // if the contract requires x > 0
```

In the IDE, intermediates show a runtime-adjacent form per line, not a single type name:

```text
scale(x)          x: number · x > 0        // from contract or call sites
  return x + 1    term (x + 1) · > 1       // derivation, not "number"
scale(5)          => 6  #exact             // call site is runtime truth
scale(0)          ⊭ x > 0                  // actual 0 · expected x > 0
```

`nudo check` provides the same observation face on the command line (signatures print even on success). When obligations are needed, declare them as sidecar contracts (`*.nudo.js` / `@nudo:contract`); violations report **values and predicates**, not type names.

```text
signatures
  scale(x: number) => number

issues
  [ERROR …] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
```

[Open in the Playground](/playground).

**Product face:** **Observation** (Day 0) = `nudo check` (signatures and diagnostics). **Contracts** (Day 1) = `nudo contract` + `nudo check` (explicit contracts). Ecosystem = `nudo export` (one-way Abs projections to `.d.ts` / schemas). Observation lives in check signatures and IDE hover — there is no separate observation verb. `nudo test` is an optional debug case reporter.

## How this is achieved: execution, not annotations

The goal is runtime-adjacent variables in the source. The method is **executing code on abstract values (Abs)**:

1. **Execution produces facts.** The engine evaluates on symbolic values and records each intermediate’s shape, value identity, and constraints — not inferred from annotations.
2. **Call sites are evidence.** `scale(5) => 6` comes from an actual call path, not a comment.
3. **Constraints participate in algebra.** `x > 0` implies `(x + 1) > 1`, so inlays show relations that can be reasoned about, not only type names.
4. **Annotations are never required.** Sources stay plain `.js`; contracts are JS modules.

Deeper: [Abstract interpretation](./concepts/abstract-interpretation.md) · [Abs](./concepts/abs.md).

## How to use these docs

| You are | Start here |
|---------|------------|
| JS engineer evaluating a type/check gate | [Mental model](./getting-started/mental-model.md) → [Quick Start](./getting-started/quick-start.md) → [nudo check](./guides/check.md) |
| TypeScript user | [Nudo vs TypeScript](./guides/vs-typescript.md) → [Migrate from TS](./guides/migrating-from-typescript.md) |
| Existing JS package | [Migrating existing JS](./guides/migrating-js.md) → [Contracts](./guides/contract.md) |
| Automated workflow / platform | [Recipes](./guides/recipes.md) → [Diagnostics](./reference/diagnostics.md) → [Error faces](./guides/error-faces.md) |
| AI coding agent / tooling | [Agents](./reference/agents.md) → [Agent integration](./guides/agent-integration.md) → [API · agent](./api/agent.md) |

Non-goals: Nudo is **not** a TypeScript compiler; it does not invent required slots from body AST scans; `@nudo:case` is debug-only and never the contract product. See [Limits](./concepts/limits.md).

## Observation vs Contracts

| Layer | What you write | What you get |
|-------|----------------|--------------|
| **Observation** (Day 0) | Plain JS + call sites | `check` signatures and L2 entry may-throw diagnostics |
| **Contracts** (Day 1) | `*.nudo.js` / `@nudo:contract` | L1 obligations (`actual ⊭ expected`) |
| **Ecosystem** | nothing extra | `export` projections: dts / guard / schema |
| **Advanced** | Abs algebra, envs, mocks | String/number algebra, HOFs, module graphs |

![Observation → Contracts → Ecosystem](/img/day0-day1-ecosystem.svg)

*Obligation increases; `any` is unconstrained, `unknown` is inference failure.*

## Relation to declared types

| | TypeScript | Nudo |
|---|---|---|
| Variable presentation | Declared type names | Runtime-adjacent values / shapes / constraints |
| Contracts | Type language + assignability | Sidecar builders + L2 entry throws |
| Precision | Often widens to `string` / `number` | Can keep literals, template structure, loop sums |
| Source of truth | Source annotations | Abs from execution; projections are lossy and one-way |

Comparison: [Nudo vs TypeScript](./guides/vs-typescript.md). Limits: [what Nudo does not claim](./concepts/limits.md).

## Next

- **[Why Nudo](./why-nudo.md)** — needs and answers
- **[Mental model](./getting-started/mental-model.md)**
- **[Installation](./getting-started/installation.md)**
- **[Quick Start](./getting-started/quick-start.md)**
- **[nudo check](./guides/check.md)**
- **[Contracts](./guides/contract.md)**
- **[Abstract interpretation](./concepts/abstract-interpretation.md)** — how runtime-adjacent variables are computed
- **[Abs](./concepts/abs.md)** — `shape × term × pred × conf`
- **[Playground](/playground)**
- **[Diagnostics](./reference/diagnostics.md)**
- **[Agents](./reference/agents.md)**
