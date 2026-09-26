---
slug: /glossary
description: Glossary — Abs (name and parts), conf grades, B-path, fail-closed, any vs unknown, L1/L2, contracts, call sites.
---

# Glossary

Terms used across the docs. Name origins are given where the English short form is non-obvious. CLI verbs live in the [CLI guide](/docs/guides/cli).

## Type model

| Term | Meaning |
|------|---------|
| **Abs** | Short for **abstract value** (from abstract interpretation). Nudo’s only type system: `shape × term × pred × conf`. A computable value whose constraints participate in algebra (`x > 0` ⇒ `x + 1 > 1`). Not a type *name* — the thing variables carry after execution. |
| **shape** | Extensional carrier: what the value looks like (`prim` / `obj` / `arr` / `tuple` / `fn` / `eff` / `brand` / `sum` / `never` / `any` / `unknown`). |
| **term** | Value identity: `lit` (exact `42`), `var` (symbolic α like `A1`), `app` (application like `(x + 1)`). |
| **pred** | Constraint relative to the term (e.g. `x > 0`, `port ∈ [1, 65535]`). |
| **conf** | How exact the abstraction is (displayed as `#exact`, `#path`, …). Ladder from best to worst — `confJoin` keeps the weaker side. See [conf grades](#conf-grades). |
| **any** | Unconstrained JS value union — default for entry params without contracts. The developer may refine it. |
| **unknown** | Inference failed (engine debt) — **not** a synonym for `any`. |
| **projection** | One-way, lossy view of Abs (`formatShape`, `absToTSType`, schema source). Nothing reads a projection back into analysis. |

### conf grades {#conf-grades}

`conf` records **how much of the value set is actually known**. Displayed as `#exact`, `#path`, … Rank (strong → weak): `exact` → `path` → `widened` → `mock` → `partial` → `opaque`. Joins keep the weaker grade. Only `exact` / `path` project to constraints / dts detail.

| Grade | Meaning | Typical source |
|-------|---------|----------------|
| **exact** | Literal or precisely evaluable — one definite value or fully known structure | `25  #exact`, `"ab"+"c"` → `"abc"  #exact` |
| **path** | Depends on path constraints / symbolic identity — precise *relative to* Φ and preds | `x + 1` with `x > 0` → `term (x+1) · > 1  #path` |
| **widened** | Structure was lost; result is a conservative extensional domain | loop joins, call-site budget overflow, `selfAdd(number)` → `number  #widened` |
| **mock** | Face comes from a **declared** mock / harvest, not from observed evaluation | `@nudo:mock` / env harvest |
| **partial** | Incomplete information — some content known, not the full set | open objects, incomplete modeling, default `unknown` |
| **opaque** | No usable content for reasoning or projection | budget truncation (`unknown #opaque`), unprovable goals, eval failure without a finer face |

## Product face

| Term | Meaning |
|------|---------|
| **Observation** (Day 0) | Reading runtime-adjacent variables from `check` signatures and IDE hover/inlays. |
| **Contracts** (Day 1) | Explicit obligations that `check` validates (`actual ⊭ expected`). |
| **contract** | Product term for those obligations: `*.nudo.js` sidecar / `@nudo:contract`. Handwritten = L1. |
| **sidecar** | `*.nudo.js` / `*.nudo.ts` module auto-bound to same-name source exports. Plain JS modules + builders (`fn`, `shape`, `number().gt(0)`). |
| **`@nudo:contract`** | In-source contract; the constraint enters Abs as a Pred. |
| **`@nudo:case`** | Debug witness for `nudo test` / LSP scenarios — **not** the contract product. |
| **L1** | Explicit contract layer: violations are errors (`actual ⊭ expected`). |
| **L2** | JS runtime export boundary: undigested entry/export may-throw (`nudo:entry-may-throw`, default error). |
| **call@** | Synthesized observation from a real call site (evidence). |
| **entry@** | Fallback observation for exports with no call sites; params display as `any`. |

## Engine

| Term | Meaning |
|------|---------|
| **B-path** | The single production evaluation engine: **transpile** the target into algebra calls (`$add`, `$fork`, …) then **`new Function`** execute on Abs. Named after the B-path implementation (`bpath-run`); the older AST-walk interpreter was removed. |
| **fail-closed** | On B-incapable sources or evaluation failure, the engine reports **no information** (`unknown` / empty exports) instead of guessing or falling back to another evaluator. Same idea for unprovable Pred goals and truncated cache keys. |
| **abstract interpretation** | The technique behind Nudo: execute on abstract values rather than concrete samples (tests) or pure AST analysis (classic type checkers). |
| **leqAbs** | Structural “is at least as defined as” check on Abs used for some assignment shapes. |
| **Pred implication** | The L1 gate: does the actual Abs imply the contract Pred? Bounded prover (linear / equality fragments); otherwise fail-closed. |

Deep dives: [Abs](/docs/concepts/abs) · [Abstract interpretation](/docs/concepts/abstract-interpretation) · [Concept layers](/docs/concepts/layers) · [Limits](/docs/concepts/limits) · [Diagnostics](/docs/reference/diagnostics) · [CLI](/docs/guides/cli).
