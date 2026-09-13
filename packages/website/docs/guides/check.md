---
sidebar_position: 8
slug: /guides/check
description: nudo check — refinement, assign, and arg-structure gate on Abs (type-as-computation).
---

# nudo check

`nudo check` is Nudo's **refinement gate on Abs** (type-as-computation). Refinements are declared with `@nudo:refine` — Preds that enter Abs and participate in algebra. The report is **Nudo-native** (`actual ⊭ expected`), not a TypeScript diagnostic in disguise.

```bash
npx tsx packages/cli/src/index.ts check path/to/file.js
# exit 1 if any error
```

## What it checks

| Code | Meaning |
|------|---------|
| `nudo:constraint-violated` | Call/return ⊭ `@nudo:refine` (scalar bounds / shape fields) |
| `nudo:assign-mismatch` | Assignment ⊭ previous binding shape (`leqAbs`) |
| `nudo:arg-structure` | Argument structure ⊭ slots the body accesses (`p.foo`) |
| `nudo:case-inconsistency` | `@nudo:case` witness ⊭ refine |

```js
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  return x;
}

needsPositive(-1);
// [ERROR] needsPositive[x]: 实参 ⊭ 前置
//   actual:   -1  #exact
//   expected: x > 0

let a = { x: 1 };
a = { y: 2 };
// [ERROR] a: 赋值 ⊭ 原有形状  (nudo:assign-mismatch)

function readXY(p) { return p.x + p.y; }
readXY({ x: 1 });
// [ERROR] readXY[p]: 实参结构 ⊭ 形参  (nudo:arg-structure)
```

**`if` is not a refinement.** Clamp-style guards accept out-of-range input:

```js
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);  // OK — no @nudo:refine declared
```

It does **not** replace `tsc` for full structural completeness. It does what tsc cannot on unannotated JS: **declared refinements that participate in algebra**, plus **Abs leq** for assignments and call arguments.

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
| Arg structure | literal `{…}` or identifier binding vs `p.foo` slots |

## Quality gates

| Gate | Where | Bar |
|------|--------|-----|
| Human-labeled recall | `check-recall-gold.test.ts` | recall = precision = **1.0** |
| Shape refinements | `check-shape-gold.test.ts` | field / optional / bounds |
| Case vs refine | `check-case-consistency.test.ts` | witness ⊆ D |
| Real-package precision | `check-real-packages.test.ts` | zero false errors on commander / debug / … |

## Editor integration

LSP publishes **`nudo-check` diagnostics first** (Abs violations with `actual` / `expected`), then evaluator diagnostics (`source: nudo`). Hover and inlay hints read lossless Abs — not a lossy TypeValue bridge.

Agents use the same gate via **`nudo.check`** (CheckJson v1) — see [Agent API](../api/agent.md#nudocheck).

## Service Abs path boundary

`nudo check` (and `checkSource`) always analyzes on Abs, including cross-file require/import forwarding. The CLI is **strictly Abs-only** — it does not also run the TypeValue evaluator for extra diagnostics.

The **service evaluation path** (`call@` synthesis, hover intension, entry re-eval) prefers Abs only for **self-contained** sources: no `import`/`require`, no `@nudo:env`. `@nudo:mock` does **not** disable Abs — mocks compile to Abs seeds. Files with imports fall back to the TypeValue evaluator for those views; contract violations are still caught by `nudo check`.

See also: monorepo `docs/nudo-check.md` and `docs/ci-nudo-check.md`.
