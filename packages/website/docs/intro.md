---
sidebar_position: 1
slug: /intro
description: Nudo is a type inference engine for JavaScript powered by abstract interpretation on Abs — types are computable values; contracts come from @nudo:refine / *.nudo.js sidecars.
---

# Introduction

**Nudo** is a type inference engine for JavaScript. The type system is **Abs** (`shape × term × pred × conf`): types are computable values whose constraints participate in algebra (`x>0` ⇒ `x+1>1`). Production analysis is Abs-native — there is no second IR. TypeScript sources are also accepted: type annotations are stripped and the code is inferred with plain JS semantics.

## How It Works

Nudo **executes** your code under abstract interpretation (B-path transpile+exec, with an ast-eval fallback). Call-site facts and optional `@nudo:case` witnesses drive evaluation; the engine produces Abs results, rendered extensionally for display (`formatShape`) and projected one-way to `.d.ts` / zod when needed.

Obligations — what `nudo check` enforces — come **only** from explicit contracts:

- sidecar templates in `*.nudo.js` (constraint builders such as `number().gt(0)`, `shape({...})`, `fn({...}, …)`)
- in-source `@nudo:refine` / `@nudo:interface` (same grammar; sidecar is the main product path)

No contract and no call-site evidence → `any` / honest `unknown`. Nudo does **not** invent required fields from body AST scans.

## Nudo vs TypeScript

| TypeScript | Nudo |
|------------|------|
| Declare types up front; compiler checks usage | Write plain JavaScript; engine infers Abs by executing it |
| Requires `.ts` files or JSDoc annotations | Optional directives (`@nudo:case` witnesses) and sidecar contracts (`*.nudo.js`) |
| Types describe intent | Inferred Abs describes observed behavior; contracts describe obligations |

**Example: witnesses + a sidecar contract**

```javascript
// process.js
/**
 * @nudo:case "numbers" (5)
 */
export function process(x) {
  return x * 2;
}
```

```javascript
// process.nudo.js — obligation (check gate)
import { number, fn } from "@nudojs/core";
export const process = fn({ x: number().gt(0) }, number());
```

`nudo infer` reports the concrete case (`(5) => 10  #exact`). `nudo check` enforces the sidecar: `process(0)` fails with `nudo:constraint-violated` (`actual ⊭ expected`). Case args may also be symbolic (`T.number`) for scenario debugging — that grammar is a **directive witness syntax**, not a second type system; analysis always runs on Abs.

## Beyond TypeScript

Nudo can compute types that TypeScript’s type system cannot express:

```javascript
// String concatenation preserves structure
"0x" + string                   // → `0x${string}` (TS: string)

// Literal string methods compute precisely
"hello".toUpperCase()          // → "HELLO" (TS: string)
"hello".slice(1, 3)           // → "el" (TS: string)
"a,b,c".split(",")            // → ["a", "b", "c"] (TS: string[])

// Loops evaluate on Abs
let sum = 0;
for (let i = 0; i < 5; i++) sum += i;
// sum → 10 (TS: number)
```

The same algebra powers **[`nudo check`](./guides/check.md)** — a refinement gate on Abs. Reports use `actual ⊭ expected`, not TypeScript diagnostic prose. TypeScript `.d.ts` emit is an ecosystem compatibility channel, not the primary type model.

## What's Next

- **[Installation](./getting-started/installation.md)** — Install the CLI, VS Code extension, and Vite plugin
- **[Quick Start](./getting-started/quick-start.md)** — Run `nudo infer` on your first file
- **[Concept Layers](./concepts/layers.md)** — Day-0 / Day-1 sidecars / advanced Abs
- **[Nudo vs TypeScript](./guides/vs-typescript.md)** — Where replacement is real, where TS stays, coexistence
- **[Coexistence](./guides/coexistence.md)** — Monorepo recipes (JS=Nudo, TS=tsc)
- **[Type Values (Abs)](./concepts/type-values.md)** — shape × term × pred × conf
- **[Call-Site Discovery](./guides/callsite-discovery.md)** — Let Nudo mine your tests for real call shapes
- **[nudo check](./guides/check.md)** — Refinement gate on Abs
- **[Language Semantics](./guides/semantics.md)** — What Nudo models precisely, and what still degrades to `unknown`
