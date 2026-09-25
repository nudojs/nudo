---
slug: /concepts/layers
description: Day-0 zero concepts, Day-1 sidecar contracts, advanced Abs — pick the layer you need.
---

# Concept Layers

**You'll leave with:** which Nudo layer you need today — Day 0 (types from execution), Day 1 (sidecar contracts + `nudo check`), or advanced Abs.

Nudo is designed so you only learn what you need.

## Which layer do you need?

| You want | Layer | Start here |
|---|---|---|
| See inferred types, no annotations | **Day 0** | `npx nudojs check` / `test` signatures |
| CI obligations — contracts that fail a build | **Day 1** | `*.nudo.js` sidecar + `nudo check` |
| The algebra itself — symbolic terms, preds, `--abs` | **Advanced** | Abs (`shape × term × pred × conf`) |

Rule of thumb: if you only want to *read* types, stop at Day 0. If you need CI to *enforce* something, add Day 1. Open the Advanced layer only when you are debugging inference or building on the kernel.

## Day 0 — Zero concepts

Write plain JavaScript. Run the two Day-0 commands:

```bash
npx nudojs check ./src/app.js   # signatures + L2 entry throws
npx nudojs test ./src/app.js    # every inferred case
```

`check` prints signatures even on success. Unconstrained entry params display as `any`. `test` prints synthetic `call@` / `entry@` cases — that is the call-site observation surface. No annotations, no config.

Open the same file in VS Code with the Nudo extension for hover and inlays.

> **Default analysis mode:** `nudo.analysis.mode` defaults to `"exports"` (files with `export` / sidecar / directives are analyzed by the IDE). Full gate semantics and when to use each mode: [Coexistence with TypeScript](../guides/coexistence.md#when-to-use-modedirectives-vs-modeexports). CLI `check`/`test` on a named path still analyzes any target file.

**Day 0 takeaway:** read types from `check` signatures and `test` cases. `any` on an unconstrained entry param is honest — the alternative, `unknown`, means inference failed (see [Abs — any vs unknown](./type-values.md#any-vs-unknown)).

## Day 1 — Sidecar contracts

When you need *stronger obligations* (explicit contracts in CI), add a sidecar next to the source:

```javascript verify
// math.js
export function add2(x) {
  return x + 2;
}
```

```javascript verify-sidecar
// math.nudo.js — function binding must be fn({ params }, returns?)
import { number, fn } from "@nudojs/core";

export const add2 = fn({ x: number().gt(0) }, number());
```

```bash
npx nudojs contract --draft ./src/math.js   # optional code-first draft
npx nudojs check ./src/math.js
```

Sidecar **function** bindings must be first-class `fn({ … }, …)` contracts. Bare `number().gt(0)` is a **value-level template** (e.g. `export const positive = number().gt(0)` in a shared `*.nudo.js`) — used via `@nudo:contract` or as a parameter slot inside `fn`, never as a function export contract. Non-`fn` sidecar bindings for functions are rejected (`nudo:interface-load`).

Explicit contracts come from:
- sidecars (`*.nudo.js`) / `@nudo:contract`
- call-site facts observed by the analyzer (domain evidence)

Without an explicit contract, the contract degrades to the JS runtime boundary: entry params are `any`, and export functions must not carry undigested may-throw (L2). Nudo does **not** invent required slots from body AST scans.

**Day 1 takeaway:** the sidecar is the contract product. `nudo check` enforces L1 (explicit contracts) and L2 (entry may-throw). `@nudo:case` is debug / `nudo test` only — not the interface.

## Advanced — Abs {#advanced-abs}

The internal type is **Abs** (`shape × term × pred × conf`): types are computable values. `nudo check --abs` shows the per-function algebra face (shape + conf); `--generalize` adds the symbolic term/pred α. You rarely need this for day-to-day work.

Reach for Advanced when:
- a signature looks wrong and you want the intensional face, not the display string
- you are reasoning about refinements in algebra (`x>0` ⇒ `x+1>1`)
- you are building tooling on `@nudojs/core`

Deeper reading: [Abs — the type system](./type-values.md) · [Abstract interpretation](./abstract-interpretation.md).

## Next

- [Quick start](../getting-started/quick-start.md)
- [Check guide](../guides/check.md)
- [Contract guide](../guides/contract.md)
- [Abs — the type system](./type-values.md)
- [VS Code](../guides/vscode.md)
- [Coexistence with TypeScript](../guides/coexistence.md)
