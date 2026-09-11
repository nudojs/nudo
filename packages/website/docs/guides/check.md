---
sidebar_position: 8
slug: /guides/check
description: nudo check — constraint gate on Abs (type-as-computation), not TypeScript assignability.
---

# nudo check

`nudo check` is Nudo's **constraint gate**. It analyzes JavaScript with the algebra of abstract values (**Abs**), reports whether call-site arguments satisfy function preconditions, and emits a **Nudo-native** report — not a TypeScript diagnostic in disguise.

```bash
npx tsx packages/cli/src/index.ts check path/to/file.js
# exit 1 if any error
```

## What it checks

```js
function needsPositive(x) {
  if (x > 0) return x;   // success-path precondition: x > 0
  return 0;
}

needsPositive(-1);
// [ERROR] needsPositive[x]: 实参 ⊭ 前置
//   actual:   -1  #exact
//   expected: x > 0
```

It does **not** replace `tsc` for structural assignment. It does what tsc cannot on unannotated JS: **numeric / range constraints** derived from the program itself.

## Report shape (Abs-first)

```
nudo check  file.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  needsPositive(x)  number  = x  where x > 0  #path

issues
  [ERROR L12 needsPositive] needsPositive[x]: 实参 ⊭ 前置
      actual:   -1  #exact
      expected: x > 0
```

Signatures carry the **lossless Abs** (`shape`, `term`, `pred`, `conf`). Optional `.d.ts` emit is a TypeScript-ecosystem **compat side-channel**, not the main line.

## Call-site coverage

| Pattern | Example |
|---------|---------|
| Direct | `needsPositive(-1)` |
| Alias | `const f = needsPositive; f(-1)` |
| Object property | `const api = { needsPositive }; api.needsPositive(-1)` |
| Unconditional forward | `function w(a) { return target(a); }` → `w(lit)` |
| CJS require | `const { fn } = require('./m')` |
| ESM import | `import { fn as x } from './m'` |
| Dynamic import | `const { fn } = await import('./m')` |
| Barrel (one hop) | `export { fn } from './v.js'` |

**Clamp-style guards are not preconditions:**

```js
function clamp(n, lo, hi) {
  if (n < lo) return lo;  // out-of-range is a legal input
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);  // OK
```

## Quality gates

| Gate | Where | Bar |
|------|--------|-----|
| Human-labeled recall | `check-recall-gold.test.ts` | recall = precision = **1.0** |
| Real-package precision | `check-real-commander.test.ts` | zero false `constraint-violated` on commander |

## Editor integration

LSP publishes **`nudo-check` diagnostics first** (Abs violations with `actual` / `expected`), then evaluator diagnostics (`source: nudo`). Hover and inlay hints read lossless Abs — not a lossy TypeValue bridge.

See also: monorepo `docs/nudo-check.md` and `docs/ci-nudo-check.md`.
