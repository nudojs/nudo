---
"@nudojs/core": patch
---

Fix: symbolic execution normalizes non-Abs results at the boundary (B3) — `checkSource` no longer crashes on bundles that return host globals.

- `generalize`'s symbolic `run` declared `Abs` but could return a leaked host value (a function body `return process` / `return JSON` / a host object flowing out of the transpiled unit) ⇒ `formatPoly` → `formatShapeSlot` read `.shape` of a non-Abs and crashed (`Cannot read properties of undefined (reading 'k')`, reproduced by `checkSource` on `@babel/types/lib/index.js`).
- Fix: after `runCore`, non-Abs results go through `asAbsVal` (host functions → stable facade Abs, other host values → wrapper Abs) — the same host-bridge normalization already used by `$call` / member reads. `undefined` keeps the existing fail-closed `unknown`+opaque path.
- Regression: `checkSource` over the full `@babel/types` bundle completes; covered by the OSS-corpus candidate re-check.
