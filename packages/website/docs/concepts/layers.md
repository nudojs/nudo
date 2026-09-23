---
slug: /concepts/layers
description: Day-0 zero concepts, Day-1 sidecar contracts, advanced Abs — pick the layer you need.
---

# Concept Layers

**You'll leave with:** which Nudo layer you need today — Day 0 (types from execution), Day 1 (sidecar contracts + `nudo check`), or advanced Abs.

Nudo is designed so you only learn what you need.

## Day 0 — Zero concepts

Write plain JavaScript. Run the two Day-0 commands:

```bash
npx nudojs check ./src/app.js   # signatures + L2 entry throws
npx nudojs test ./src/app.js    # every inferred case
```

`check` prints signatures even on success. Unconstrained entry params display as `any`. `test` prints synthetic `call@` / `entry@` cases — that is the call-site observation surface. No annotations, no config.

Open the same file in VS Code with the Nudo extension for hover and inlays.

> **Default analysis mode:** `nudo.analysis.mode` defaults to `"exports"` (files with `export` / sidecar / directives are analyzed by the IDE). Full gate semantics and when to use each mode: [Coexistence with TypeScript](../guides/coexistence.md#when-to-use-modedirectives-vs-modeexports). CLI `check`/`test` on a named path still analyzes any target file.

**Day 0 takeaway:** read types from `check` signatures and `test` cases.

## Day 1 — Sidecar contracts

When you need *stronger obligations* (explicit contracts in CI), add a sidecar next to the source:

```javascript
// math.js
export function add2(x) {
  return x + 2;
}
```

```javascript
// math.nudo.js — function binding must be fn({ params }, returns?)
import { number, fn } from "@nudojs/core";

export const add2 = fn({ x: number().gt(0) }, number());
```

```bash
npx nudojs contract --draft ./src/math.js   # optional code-first draft
npx nudojs check ./src/math.js
```

Sidecar **function** bindings must be first-class `fn({ … }, …)` contracts. Bare `number().gt(0)` is a **value-level template** (e.g. `export const positive = number().gt(0)` in a shared `*.nudo.js`) — used via `@nudo:refine` or as a parameter slot inside `fn`, never as a function export contract. Non-`fn` sidecar bindings for functions are rejected (`nudo:interface-load`).

Explicit contracts come from:
- sidecars (`*.nudo.js`) / `@nudo:refine` (alias `@nudo:interface`)
- call-site facts observed by the analyzer (domain evidence)

Without an explicit contract, the contract degrades to the JS runtime boundary: entry params are `any`, and export functions must not carry undigested may-throw (L2). Nudo does **not** invent required slots from body AST scans.

## Advanced — Abs

The internal type is **Abs** (`shape × term × pred × conf`): types are computable values. `nudo check --abs` shows the per-function algebra face (shape + conf); `--generalize` adds the symbolic term/pred α. You rarely need this for day-to-day work.

## Next

- [Quick start](../getting-started/quick-start)
- [Check guide](../guides/check)
- [VS Code](../guides/vscode)
- [Coexistence with TypeScript](../guides/coexistence)
