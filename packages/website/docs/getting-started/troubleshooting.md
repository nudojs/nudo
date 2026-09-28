---
description: "First-hour FAQ: any vs unknown, number | string unions, silent editors, nudo test vs vitest, entry-may-throw, removed verbs, signatures on success."
---

# Troubleshooting

The questions that come up most in the first hour with Nudo — each answered in one breath, with a link to the full story. Nothing here matches? Every `nudo:*` code is listed in [Diagnostics](../reference/diagnostics.md).

## Why is my parameter `any`?

`any` means **unconstrained** — no contract and no call-site evidence yet. It is not an inference failure and not a bug: Nudo never invents obligations by scanning the function body ([Limits](../concepts/limits.md)). To narrow the parameter, give it evidence:

- a sidecar `*.nudo.js` contract or [`@nudo:contract`](../concepts/directives.md#nudocontract--source-contract) — see [nudo contract](../guides/contract.md)
- a call site — real arguments narrow the signature ([Quick Start](./quick-start.md), [Call-Site Discovery](../guides/callsite-discovery.md))

`any` ≠ `unknown`: `unknown` is reserved for inference failure ([Introduction](../intro.md)).

## Why does `+` return `number | string`?

```text
scale(x: any) => number | string
```

Honest JavaScript, not a bug: an unconstrained operand to `+` can drive numeric addition *or* string concatenation (`"7" + 1`), so both branches are kept instead of guessing. Constrain `x` — a contract or call-site evidence — and the union collapses to `number` (`scale(x: number) => number`). Full story: [Language semantics](../concepts/semantics.md) · [Quick Start](./quick-start.md).

## What does `unknown` mean and how do I fix it?

`unknown` is **inference failure** (engine debt) — never the default display for unconstrained entry params ([Limits](../concepts/limits.md)). Fixes, best first:

1. Give the dependency types: install `@types/*` (declarations are picked up automatically) or declare a named env — [Dependency types](../guides/env-harvest.md)
2. Mock what analysis cannot execute (`fetch`, native bindings) — [Mocking](../concepts/mocking.md)
3. Prefer modeled constructs over the not-modeled list — [Language semantics](../concepts/semantics.md)

## VS Code (or another editor) shows nothing

The IDE analysis gate is `nudo.analysis.mode`, shipped default `"exports"`: only files with `export` / sidecar / `@nudo:*` directives are analyzed ([VS Code](../guides/vscode.md)). Open a file that exports something. Still quiet? Check the gate:

- Monorepo: scope `package.json#nudo.analysis` `include` / `exclude`, then reload the window — [Coexistence recipe](../guides/coexistence.md#recipe-mixed-js-ts-no-double-error-storm)
- `.ts` / `.tsx` buffers are intentionally not Nudo analysis targets by default

## Why doesn't `nudo test` see my vitest suite?

`nudo test` is a **case reporter** — `call@L` / `entry@L` cases plus declared `@nudo:case` assertions — not a test runner; it never runs vitest and ignores test files unless you point it at them ([CLI Reference](../api/cli-reference.md#nudo-test)):

```bash
nudo test lib/ --from test/
```

The harvesting pass executes the *shape* of each test file inside Nudo's evaluator (`it` / `test` / `describe` callbacks are invoked; the framework itself never runs) and injects every observed call as a synthetic case — [Call-Site Discovery](../guides/callsite-discovery.md).

## `nudo check` fails with `nudo:entry-may-throw` on an intentional throw

L2 requires entry/export functions not to carry **undeclared, uncaptured** throws — like Node exiting non-zero on an uncaught exception ([L2 — entry throws](../guides/check.md#l2--entry-throws)). Fixes, best first:

1. Declare it: `@nudo:throws RangeError` above the function — [`@nudo:throws`](../concepts/directives.md#nudothrows--declare-intentional-throws)
2. Digest it: `try`/`catch` at the boundary, or refine the parameter so the throwing path narrows away
3. Migration relief only: `--ignore-throws`, `--entry-throws warning`, or `--profile adoption`, persisted in `package.json#nudo.check` ([CLI Reference](../api/cli-reference.md#nudo-check))

## Where did `infer` / `types` / `interface` / `refine` go?

Deleted in the CLI product-face cleanup — breaking, no compatibility layer ([release history](../releases-history.md)). The primary verbs are `check` / `test` / `contract` / `export` / `health`.

Current per-package notes: [Releases](../releases.md).

## Signatures print even on success — is that a bug?

No — that is the observation face. `check` prints signatures on success *and* failure; only the `FAILED` / issues block and the exit code (1 on any error-level diagnostic) tell you whether the gate passed ([nudo check](../guides/check.md); output below quoted from [Quick Start](./quick-start.md)):

```text
nudo check  calc.js
OK
  0 error · 0 warning · 0 info · 2 fn
signatures
  scale(x: any) => number | string
```
