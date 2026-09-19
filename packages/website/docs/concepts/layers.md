---
sidebar_position: 2
slug: /concepts/layers
description: Day-0 zero concepts, Day-1 sidecar contracts, advanced Abs — pick the layer you need.
---

# Concept Layers

**You'll leave with:** which Nudo layer you need today — Day 0 (types from execution), Day 1 (sidecar contracts + `nudo check`), or advanced Abs.

Nudo is designed so you only learn what you need.

## Day 0 — Zero concepts

Write plain JavaScript. Run inference:

```bash
npx nudojs infer ./src/app.js
```

You get call-site cases: concrete inputs → inferred results. No annotations, no config.

Open the same file in VS Code with the Nudo extension for hover and inlays.

> **Default analysis mode:** `nudo.analysis.mode` defaults to `"exports"`. Files with `export` / sidecar / directives are analyzed by the IDE; set `"all"` for every target path or `"directives"` for the conservative gate. CLI `infer` on a named path still analyzes any target file.

**Stop here** if you only want types for existing JS.

## Day 1 — Sidecar contracts

When you need *obligations* (check gates in CI), add a sidecar next to the source:

```javascript
// math.js
export function add2(x) {
  return x + 2;
}
```

```javascript
// math.nudo.js
export const add2 = number().gt(0);
```

```bash
npx nudojs check ./src/math.js
```

Contracts come only from:
- explicit sidecars (`*.nudo.js`) / `@nudo:refine`
- call-site facts observed by the analyzer

No evidence → `any`/`unknown`. Nudo does **not** invent required slots from body AST scans.

## Advanced — Abs

The internal type is **Abs** (`shape × term × pred × conf`): types are computable values. `nudo check --verbose` shows the lossless Abs face. You rarely need this for day-to-day work.

## Next

- [Quick start](../getting-started/quick-start)
- [Check guide](../guides/check)
- [VS Code](../guides/vscode)
- [Coexistence with TypeScript](../guides/coexistence)
