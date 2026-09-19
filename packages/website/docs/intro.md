---
sidebar_position: 1
slug: /intro
description: Nudo executes JavaScript, prints signatures on check/test, and gates contracts + entry throws — stricter than types.
---

# Introduction

**Welcome back to JavaScript.**

Your JS stays JS. **Nudo** does not restrict how you write JavaScript — it faithfully observes intermediate values and results, and enforces contracts sharper than ordinary TypeScript types.

Write plain `.js`. Optional sidecar contracts (`*.nudo.js` / `@nudo:refine` / `@nudo:interface`) when you need obligations. Even without explicit contracts, export boundary may-throw is gated (L2).

## You'll leave with

- Observation vs obligation: `nudo check` signatures + `nudo test` cases (no `nudo infer` verb)
- The Day-0 / Day-1 split: check/test first, contract when you need stronger gates
- Commands to run on your own file, and a Playground link

## From source to gate

```javascript
// calc.js
export function scale(x) {
  return x + 1;
}

export function formatName(first, last) {
  return first + " " + last;
}

formatName("Ada", "Lovelace");
scale(5);
```

```javascript
// calc.nudo.js — explicit obligation
import { number, fn } from "@nudojs/core";
export const scale = fn({ x: number().gt(0) }, number());
```

```bash
npx nudojs check calc.js
npx nudojs test calc.js
```

```text
signatures
  formatName(first: any, last: any) => any
  scale(x: any) => any
issues
  (L1) scale(0) → actual 1 #exact ⊭ expected x > 0  (nudo:constraint-violated)

npx nudojs test:
=== formatName ===
  call@L9  ("Ada", "Lovelace") => "Ada Lovelace"
=== scale ===
  call@L12  (5) => 6
```

In the IDE, the same Abs surfaces as inlay hints on intermediates — not only a return “type”.

## Day 0 vs Day 1

| Layer | What you write | What you get |
|-------|----------------|--------------|
| **Day 0** | Plain JS + call sites | `nudo check` signatures · `nudo test` cases |
| **Day 1** | `*.nudo.js` / `@nudo:refine` | `nudo check` L1 obligations (`actual ⊭ expected`) |
| **Ecosystem** | nothing extra | `nudo export` dts/guard/zod |
| **Advanced** | Abs algebra, envs, mocks | String/number algebra, HOFs, module graphs |

`@nudo:case` remains available as a **debug witness** for scenario runs (`nudo test`, LSP case switching) — it is not the contract product.

## Why not “just TypeScript”

| | TypeScript | Nudo |
|---|---|---|
| Primary artifact | Declared types on `.ts` | Observed Abs from executing `.js` |
| Precision | Often widens (`string`, `number`) | Can keep literals, template structure, loop sums |
| Obligations | Type language + assignability | L1 explicit contracts + L2 entry throws + Pred implication on Abs |
| Observability | Hover shows declared type | `check` signatures / `test` cases / hover show term / pred / conf |
| CI gate | `tsc --noEmit` | `nudo check` (prints signatures on success too) |
| Observation command | (none — hover) | No `nudo infer`; observation is check/test/IDE output |

`"a,b,c".split(",")` → `["a", "b", "c"]`. `scale` carries `(x + 1) > 1` when `x > 0` is declared. That is validation + observability, not a second type language.

Honest replacement map: [Nudo vs TypeScript](./guides/vs-typescript.md).

## What's next

- **[Installation](./getting-started/installation.md)** — CLI, VS Code extension, Vite plugin
- **[Quick Start](./getting-started/quick-start.md)** — first check + test run
- **[Playground](/playground)** — browser execution
- **[Concept Layers](./concepts/layers.md)** — Day-0 / Day-1 / advanced
- **[nudo check](./guides/check.md)** — refinement gate on Abs
- **[Directives](./concepts/directives.md)** — `@nudo:refine` / `@nudo:interface` / sidecar
- **[Type Values (Abs)](./concepts/type-values.md)** — `shape × term × pred × conf`
- **[Language Semantics](./guides/semantics.md)** — what is precise, what degrades to `unknown`
