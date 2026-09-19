---
sidebar_position: 2
description: "Observe execution and enforce sidecar contracts on a plain JavaScript file — npx nudojs infer / check."
---

# Quick Start

**You'll leave with:** call-site observations from plain JS, a sidecar contract, and a `nudo check` failure you can read.

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
npx nudojs infer calc.js
```

```text
=== formatName ===

Case "call@L9": ("Ada", "Lovelace") => "Ada Lovelace"
Combined: `Ada Lovelace`

=== scale ===

Case "call@L0": (5) => 6  #exact
Combined: number
```

Nudo executed the functions with the arguments it actually saw. A generalized view also reports algebra on intermediates (`term` / `pred` / `conf`) — that is the observability layer, not a second type language.

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

`if` guards are **not** refinements. Contracts come only from sidecars / `@nudo:refine` / `@nudo:interface`.

## Options

- **`--dts`** — emit a lossy `.d.ts` projection for ecosystem bridges:

  ```bash
  npx nudojs infer calc.js --dts
  ```

- **Watch mode**

  ```bash
  npx nudojs watch src/ --dts
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
