---
slug: /why-nudo
description: Why Nudo — observe what JavaScript computes, gate contracts without rewriting, project Abs into the ecosystem.
---

# Why Nudo

**Welcome back to JavaScript.**

Nudo is for teams whose **logic lives in JavaScript** and who need **honest observation** plus **explicit obligations** — without rewriting the codebase into another language surface.

## What you get

| You need | Nudo |
|----------|------|
| See what code actually computes | `nudo check` signatures · IDE hover / inlay on Abs |
| Gate API obligations in CI | Sidecar contracts → `nudo check` (`actual ⊭ expected`) |
| Keep JS as JS | Logic is plain JS; contracts are plain JS modules (`*.nudo.js`) |
| Feed TypeScript / Zod / mocks | `nudo export` one-way projections from Abs |
| **Agent repair loops** | **`check --json` + `actions[]`** — values and commands, not type-name riddles |

`nudo check` **only validates**. Artifacts (`.d.ts`, Zod, Standard Schema, guards) come from **`export`** — not from the checker.

**AI-native DX** (tokens · rounds · bugs, measured): [AI-native DX](./guides/ai-native-dx.md).

## Two work modes

Nudo does not force a single style of process:

| Mode | Order | Typical fit |
|------|--------|-------------|
| **Logic first** | Write logic + call sites → optionally `contract --draft` → review → accept into `*.nudo.js` | Existing JS packages, migration, rich tests |
| **Contracts first** | Write contract / `@nudo:contract` → implement under the same contract face | New APIs, public surfaces you want locked early |

Both modes meet on the **same Abs contract face** (`shape × term × pred × conf`). The checker validates that face; it does not invent types for you.

Sidecars (`*.nudo.js`) are **ordinary JS modules** — Nudo does not introduce a second programming language for contracts.

## Why not “just annotations”

Declared annotations say what you *wrote*. Nudo’s engine **executes** logic on abstract values and records facts from that execution (terms, predicates, confidence). Call sites are evidence.

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

- Unconstrained entry params display as **`any`** (not `unknown`).
- Violations print **`actual ⊭ expected`** on Abs.
- `export` can then project `.d.ts` / Zod / Standard Schema for the ecosystem — **lossy views**, Abs stays the truth.

Honest comparison: [Nudo vs TypeScript](./guides/vs-typescript.md).

## Work modes → ecosystem

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

## Who should look closer

- **JS-first packages** that do not want a full TS rewrite for a type gate
- Teams that care about **runtime-shaped obligations** (bounds, shapes, entry throws) more than annotation style
- Pipelines that need **mocks / schema** from the same facts CI checks
- Teams ready to **retire `tsc`** on JS packages (`nudo migrate` one-way door)

Who should stay on TypeScript as primary: annotation-first `.ts` codebases, heavy generic/conditional type programming, ecosystems built around `tsc` project references. See [vs TypeScript](./guides/vs-typescript.md).

## Next

- [Mental model](./getting-started/mental-model.md) — 10 minutes
- [Introduction](./intro.md) — product face + how to use these docs
- [Quick Start](./getting-started/quick-start.md)
- [Error faces](./guides/error-faces.md)
- [nudo contract](./guides/contract.md)
- [Migrate from TypeScript](./guides/migrating-from-typescript.md) — retire `tsc`
- [Recipes](./guides/recipes.md)
- [Limits](./concepts/limits.md)
- [Migrate existing JS](./guides/migrating-js.md)
- [Playground](/playground)
