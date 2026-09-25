---
slug: /guides/competitive-landscape
description: Where Nudo sits against TypeScript, Flow, Hegel, schema libraries, and refinement types — the division of labor, not a feature checklist.
---

# Competitive Landscape

**You'll leave with:** an honest map of what Nudo is for, what adjacent tools already own, and when you should *not* reach for Nudo.

Positioning deep-dive: [Nudo vs TypeScript](./vs-typescript.md) · Product face: [Why Nudo](../why-nudo.md) · What the engine does not claim: [Limits](../concepts/limits.md).

## Positioning map

Nudo is a **JS engineering gate**: it computes Abs facts by evaluating code, then checks **Pred implications** against explicit contracts. It is not a second type language, not a runtime validator, and not a theorem prover.

| | Type language in source | No type language in source |
|---|---|---|
| **Static / compile-time gate** | TypeScript · Flow | **Nudo** (Abs + Pred + `nudo check`) · Hegel (archived) |
| **Runtime / boundary validation** | — | Zod · ArkType · TypeBox · Valibot |
| **Proof-oriented refinement** | LiquidHaskell / SMT-backed refinements | *(not Nudo)* |

Two axes matter more than feature lists:

1. **Where the obligation is checked** — statically in CI (`nudo check`) vs at a runtime boundary (`parse` / `safeParse`).
2. **What the types are** — declared annotations / schema objects vs computable Abs values with Pred constraints.

## vs TypeScript

TypeScript is the default static gate for typed JS/TS. Nudo replaces that gate only for **JavaScript-first** packages — see the full map in [Nudo vs TypeScript](./vs-typescript.md).

The sharpest product boundary is in Microsoft's own [TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals). Non-goals there include:

> Apply a sound or "provably correct" type system. Instead, strike a balance between correctness and productivity.

> Add or rely on run-time type information in programs, or emit different code based on the results of the type system. Instead, encourage programming patterns that do not require run-time metadata.

Nudo's **throws** axis (L2 entry may-throw) and **Pred** axis (constraint implication on Abs) sit exactly on what those non-goals exclude: obligations derived from *runtime-shaped behavior*, not only from erasable structural annotations. That is not a TypeScript bug — it is a deliberate scope choice. Nudo takes the complementary scope.

Also: types are erased in TypeScript. Nudo keeps Abs as the model and treats `.d.ts` as a **one-way, lossy projection** (`nudo export --format dts`).

## vs Flow

Flow is still active (recent 0.333.x lines, Rust implementation work, a typed dialect with `component` / `renders` / `match`, exact objects, and a `this` receiver). Its differentiation is **syntax and safety defaults**, not annotation-free contract inference.

| | Flow | Nudo |
|---|---|---|
| Surface | `.js` / `.jsx` + Flow annotations | Plain `.js` (no type syntax required) |
| Differentiation | Typed dialect, exact objects, checker defaults | Contracts as computable Pred; facts from **evaluating** the code |
| Gate | Flow checker | `nudo check` (L1 contracts + L2 entry throws) |
| Types at runtime | Erased | Abs retained; runtime artifacts are `export` projections |

If you want Flow's dialect and its safety defaults, use Flow. If you want JS that stays JS and obligations that come from behavior plus accepted contracts, use Nudo.

## vs Hegel

Hegel (`JSMonk/hegel` on GitHub) was the closest conceptual neighbor: **strong inference without annotations**, plus a Typed Errors idea. **It was archived on 2024-01-29**; its README states development has stopped.

That leaves a real hole: the “infer a type gate for untyped JS without asking authors to write a type language” niche is **unfilled by an actively maintained tool**. Nudo occupies that hole with a different center of gravity — Abs algebra, explicit sidecar contracts (`*.nudo.js` / `@nudo:contract`), and a CI gate that prints signatures and cases.

## vs schema libraries (Zod, ArkType, TypeBox, Valibot)

These libraries are **boundary runtime validation**. They parse or `safeParse` data that *enters* the system. They are not static Pred implication over a program's internal computation.

:::tip Division of labor
**Schemas manage data that crosses the boundary; Nudo manages facts computed inside.**
:::

| | Zod / ArkType / TypeBox / Valibot | Nudo |
|---|---|---|
| When | `parse` / `safeParse` at an API / form / IO edge | `nudo check` on logic + contracts in CI |
| What | Shape of *incoming* data | Pred obligations on *computed* results and entry throws |
| Truth | The schema object | Abs (`shape × term × pred × conf`) |
| Compile-time | Schema-as-type helpers | Full Abs algebra (`x>0` ⇒ `x+1>1`) |

They compose: **`nudo export` projects Abs into schema dialects** (Zod dialect, Standard Schema, guards) so boundary code and CI agree on the same facts. The projection is one-way and lossy — Abs stays the source of truth. See [Runtime generation](./runtime-generation.md).

ArkType's library docs are at **arktype.io**. (`arktype.org` is an unrelated company — do not send readers there.)

## vs refinement types (LiquidHaskell and the SMT lineage)

LiquidHaskell and related systems use **predicate refinement types** discharged by an SMT solver — toward proofs about programs.

Inside the engine, Nudo's Pred layer is *analogous*: refinements are predicates on terms and they participate in implication. **Outwardly, do not describe Nudo as a theorem prover.** Nudo is a **JavaScript engineering gate**:

- No SMT backend, no proof certificates, no “verified” claim
- Fail-closed evaluation budget (call budget, widen to `unknown`) rather than incompleteness as a mathematical property
- Products are CI diagnostics, signatures, cases, and `export` projections — not proofs

Use the refinement-type lineage when you need machine-checked proofs. Use Nudo when you need a practical contract gate on JS.

## When *not* to use Nudo

Stay elsewhere when **any** of these dominates:

1. **The type language is the product.** Heavy generics / conditional / template-literal type programming, declaration merging, project references → TypeScript.
2. **You need Flow's dialect or checker culture.** Typed `component` / `renders` / `match`, exact-by-default object types → Flow.
3. **You only need boundary parse.** One-shot validation of external JSON → Zod / ArkType / TypeBox / Valibot alone is enough (add Nudo when internal arithmetic and contracts matter too).
4. **You need proofs.** Soundness / “provably correct” obligations → LiquidHaskell-style refinement types, not Nudo.
5. **You want fully automatic types with zero contracts and zero call sites.** Nudo observes what it can evaluate and otherwise reports `unknown`; it does not invent obligations. Unconstrained entry params display as **`any`**.

## LLM hybrid (SCAM 2026)

LLM type-inference research (e.g. SCAM 2026) fits a **hybrid** loop, not a replacement for a deterministic gate:

1. **LLM drafts** — contracts (`*.nudo.js`), `@nudo:contract`, or `@nudo:case` scenarios from code or prose.
2. **Nudo checks** — `nudo check` / `nudo test` decide with the Abs algebra (no sampling at CI time).
3. **Repair** — machine-readable `check --json` (`actual` / `expected` / `fix:` / `actions[]`) feeds the next draft round.

Drafts are never silent obligations: accepting a contract draft is what creates an L1 obligation. See [AI-native DX](./ai-native-dx.md) and [Agent integration](./agent-integration.md).

## Related

- **[Nudo vs TypeScript](./vs-typescript.md)** — when Nudo replaces `tsc`
- **[Why Nudo](../why-nudo.md)** — product face
- **[Runtime generation](./runtime-generation.md)** — `export` → Standard Schema / Zod / guards / `.d.ts`
- **[nudo check](./check.md)** — L1 contracts + L2 entry throws
- **[Limits](../concepts/limits.md)** — what the engine does not claim
- **[Mental model](../getting-started/mental-model.md)** — 10 minutes
