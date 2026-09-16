---
sidebar_position: 8
slug: /guides/check
description: nudo check — refinement, assign, and arg-structure gate on Abs (type-as-computation).
---

# nudo check

`nudo check` is Nudo's **refinement gate on Abs** (type-as-computation). Refinements are declared with `@nudo:refine` — Preds that enter Abs and participate in algebra. The report is **Nudo-native** (`actual ⊭ expected`), not a TypeScript diagnostic in disguise.

```bash
npx nudo check path/to/file.js
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

## Interface diagnostics

Contracts in `*.nudo.js` sidecars (and generated `@generated` segments) get their own diagnostic family, split by **enforcement tier**: handwritten contracts are obligations (**error**); generated segments are fact snapshots that drift (**warning**); the observed call-site domain is never enforced on its own.

| Code | Severity | Trigger |
|------|----------|---------|
| `nudo:interface-cycle` | error | Sidecars importing each other in a cycle |
| `nudo:interface-load` | error | Sidecar fails to load/evaluate, or uses an unrecognized export form |
| `nudo:interface-conflict` | error | Source `@nudo:refine` and sidecar binding for the same parameter (or the return position) are contradictory (`x > 0 ∧ x < 0`); a contradicted position skips enforcement rather than blaming the function body |
| `nudo:interface-domain-exceeds` | error | **Cross-file** injected call evidence ⊄ **handwritten** contract (the interface is being used past its contract) |
| `nudo:interface-drift` | warning | Persisted `@generated` segment ≠ today's recomputed interface (semantic comparison, param and return positions) |
| `nudo:interface-name-clash` | error | `nudo interface --emit` target is already a handwritten sidecar binding (handwritten wins, write skipped) |

Source split for violations: a violating call **written in the analyzed file** keeps reporting `nudo:constraint-violated` exactly as before; `nudo:interface-domain-exceeds` covers only the previously unchecked path — call records **injected from usage-site files** (`nudo check --callsites <paths...>`). Evidence gates: literal arguments with confidence `#exact`/`#path`, non-truncated records.

Examples (each run in its own fixture directory):

```text
issues
  [ERROR] sidecar './cyc.nudo.js' for 'f' failed: sidecar import cycle: /tmp/…/cyc.nudo.js → /tmp/…/cyc2.nudo.js → /tmp/…/cyc.nudo.js  (nudo:interface-cycle)
```

```text
issues
  [ERROR] sidecar './broken.nudo.js' for 'broken' failed: Unexpected token, expected "," (2:0)  (nudo:interface-load)
```

```text
issues
  [ERROR f] f: 手写契约合取不可满足（x）  (nudo:interface-conflict)
      → 检查源码 @nudo:refine 与侧车同名绑定的常数界是否矛盾
```

```text
Diagnostics:

  [error] lib.js:1:7 clamp[x]: cross-file call-site domain evidence "hot" exceeds handwritten contract (nudo:interface-domain-exceeds)
```

```text
issues
  [WARNING L5 half] half[n]: 固化生成段 ≠ 今日调用点域  (nudo:interface-drift)
      actual:   number  = n  where n = 12  #path
      expected: lit(10)
      → 重跑 nudo interface --emit 刷新生成段，或核对 n 的调用点
  [WARNING L5 half] half[return]: 固化生成段 ≠ 今日推断返回  (nudo:interface-drift)
      actual:   number  = return  where return = 6  #path
      expected: lit(5)
      → 重跑 nudo interface --emit 刷新生成段，或核对返回值
```

Drift warnings do not fail `nudo check` (exit `0`). Coverage by code: `nudo:interface-drift` and `nudo:interface-domain-exceeds` are pinned in the check-gold fixtures; `nudo:interface-load` / `nudo:interface-cycle` / `nudo:interface-conflict` are covered by the wiring, loader and emitter suites (`check-interface-wiring`, `refine-loader`, `interface-emitter`); `nudo:interface-name-clash` lives in the emitter/agent suites. See [@nudo:refine](../concepts/directives.md#nudorefine--refinement-contract) for the contract forms.

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
| Real-package precision | `check-real-packages.test.ts` | zero false errors on commander / escape-string-regexp / is-plain-obj / debug / yocto-queue / p-limit / kleur / eventemitter3 / ms / lodash |

## Editor integration

LSP publishes **`nudo-check` diagnostics first** (Abs violations with `actual` / `expected`), then evaluator diagnostics (`source: nudo`). Hover and inlay hints read lossless Abs — not a lossy TypeValue bridge.

Agents use the same gate via **`nudo.check`** (CheckJson v1) — see [Agent API](../api/agent.md#nudocheck).

## Service Abs path boundary

`nudo check` (and `checkSource`) always analyzes on Abs, including cross-file require/import forwarding. The CLI is **strictly Abs-only** — it does not also run the TypeValue evaluator for extra diagnostics.

The **service evaluation path** (`infer` case output, `call@` synthesis, JSON `intension`) runs Abs for the analyzed file's own functions even when the file has imports — every local function's case carries `intension:` / `abs:` lines (see [`docs/examples/mini-repo/user-service.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/mini-repo/user-service.js): a file with imports whose `fetchUser(7)` case reports `abs: promise<{ id: 7, name: "u7" }>  #path`). Cases of functions from **imported modules** (`externalFunctions`, the `--- path (imported) ---` sections) carry call evidence only — case headers without `intension`. `@nudo:mock` does **not** disable Abs — mocks compile to Abs seeds. Contract violations are always caught by `nudo check`.

See also: monorepo `docs/nudo-check.md` and `docs/ci-nudo-check.md`.
