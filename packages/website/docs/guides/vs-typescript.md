---
slug: /guides/vs-typescript
description: Where Nudo replaces TypeScript, where it does not, and how the two coexist — honest positioning.
---

# Nudo vs TypeScript

**You'll leave with:** an honest map of when Nudo can replace TypeScript as a JS-first type gate, when TypeScript should stay primary, and how the two coexist in one repo.

Practical migration steps: [Migrate from TypeScript](./migrating-from-typescript.md) · Product positioning: [Why Nudo](../why-nudo.md).

Nudo is built to **replace TypeScript as the day-to-day type gate for JavaScript-first codebases** — not to reimplement the TypeScript compiler. This page is the honest map: when that replacement is real, when it is not, and how the two tools share a repo.

## Positioning

| | TypeScript | Nudo |
|---|---|---|
| **Primary surface** | `.ts` sources + annotations | Plain `.js` (type syntax stripped if you pass `.ts`) |
| **Type model** | Declared structural types | **Abs** (`shape × term × pred × conf`) — computable types from abstract interpretation |
| **Contracts** | `interface` / `type` language | `*.nudo.js` builders (`fn`, `shape`, `number().gt(0)`) + optional `@nudo:refine` (alias `@nudo:interface`) |
| **Inference** | From annotations + local inference | From **executing** code on symbolic Abs (B-path / ast-eval) |
| **CI gate** | `tsc --noEmit` | `nudo check` (`actual ⊭ expected` on Abs) |
| **Ecosystem exit** | `.d.ts` is the model | `.d.ts` is a **lossy projection** (`absToTSType`) — not the source of truth |

The goal is not “TS syntax on JS.” The goal is: **JS stays JS**, obligations come from explicit contracts (L1) plus the JS runtime export boundary (L2 entry throws), and the engine reasons by evaluation rather than by a second type language.

| TS | Nudo |
|----|------|
| Types written in source / IDE hover | Day 0: `nudo check` prints signatures; `nudo test` prints cases |
| `tsc --noEmit` | `nudo check` (still prints signatures on success) |
| `any.prop` does not error | Dangerous ops on `any` at entry enter the **throws** domain; L2 can error |
| No `tsc show` | Observation is check/test/IDE output |

## When Nudo is the right replacement

Prefer Nudo when **all** of these are true:

1. **The package is JavaScript-first.** You do not want a second IR (`.ts` + annotations) just to get types.
2. **Behavior beats declared shape.** Branching, string algebra, loops, and refinements matter more than “does this object structurally match an interface.”
3. **Contracts are product requirements.** You want `nudo check` in CI: L1 bounds/shape obligations from sidecars + L2 entry may-throw on exports — not body AST slot scans.
4. **You refuse a second type language.** Contracts are JSON-like builders, not `interface` / mapped / conditional types.

Typical fits: tooling CLIs, script layers, plugin hosts, data pipelines in plain JS, repos that already have rich tests (call-site mining works well there).

## When TypeScript should stay primary

Do **not** expect Nudo to replace `tsc` when:

1. **The codebase is `.ts`-first.** Annotations, generics, and the TS language service are the product. Nudo can read stripped TS, but it is not a TypeScript compiler clone.
2. **You need the full TS type language.** Conditional types, template-literal type *programming*, declaration merging, and project-wide structural assignability are **non-goals** (see the roadmap’s non-targets).
3. **Your ecosystem is typed packages.** Definitely-typed style APIs, declaration merging with third-party `.d.ts`, and `tsc` project references stay on the TS side.
4. **The gate is “does this assign like TS.”** Nudo’s gate is Pred implication on Abs and `leqAbs` for some assignment shapes — not bit-for-bit TS assignability.

Those cases are real. Pointing `nudo check` at a TS monorepo is not the product path.

## What “replace TypeScript” means here

For a **JS package**, the serious-replacement checklist is:

| Capability | Nudo path |
|---|---|
| Open a normal `.js` file, get hover / inlay | LSP + `package.json#nudo.analysis.mode` (default `exports`; `all` / `directives` available) |
| Day-0 observation | `nudo check` signatures + `nudo test` cases (no `infer` verb) |
| CI type gate | `nudo check` — exit 1 on error issues (L1 + non-ignored L2) |
| Explicit contracts | `*.nudo.js` + `@nudo:refine`; handwritten = L1 obligation |
| Generated facts | `nudo contract --emit` → `@generated` segments (drift, not silent rewrites of obligations) |
| npm / editor types | `nudo export --format dts` — one-way projection only |
| Performance story | Repo `benchmark` + `benchmark:gate` — same case-set size; fail on exact regressions beyond 1-case jitter, rising unknown/error counts, per-case order worse than baseline, or avg > 3.0× baseline |

What is **not** claimed: one-click migration of a large TS monorepo; full structural typing as the primary model; a second IR.

## Side-by-side example

**TypeScript (declared):**

```ts
export function needsPositive(x: number): number {
  return x > 0 ? x : 0;
}
needsPositive(-1); // allowed by tsc
```

**Nudo (contract + gate):**

```javascript
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 */
export function needsPositive(x) {
  return x > 0 ? x : 0;
}

needsPositive(-1);
// nudo check → nudo:constraint-violated
//   actual:   -1  #exact
//   expected: x > 0
```

TypeScript encodes intent in the signature. Nudo encodes the same obligation as a **computable** constraint and fails the call site. Both are valid; only one requires a type language.

## Coexistence

In a monorepo you usually **split by package**, not by feature inside one TS project:

- JS packages → Nudo LSP + `nudo check`
- TS packages → `tsc` / ts-node as today

Recipes (include/exclude globs, gradual contracts, CI snippets): **[Coexistence with TypeScript](./coexistence.md)**.

## Related

- **[Concept layers](../concepts/layers.md)** — Day-0 / Day-1 / Abs
- **[nudo check](./check.md)** — diagnostic codes and interface tiers
- **[Language semantics](../concepts/semantics.md)** — what is precise, what degrades to `unknown`
- **[Quick start](../getting-started/quick-start.md)** — 30-minute path
