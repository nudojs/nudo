---
slug: /reference/glossary
description: Glossary — Abs, any vs unknown, L1/L2, contract vs case, call@, conf.
---

# Glossary

| Term | Meaning |
|------|---------|
| **Abs** | Nudo's only type system: `shape × term × pred × conf`. Computable values; constraints participate in algebra. |
| **shape** | Extensional carrier (`prim` / `obj` / `arr` / `fn` / `sum` / `any` / `unknown` / …). |
| **term** | Abstract value identity: `lit` / `var` / `app` (e.g. `(x + 1)`). |
| **pred** | Constraint relative to the term (e.g. `x > 0`). |
| **conf** | Abstraction confidence: `exact` / `path` / `widened` / `mock` / `partial` / `opaque`. |
| **any** | Unconstrained JS value union — default for entry params without contracts. Developer refines. |
| **unknown** | Inference failed / engine debt — **not** the same as `any`. |
| **contract** | Product term for obligations: `*.nudo.js` sidecar / `@nudo:refine`. |
| **`@nudo:refine`** | In-source refinement contract; constraint enters Abs as Pred. |
| **`@nudo:interface`** | Exact alias of `@nudo:refine`. Not a separate product surface. |
| **`@nudo:case`** | Debug witness for `nudo test` / LSP scenarios — **not** the contract product. |
| **L1** | Explicit contract obligations (`actual ⊭ expected` → error). |
| **L2** | Default JS runtime boundary: entry/export undigested may-throw (`nudo:entry-may-throw`). |
| **call@** | Synthesized call-site observation from real usage evidence. |
| **entry@** | Fallback observation for exports without call sites; params display as `any`. |
| **sidecar** | `*.nudo.js` / `*.nudo.ts` module auto-bound to same-name source exports. |
| **projection** | One-way lossy view of Abs (`formatShape`, `absToTSType`, schema source). Nothing reads a projection back. |
| **check** | Day-0/CI verb: gate + always-print signatures. |
| **contract (verb)** | Print / draft / emit contract surface. |
| **export (verb)** | Project Abs → dts / guard / schema / standard. |
| **test (verb)** | Optional debug case reporter — not the primary product narrative. |
| **health** | Analysis errors + solidification drift. |

Deep dives: [Abs](/docs/concepts/type-values) · [Limits](/docs/concepts/limits) · [Diagnostics](/docs/reference/diagnostics).
