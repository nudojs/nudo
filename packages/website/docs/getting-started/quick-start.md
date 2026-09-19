---
sidebar_position: 2
description: "Gate signatures and cases on a plain JavaScript file — npx nudojs check / test."
---

# Quick Start

**You'll leave with:** signatures from `nudo check`, cases from `nudo test`, a sidecar contract, and a `nudo check` failure you can read.

Prefer the browser? Open the [Playground](/playground).

## 1. Write plain JavaScript

Create `calc.js`:

```javascript
export function scale(x) {
  return x + 1;
}

export function formatName(first, last) {
  return first + " " + last;
}

formatName("Ada", "Lovelace");
scale(5);
```

No annotations. Call sites are evidence.

## 2. Observe (Day 0)

```bash
npx nudojs check calc.js
npx nudojs test calc.js
```

```text
signatures
  formatName(first: any, last: any) => any
  scale(x: any) => any
```

```text
=== formatName ===
  call@L9  ("Ada", "Lovelace") => "Ada Lovelace"
=== scale ===
  call@L12  (5) => 6
```

Nudo executed the functions with the arguments it actually saw. Unconstrained entry params display as **`any`** (not `unknown`). There is no `nudo infer` observation verb — observation is `check` signatures + `test` cases + IDE hover.

## 3. Add an explicit contract (Day 1)

Create `calc.nudo.js` next to the source:

```javascript
import { number, fn } from "@nudojs/core";

export const scale = fn({ x: number().gt(0) }, number());
```

## 4. Gate with check

```bash
npx nudojs check calc.js
```

```text
scale(0)  actual: 1  #exact
          expected: x > 0
          nudo:constraint-violated   actual ⊭ expected
```

Add a bad call to see it:

```javascript
scale(0); // fails the sidecar — x must be > 0
```

`if` guards are **not** refinements. Explicit contracts come from sidecars / `@nudo:refine` / `@nudo:interface`. Without them, L2 still gates undigested may-throw on exports (entry params are `any`).

## Options

- **`.d.ts` projection** — ecosystem bridge (one-way, lossy; Abs is the truth):

  ```bash
  npx nudojs export calc.js --format dts --out dist/types
  ```

- **Watch mode** (flag, not a verb)

  ```bash
  npx nudojs check src/ --watch
  npx nudojs test src/ --watch
  ```

## Debug witnesses (optional)

`@nudo:case` is for **scenario debugging** (`nudo test`, LSP case switching) — not the contract product:

```javascript
/**
 * @nudo:case "double digits" (10)
 */
export function scale(x) {
  return x + 1;
}
```

Prefer concrete values in cases. Symbolic `T.*` arguments are legacy and not used in current examples.

## Next

- [Concept Layers](../concepts/layers.md)
- [nudo check](../guides/check.md)
- [Directives — refine / interface / sidecar](../concepts/directives.md)
- [Playground](/playground)
