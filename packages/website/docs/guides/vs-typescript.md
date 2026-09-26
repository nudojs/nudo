---
slug: /guides/vs-typescript
description: Nudo vs TypeScript — where the replacement happens (DX and fact quality), how declaration and inference differ, and the scope bounds of “replace.”
---

# Nudo vs TypeScript

Code understanding, robustness, and language continuity — how those needs divide between Nudo and TypeScript is what this page answers.

Related: [Migrate from TypeScript](./migrating-from-typescript.md) · [Why Nudo](../why-nudo.md) · [Error faces](./error-faces.md).

Nudo is built to **replace TypeScript as the day-to-day type check gate** — not to reimplement the TypeScript compiler. Dual gates are a migration tactic only; the exit is `nudo migrate retire`. **Whether the tree is JS or TS today is not a selection criterion** — Nudo analyzes TypeScript (annotations stripped, JS semantics) and ships a one-way `migrate` path. The sections below compare dimensions and state engine scope, not a permanent “keep tsc” checklist.

## Positioning

| | TypeScript | Nudo |
|---|---|---|
| **Primary surface** | `.ts` + type annotations | Plain `.js` (type syntax is stripped if `.ts` is passed) |
| **Type model** | Declared structural types | **Abs** (`shape × term × pred × conf`) — computable types |
| **Contracts** | `interface` / `type` language | `*.nudo.js` builders (`fn`, `shape`, `number().gt(0)`) + optional `@nudo:contract` |
| **Inference** | Annotations + local inference | **Executing** code on symbolic Abs (B-path) |
| **Check / diagnostics** | `tsc --noEmit` | `nudo check` (`actual ⊭ expected` on Abs; signatures even on success) |
| **Ecosystem exit** | `.d.ts` is the model | `.d.ts` is a **lossy projection** (`absToTSType`) — not the source of truth |
| **Leaving the other tool** | — | `nudo migrate` → **`retire` tsc** |

The goal is not “TypeScript syntax on JavaScript.” The goal is: **JavaScript remains JavaScript**; obligations come from explicit contracts (L1) and the JS runtime export boundary (L2 entry throws); the engine reasons by evaluation, not by a second type language.

### Relation to TypeScript design goals

Microsoft’s [TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals) list two non-goals that sit on Nudo’s main axes:

> Apply a sound or "provably correct" type system. Instead, strike a balance between correctness and productivity.

> Add or rely on run-time type information in programs, or emit different code based on the results of the type system. Instead, encourage programming patterns that do not require run-time metadata.

The **throws** axis (L2 entry may-throw) and the **Pred** axis (constraint implication on Abs) are therefore outside TypeScript’s roadmap by design. Nudo takes that complementary scope. Full map against Flow, Hegel, schema libraries, and refinement types: [Competitive landscape](./competitive-landscape.md).

| Goal | TypeScript | Nudo |
|---|---|---|
| Code understanding | Source annotations / IDE hover shows declared types | `check` signatures and per-variable derivations; call-site evidence |
| Check / diagnostics | `tsc --noEmit` | `nudo check` (signatures even on success) |
| Entry safety | `any.prop` does not error | Dangerous operations on entry `any` enter the throws domain; L2 can error |
| Violation shape | “Not assignable to type …” | [`actual` / `expected` / `fix:`](./error-faces.md) |

## Where the replacement happens

The comparison is **developer experience and fact quality**, not file extensions:

| Dimension | TypeScript | Nudo |
|---|---|---|
| Annotation burden | Write logic and a type language in parallel | Logic stays JS; contracts optional and draftable via `contract --draft` |
| Observation grain | Declared type names | Per-variable runtime-adjacent values / shapes / constraints |
| Constraint expression | Structural types (`number`) | Computable Pred (`ms > 0`, returns `> 0`) |
| Semantic source | Annotations + local inference | Execution on Abs; call sites are evidence |
| Error shape | “Not assignable to type …” | `actual` / `expected` / `fix:` |
| Source of truth | Source annotations | Abs; `.d.ts` and similar are lossy projections |
| Edit-path cost | Whole-program structural residency (`tsserver`) | Per-file / dirty-set Abs evaluation; bounded memory |
| Agent loop cost | Prose diagnostics; full-project rounds | Structured `actions[]`; cheaper gate payloads (see below) |
| Migration cost | — | `migrate status → strip → verify → retire` |

Contracts can be **declared first** (sidecar / `@nudo:contract`) or **drafted from code** and then tightened by hand; the declaration surface is sharper than `interface` (numeric and shape constraints). “Types first vs logic first” is not the divide between TypeScript and Nudo.

## Performance, tokens, and memory

Full comparative suites are still incomplete. Direction is established by **architecture** and by the measurements already in-repo; treat numbers as baselines to be widened, not as a closed benchmark.

### Why the cost structure favors Nudo

| Factor | TypeScript | Nudo |
|---|---|---|
| What is resident | Whole-`Program` structural typing — any cross-file shape can change any decision | Per-file Abs results + small bookkeeping; close a file, drop its analysis |
| Edit path | Language-service / program refresh | Dirty-set re-analysis; single-file `analyzeFile` / `checkSource` |
| What agents must read | Type-name prose (“Not assignable to type …”) | `actual` / `expected` / `actions[]` — fewer repair rounds |
| What authors must write | Annotations + type-level work | Optional contracts; no second language in source |

### Measurements already available

| Probe | Nudo | TypeScript | Notes |
|---|---|---|---|
| Single-file live edit | `analyzeFile` **0.19 ms**, `checkSource` **0.39 ms** median | `tsc.LS` on the order of **10 ms+** per probe in `benchmark/micro/bench-vs-tsc` (≈ **150×** in the micro harness) | Synthetic monorepo / micro workload; see `docs/reports/s1-perf-baseline.md` |
| Agent repair (node-semver historical bugs, ~2.4k LOC) | tokenTotal **569k** · rounds **45** · repair loops **16** · gate peak RSS **226 MB** | **993k** (**+75%**) · **63** · **21** · **289 MB** | Both finished 6/6; the gap is cost, not detect ceiling — `benchmark/lsp-rounds/out/OSS-SEMVER.md` |
| Constraint-shaped gate payload | detects; pays tokens to **report** | often **silent green** (no tokens, bug ships) | `pnpm run agent-dx` — TS “cheap” tokens are silence |

### Boundaries of the claim

- Micro and S1 corpora are **synthetic**; OSS-SEMVER is one real package family. Absolute SLOs need broader suites.
- Peak RSS is **gate process** RSS during agent loops, not steady-state IDE residency.
- Memory advantage is **structural** (no whole-program forced residency) and shows up in LSP design ([bounded session model](../api/lsp.md)); long-running multi-GB `tsserver` heaps vs Nudo LSP under the same editor load are not yet a published matrix.

More complete tables (multi-package cold/warm, multi-host) will replace this section as they land.

## Capability bounds (engine non-goals)

These are **Nudo engine non-goals** — not the same question as “should this package keep `tsc` as its gate forever”:

1. **Full TS type-language programming**: conditional types, template-literal type programming, mapped types as programming devices.
2. **Bit-for-bit `tsc` assignability**: Nudo’s gate is Pred implication on Abs and some `leqAbs` shapes.
3. **Declaration merging / project references as product IR**: the TypeScript project model is not reimplemented.
4. **Soundness proofs**: no soundness claim, and no head-to-head contest on “a stricter type system.”

If **the product is the type language itself** (type-level libraries, DefinitelyTyped-style declaration surfaces), TypeScript is the tool for that work. For ordinary application and tooling packages, the check gate still ends at **`nudo check` + `migrate retire`** — not permanent dual gates.

## What “replace TypeScript” means here

For a **package**, the full replacement checklist is:

| Capability | Nudo path |
|---|---|
| Open a normal `.js` file, get hover / inlay | LSP + `package.json#nudo.analysis.mode` (default `exports`; `all` / `directives` available) |
| Observation | `nudo check` signatures (no `infer` verb) |
| Check gate | `nudo check` — exit 1 on error-level diagnostics (L1 + non-ignored L2); attachable to any local or automated workflow |
| Explicit contracts | `*.nudo.js` + `@nudo:contract`; handwritten = L1 obligation |
| Generated facts | `nudo contract --emit` → `@generated` segments (drift records, not silent rewrites of obligations) |
| npm / editor types | `nudo export --format dts` — one-way projection only |
| **Retire tsc** | `nudo migrate status` → `strip` → `verify` → **`retire`** |
| Performance baseline | Repo `benchmark` + `benchmark:gate` — same case-set size; fail on exact regressions beyond 1-case jitter, rising unknown/error counts, per-case order worse than baseline, or average > 3.0× baseline |

What is **not** claimed: one-click migration of a TS monorepo of any size; full structural typing as the primary model; a second IR; bit-for-bit `tsc` semantics.

## Side-by-side example

**TypeScript (declared):**

```ts
export function needsPositive(x: number): number {
  return x > 0 ? x : 0;
}
needsPositive(-1); // allowed by tsc
```

**Nudo (contract + diagnostics):**

```javascript
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x > 0 ? x : 0;
}

needsPositive(-1);
// nudo check → nudo:constraint-violated
//   actual:   -1  #exact
//   expected: x > 0
```

TypeScript encodes intent in the signature. Nudo encodes the same obligation as a **computable** constraint and reports the violating call site. Both are valid; only the latter avoids a type language. More shapes: [Error faces](./error-faces.md).

## Migration, not permanent dual gates

In a monorepo, migrate **package by package**, then retire:

```bash
npx nudojs migrate status packages/tool
npx nudojs migrate strip packages/tool/src --write
npx nudojs migrate verify packages/tool/src
npx nudojs migrate retire packages/tool
```

Short-lived dual jobs during migration are a tactic, not an end state — see [Coexistence](./coexistence.md). The product end state is **one gate: `nudo check`**.

## Related

- **[Why Nudo](../why-nudo.md)** — needs and answers
- **[Mental model](../getting-started/mental-model.md)** — Observation
- **[Error faces](./error-faces.md)** — `actual` / `expected` / `fix:`
- **[Concept layers](../concepts/layers.md)** — Observation / Contracts / Abs
- **[nudo check](./check.md)** — diagnostic codes and contract tiers
- **[Language semantics](../concepts/semantics.md)** — what is precise, what degrades to `unknown`
- **[Quick start](../getting-started/quick-start.md)**
