---
description: "Gate signatures and cases on a plain JavaScript file — npx nudojs check / test."
---

# Quick Start

**You'll leave with:** signatures from `nudo check`, cases from `nudo test`, a sidecar contract, and a `nudo check` failure you can read.

Prefer the browser? Open the [Playground](/playground).

## 1. Write plain JavaScript

Create `calc.js`:

```javascript verify
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
```

```text
nudo check  calc.js
OK
  0 error · 0 warning · 0 info · 2 fn

signatures
  scale(x: any) => number | string
  formatName(first: any, last: any) => number | string

(no issues)
```

Optional debug cases (`nudo test` — not the product gate):

```text
=== scale ===
  call@L10  (5) => 6

=== formatName ===
  call@L9  ("Ada", "Lovelace") => "Ada Lovelace"

assertions
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 2 synthetic case(s) printed above)
```

Nudo executed the functions with the arguments it actually saw. Unconstrained entry params display as **`any`** (not `unknown`). Observation is `check` signatures + IDE hover; `nudo test` is an optional debug case reporter.

## 3. Add an explicit contract (Day 1)

Create `calc.nudo.js` next to the source:

```javascript verify-sidecar
import { number, fn } from "@nudojs/core";

export const scale = fn({ x: number().gt(0) }, number());
```

## 4. Gate with check

Add a call that violates the sidecar:

```javascript verify
scale(0); // fails the sidecar — x must be > 0
```

Run the gate:

```bash
npx nudojs check calc.js
```

```text
nudo check  calc.js
FAILED
  1 error · 0 warning · 0 info · 2 fn

signatures
  scale(x: number) => number
  formatName(first: any, last: any) => number | string

issues
  [ERROR L12 scale] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
```

The violation is reported against the call site. Fix the call (or widen the contract), and `check` passes — still printing signatures.

`if` guards are **not** refinements. Explicit contracts come from sidecars / `@nudo:refine` (alias `@nudo:interface`). Without them, L2 still gates undigested may-throw on exports (entry params are `any`).

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

Prefer concrete values or constraint builders in cases.

## Next

- [How to use these docs](../intro.md)
- [nudo check](../guides/check.md)
- [nudo contract](../guides/contract.md)
- [Concept Layers](../concepts/layers.md)
- [Recipes](../guides/recipes.md)
- [Playground](/playground)
