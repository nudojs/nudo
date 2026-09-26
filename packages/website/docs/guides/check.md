---
slug: /guides/check
description: nudo check — L1 refinement gate + L2 entry throws on Abs; prints signatures; CI command.
---

# nudo check

`nudo check` is Nudo's **gate on Abs**. It enforces:

1. **L1 explicit contracts** — refinements from `*.nudo.js` / `@nudo:contract` (Pred implication on Abs)
2. **L2 default JS contracts** — undigested may-throw on **entry/export** functions

The report is **Nudo-native** (`actual ⊭ expected`), not a TypeScript diagnostic in disguise. On success **and** failure, `check` prints signatures — it is not silent.

```bash
npx nudojs check path/to/file.js
# exit 1 if any error
```

```bash
nudo check <path> [--watch|-w] [--json] [--verbose] [--abs]
           [--from paths…] [--ignore-throws names] [--entry-throws error|warning|off]
```

![check validate vs export project](/img/check-vs-export.svg)

*`check` validates Abs (solid); `export` projects dts/guard/schema one-way and lossy (dashed). Nothing reads a projection back.*

## Default output (signatures + issues)

```js verify
export function getName(user) {
  return user.name;
}

export function subtract(a, b) {
  return a - b;
}
```

```bash
nudo check user.js
```

```text
nudo check  user.js
FAILED
  1 error · 0 warning · 0 info · 2 fn

signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => number

issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
```

> `L1` in `[ERROR L1 getName]` is the **line number** (the function is declared on line 1 here) — the layer is L2 (`nudo:entry-may-throw`). `L#` is always a location, never a contract layer.

- Unconstrained entry parameters display as **`any`**.
- **`unknown` means inference failed** (engine debt) — never the default for unconstrained entry params.
- Throws always appear on the signature line when present.
- `[ERROR L# name]` — `L#` is the **line number** of the offending call/declaration, not a contract layer (L1/L2 are the layers; `L#` is a location).

## What it checks

| Code | Layer | Severity | Meaning |
|------|-------|----------|---------|
| `nudo:constraint-violated` | L1 | error | Call/return ⊭ `@nudo:contract` (scalar bounds / shape fields) |
| `nudo:assign-mismatch` | L1 | error | Assignment ⊭ previous binding shape (`leqAbs`) |
| `nudo:arg-structure` | L1 | error (explicit contract) / warning (body-promote) | HOF: argument is not a callable `fn` / arity mismatch. Usage-driven body promotion is a **warning suggestion**; only explicit relation contracts make it an error |
| `nudo:case-inconsistency` | L1 | error | `@nudo:case` witness ⊭ refine |
| `nudo:interface-param-mismatch` | L1 | error | Handwritten contract param name is not on the formal surface |
| `nudo:interface-conflict` | L1 | error | Handwritten contract conjunction unsatisfiable |
| **`nudo:entry-may-throw`** | **L2** | **error** (default) | Entry/export function has undigested may-throw |
| `nudo:may-throw` | test / L2 clue | warning | Case path may throw (internal included); L2 can elevate entry throws |
| `nudo:unknown-inference` | engine debt | warning | True `unknown` on a signature (inference failed) — unconstrained entry params are `any`, not this code |
| `nudo:unknown-recv` | engine debt | warning | Member access on `unknown` receiver — does **not** replace L2 throws modeling |
| `nudo:no-signature` | engine/L1 | warning | Function could not be generalized (CJS/anon forms still get L2 via entry fallback) |
| `nudo:opaque-result` | engine | info | Evaluation returned opaque / uninformative Abs |
| `nudo:eval-error` | engine | error | Body evaluation threw during analysis |
| `nudo:recursion-truncated` | engine | warning | Recursion budget hit; result widened |
| `nudo:fork-truncated` | engine | warning | Branch-expansion (`$fork`) budget hit; result widened |
| `nudo-unreachable` | info | info | Code after return/throw |

## L1 — explicit contracts

Refinements are declared with `@nudo:contract` — Preds that enter Abs and participate in algebra.

```js
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  return x;
}

needsPositive(-1);
// [ERROR L12 needsPositive] needsPositive[x]: argument ⊭ precondition  (nudo:constraint-violated)
//   actual:   -1  #exact
//   expected: x > 0
//   → use a value satisfying x > 0, or relax the precondition on x
```

**`if` is not a refinement.** Clamp-style guards accept out-of-range input when no refine is declared:

```js verify
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);  // OK — no @nudo:contract declared
```

Nudo does **not** invent required slots from body AST scans.

## L2 — entry throws

Without an explicit contract, the contract degrades to the **JS runtime boundary**:

> Entry parameters are `any`. Operations on `any`/nullish values may throw. Exported functions must not silently carry undeclared, uncaptured throws.

```js
export function getName(user) {
  return user.name;  // property access on unconstrained `user`
}
```

```text
nudo check  user.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  getName(user: any) => any  throws TypeError

issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
```

> Reminder: `L1` in the header is the **line number** — this diagnostic's layer is L2.

### What L2 gates

- **Only entry/export functions** — `export` / `export default`, CJS `exports.x =` / `module.exports`.
- **Internal helpers are not gated.** They may throw; observe them in `nudo test`.
- `try`/`catch` digests throws on a path (removed from exit effects).
- Refine narrowing the param to a shape removes or downgrades L2 (becomes L1).

### Filtering L2

```bash
nudo check src/ --ignore-throws TypeError
nudo check src/ --ignore-throws TypeError,RangeError
nudo check src/ --entry-throws warning   # demote L2 while migrating
nudo check src/ --entry-throws off
```

Semantics:

- `--ignore-throws` **only** filters L2 entry throws — never L1 contract violations.
- Default: **do not ignore** any throws.
- Filters the throws type/shape, not the whole check.

Persist these in `package.json#nudo.check` — config block: [CLI Reference](../api/cli-reference.md#nudo-check).

### Node analogy

An uncaught exception makes a Node process exit non-zero. Likewise, undeclared/uncaptured throws on the **export boundary** fail `nudo check`. Throws inside an internal call stack are implementation details, handled by the caller or by L1.

## Options

All flags and `package.json#nudo.check` config are specified once in the [CLI Reference](../api/cli-reference.md#nudo-check). Highlights:

| Option | Description |
|--------|-------------|
| `--watch` / `-w` | Re-run on changes (flag, not a verb) |
| `--json` | Machine-readable signatures + diagnostics (`CheckJson` / `CheckJsonMulti`) |
| `--verbose` | Expand Abs signatures (term/pred/conf detail) |
| `--abs` | Per-function algebra face (shape + conf; `--generalize` adds the symbolic term/pred α) — observation, still gates L1/L2 |
| `--fn <name>` | With `--abs`: restrict to one function |
| `--assume <pred…>` | With `--abs`: assume constraints on entry params (e.g. `x>0 y>=1`) |
| `--generalize` | With `--abs`: polymorphic signatures via symbolic execution |
| `--from <paths…>` | Usage-site files injecting call records |
| `--ignore-throws <names>` | Comma-separated L2 throw types to ignore (never swallows L1) |
| `--entry-throws error\|warning\|off` | L2 severity (default `error`) |

## Interface diagnostics

| Code | Severity | Meaning |
|------|----------|---------|
| `nudo:interface-drift` | warning | Persisted `@generated` segment ≠ today's recomputed interface. Also surfaced by `nudo health` as a CI gate |
| `nudo:interface-name-clash` | error | `nudo contract --emit` target is already a handwritten sidecar binding (handwritten wins, write skipped) |
| `nudo:interface-domain-exceeds` | error | Call records injected via `--from` exceed the declared domain |

Violations written **in the analyzed file** report `nudo:constraint-violated`. `nudo:interface-domain-exceeds` covers call records injected from usage-site files (`nudo check --from <paths...>`).

## CI

```bash
nudo check src/
# exit 1 on any error-level diagnostic

# machine-readable (1 file → CheckJson; N files → CheckJsonMulti envelope)
nudo check src/lib.js --json
```

`nudo check` is the CI gate for contracts and entry throws — aligned with `tsc --noEmit`, except check **still prints signatures on success**. `--abs` remains observation but still gates on L1/L2 errors.

## Next

- [CLI Usage](./cli.md) — all primary verbs
- [Abs](../concepts/abs.md) — `any` vs `unknown`
- [Diagnostics glossary](../reference/diagnostics.md) — stable codes and how to read them
- [Concept Layers](../concepts/layers.md) — Observation / Contracts
