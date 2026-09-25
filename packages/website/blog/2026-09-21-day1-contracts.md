---
title: Contracts are JS — Day 1 with sidecar *.nudo.js
authors: [default]
tags: [nudo, contracts, check]
---

Nudo’s contract product is **not** a second type language. Contracts are ordinary JavaScript modules: sidecar `*.nudo.js` files that auto-bind to same-name exports, or in-source `@nudo:contract`.

```javascript
// pricing.nudo.js
import { number, fn } from "@nudojs/core";

export const lineTotal = fn(
  { price: number().gt(0), qty: number().ge(1) },
  number().gt(0)
);
```

```bash
npx nudojs check pricing.js
```

```text
issues
  [error] lineTotal: actual ⊭ expected  (nudo:constraint-violated)
    actual:   0  #exact
    expected: price > 0
```

<!-- truncate -->

## Product rules

| Rule | Meaning |
|------|---------|
| Contract surface | `*.nudo.js` / `@nudo:contract` (`@nudo:contract` is an alias) |
| `@nudo:case` | Debug witnesses only — never the contract product |
| Drafts | `nudo contract --draft` is reviewable; never auto-bound |
| check vs export | `check` validates Abs; `export` projects lossy dts/zod/guards |
| any vs unknown | Entry `any` = unconstrained; `unknown` = inference failed |

Logic-first teams draft from call sites; contracts-first teams write the sidecar up front. Both meet on the same Abs face.

Next: [contract guide](/docs/guides/contract) · [diagnostics](/docs/reference/diagnostics) · [recipes](/docs/guides/recipes).
