---
slug: /getting-started/mental-model
description: Nudo mental model — execute JS on abstract values, see runtime-adjacent variables in source; observation and contracts; call sites are evidence.
---

# Mental model

This page answers only: **how Nudo sees and computes your JavaScript**. The command surface lives in the [CLI guide](../guides/cli.md); migrating off `tsc` is linked at the end.

## The one-sentence model

Nudo **executes** your JavaScript on abstract values so variables carry runtime-adjacent values, shapes, and constraints — and reports what the code actually computes — then validates the **contracts** you accept. Sources stay plain `.js`.

| You write | Nudo does |
|-----------|-----------|
| Plain `.js` + call sites | Executes and observes: signatures, intermediates, call-site truth |
| Optional `*.nudo.js` / `@nudo:contract` | Validates obligations (`actual ⊭ expected`) |
| Nothing extra | Still diagnoses export may-throw (L2) |

There is **no second type language**. Contracts are ordinary JS modules with builders like `number().gt(0)`.

## Two layers: observation and contracts

| Layer | What you read | Source |
|----|------------|------|
| **Observation** | runtime-adjacent values / shapes / constraints | execution facts (call sites, paths) |
| **Contracts** | conditions that must hold; violations give `actual` / `expected` | declarations you accept (sidecar / `@nudo:contract`) |

Observation is not commentary; contracts are not type annotations.

```javascript verify
export function scale(x) {
  return x + 1;
}

scale(5);
scale(0); // violates the sidecar precondition below
```

```javascript verify-sidecar
import { number, fn } from "@nudojs/core";
export const scale = fn({ x: number().gt(0) }, number());
```

```text
signatures
  scale(x: number) => number

issues
  [ERROR L6 scale] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
```

The evidence from `scale(5)` keeps the entry from staying bare `any`; the contract turns `x > 0` into a checkable obligation. `if` is **not** a contract — obligations come only from declarations you accept.

## Why variables look runtime-adjacent

Because they are **computable Abs** (`shape × term × pred × conf`), not type names:

| Component | What you see on the product face | Meaning |
|------|----------------|------|
| **shape** | shape in the signature | `prim` / `obj` / `arr` / `fn` / `sum` / … |
| **term** | value identity | `lit` (`42`), `var` (symbolic `A1`), `app` (`x+1`) |
| **pred** | the `expected:` line | constraints (`x > 0`); participate in algebra (`x>0` ⇒ `x+1>1`) |
| **conf** | `#exact` / `#path` | abstraction precision |

Call sites are **evidence**: more real calls → signatures closer to runtime. `nudo test` shows per-call witnesses; `@nudo:case` is debug-only and never creates contract obligations.

Deeper: [Abs](../concepts/abs.md) · [Abstract interpretation](../concepts/abstract-interpretation.md) · `nudo check --abs`.

## Four model rules

1. **Call sites are evidence.** More real calls → signatures closer to runtime.
2. **`any` ≠ `unknown`.** `any` = unconstrained entry (you may refine it). `unknown` = inference failed (engine debt).
3. **Contracts are obligations, not annotations.** Constraints participate in algebra — they are not intent written in comments.
4. **Projections are not the source of truth.** `.d.ts` / schemas are lossy views of Abs; Abs from execution is the truth.

## What you can ignore for now

- Abs algebra details — [Abs](../concepts/abs.md) when you want `--abs`
- Harvest / env internals — [Dependency types](../guides/env-harvest.md)
- Export dialects — only when a consumer needs `.d.ts` or validators
- Migrating off `tsc` — [Nudo vs TypeScript](../guides/vs-typescript.md) · [Migrate from TypeScript](../guides/migrating-from-typescript.md)

## Next

- [Quick Start](./quick-start.md) — run it
- [Concept layers](../concepts/layers.md) — Observation / Contracts / Advanced
- [CLI](../guides/cli.md) — command surface
- [Error faces](../guides/error-faces.md)
- [Playground](/playground)
