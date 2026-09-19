---
sidebar_position: 9
slug: /guides/vs-typescript
description: Where Nudo replaces TypeScript, where it does not, and how the two coexist — honest positioning.
---

# Nudo vs TypeScript

**You'll leave with:** an honest map of when Nudo can replace TypeScript as a JS-first type gate, when TypeScript should stay primary, and how the two coexist in one repo.

Nudo is built to **replace TypeScript as the day-to-day type gate for JavaScript-first codebases** — not to reimplement the TypeScript compiler. This page is the honest map: when that replacement is real, when it is not, and how the two tools share a repo.

## Positioning

| | TypeScript | Nudo |
|---|---|---|
| **Primary surface** | `.ts` sources + annotations | Plain `.js` (type syntax stripped if you pass `.ts`) |
| **Type model** | Declared structural types | **Abs** (`shape × term × pred × conf`) — computable types from abstract interpretation |
| **Contracts** | `interface` / `type` language | `*.nudo.js` builders (`fn`, `shape`, `number().gt(0)`) + optional `@nudo:refine` |
| **Inference** | From annotations + local inference | From **executing** code on symbolic Abs (B-path / ast-eval) |
| **CI gate** | `tsc --noEmit` | `nudo check` (`actual ⊭ expected` on Abs) |
| **Ecosystem exit** | `.d.ts` is the model | `.d.ts` is a **lossy projection** (`absToTSType`) — not the source of truth |

The goal is not “TS syntax on JS.” The goal is: **JS stays JS**, obligations come from explicit interfaces or call-site facts, and the engine reasons by evaluation rather than by a second type language.

## When Nudo is the right replacement

Prefer Nudo when **all** of these are true:

1. **The package is JavaScript-first.** You do not want a second IR (`.ts` + annotations) just to get types.
2. **Behavior beats declared shape.** Branching, string algebra, loops, and refinements matter more than “does this object structurally match an interface.”
3. **Contracts are product requirements.** You want `nudo check` in CI: bounds, shape obligations, HOF arity — enforced from sidecars, not from body AST scans.
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
| CI type gate | `nudo check` — exit 1 on `error` issues |
| Explicit contracts | `*.nudo.js` + `@nudo:refine`; handwritten = obligation |
| Generated facts | `nudo interface --emit` → `@generated` segments (drift, not silent rewrites of obligations) |
| npm / editor types | `nudo emit` / infer `--dts` — projection only |
| Performance story | `benchmark` + `benchmark:gate`：case 集规模一致；exact 回退超过 1-case 抖动 / unknown·error 上升 / 逐 case 顺序变差 / avg > 基线 3.0× → fail |

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
- **[Language semantics](./semantics.md)** — what is precise, what degrades to `unknown`
- **[Quick start](../getting-started/quick-start.md)** — 30-minute path
