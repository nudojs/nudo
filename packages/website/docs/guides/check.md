---
sidebar_position: 8
slug: /guides/check
description: nudo check — L1 refinement gate + L2 entry throws on Abs; prints signatures; CI command.
---

# nudo check

`nudo check` is Nudo's **gate on Abs**. It enforces:

1. **L1 explicit contracts** — refinements from `@nudo:refine` / `*.nudo.js` / `@nudo:interface` (Pred implication on Abs)
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

## Default output (signatures + issues)

```js
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
signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => any
issues
  [error] getName (export): may throw TypeError  (nudo:entry-may-throw)
```

- Unconstrained entry parameters display as **`any`**.
- **`unknown` means inference failed** (engine debt) — never the default for unconstrained entry params.
- Throws always appear on the signature line when present.

## What it checks

| Code | Layer | Severity | Meaning |
|------|-------|----------|---------|
| `nudo:constraint-violated` | L1 | error | Call/return ⊭ `@nudo:refine` (scalar bounds / shape fields) |
| `nudo:assign-mismatch` | L1 | error | Assignment ⊭ previous binding shape (`leqAbs`) |
| `nudo:arg-structure` | L1 | error | HOF: argument is not a callable `fn` / arity mismatch |
| `nudo:case-inconsistency` | L1 | error | `@nudo:case` witness ⊭ refine |
| `nudo:interface-param-mismatch` | L1 | error | Handwritten contract param name is not on the formal surface |
| `nudo:interface-conflict` | L1 | error | Handwritten contract conjunction unsatisfiable |
| **`nudo:entry-may-throw`** | **L2** | **error** (default) | Entry/export function has undigested may-throw |
| `nudo:may-throw` | test / L2 clue | warning | Case path may throw (internal included); L2 can elevate entry throws |
| `nudo:unknown-inference` | engine debt | warning/error | True `unknown` on an export/signature (inference failed) |
| `nudo:unknown-recv` | engine debt | warning | Member access on `unknown` receiver — does **not** replace L2 throws modeling |
| `nudo:no-signature` | engine/L1 | error | Function could not be generalized |
| `nudo:opaque-result` | engine | warning | Evaluation returned opaque / uninformative Abs |
| `nudo:eval-error` | engine | error | Body evaluation threw during analysis |
| `nudo:recursion-truncated` | engine | warning | Recursion budget hit; result widened |
| `nudo:unreachable` | info | info | Code after return/throw |

## L1 — explicit contracts

Refinements are declared with `@nudo:refine` — Preds that enter Abs and participate in algebra.

```js
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  return x;
}

needsPositive(-1);
// [error] needsPositive[x]: 实参 ⊭ 前置  (nudo:constraint-violated)
//   actual:   -1  #exact
//   expected: x > 0
```

**`if` is not a refinement.** Clamp-style guards accept out-of-range input when no refine is declared:

```js
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);  // OK — no @nudo:refine declared
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
[error] getName (export): may throw TypeError  (nudo:entry-may-throw)
  cause:    property 'name' on any (unconstrained param `user`)
  actual:   (user: any) => any    throws TypeError
  expected: entry total, or declare/catch throws
```

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

`package.json`:

```json
{
  "nudo": {
    "check": {
      "ignoreThrows": ["TypeError"],
      "entryThrows": "error"
    }
  }
}
```

Semantics:

- `--ignore-throws` **only** filters L2 entry throws — never L1 contract violations.
- Default: **do not ignore** any throws.
- Filters the throws type/shape, not the whole check.

### Node analogy

An uncaught exception makes a Node process exit non-zero. Likewise, undeclared/uncaptured throws on the **export boundary** fail `nudo check`. Throws inside an internal call stack are implementation details, handled by the caller or by L1.

## Options

| Option | Description |
|--------|-------------|
| `--watch` / `-w` | Re-run on changes (flag, not a verb) |
| `--json` | Machine-readable signatures + diagnostics |
| `--verbose` | Extra detail |
| `--abs` | Print Abs algebra face (term / pred / conf) |
| `--from <paths…>` | Usage-site files injecting call records (renamed from `--callsites`) |
| `--ignore-throws <names>` | Comma-separated L2 throw types to ignore |
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

# machine-readable
nudo check src/ --json
```

`nudo check` is the CI gate for contracts and entry throws — aligned with `tsc --noEmit`, except check **still prints signatures on success**.

## Next

- [CLI Usage](./cli.md) — all primary verbs
- [Type Values](../concepts/type-values.md) — `any` vs `unknown`
- [Concept Layers](../concepts/layers.md) — Day 0 / Day 1
