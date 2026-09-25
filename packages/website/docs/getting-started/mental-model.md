---
slug: /getting-started/mental-model
description: Ten minutes to a working Nudo mental model — plain JS, check, contracts, and retire tsc. No type language required.
---

# Mental model in 10 minutes

**You'll leave with:** how Nudo thinks about JavaScript, the three product verbs you need on day one, and how a migration off `tsc` ends.

This page does **not** lead with Abs algebra — Day 0 is signatures and cases. If you can read JS and run a CLI, you can finish it in ten minutes. Abs details wait in a collapsed box until you want `--abs`.

## The one-sentence model

Nudo **executes** your JavaScript on abstract values and reports what the code actually computes — then gates **contracts** you declare. Your source stays plain `.js`.

| You write | Nudo does |
|-----------|-----------|
| Plain `.js` + call sites | Observes real behavior and prints signatures |
| Optional `*.nudo.js` / `@nudo:contract` | Gates obligations (`actual ⊭ expected`) |
| Nothing extra | Still gates export may-throw (L2) in CI |

There is **no second type language**. Contracts are ordinary JS modules with builders like `number().gt(0)`.

## Minutes 0–3 — Day 0: read signatures and cases

Day 0 has **two faces**. Read those first — not Abs algebra.

| Face | Command | What you read |
|------|---------|---------------|
| **Signatures** | `nudo check` | What each export computes (params / return / may-throw) |
| **Cases** | `nudo test` *(optional debug)* | Per-call `call@` / entry witnesses — still not a CI obligation |

Create `calc.js`:

```javascript verify
export function scale(x) {
  return x + 1;
}

scale(5);
```

```bash
npx nudojs check calc.js
```

```text
signatures
  scale(x: any) => number | string
```

That is the whole Day 0 loop:

1. Write JS the way you already do.
2. Keep call sites (`scale(5)`) — they are **evidence**.
3. Run `nudo check`. It prints signatures even when everything passes.
4. (Optional) `nudo test` to see case witnesses — `@nudo:case` is debug-only.

Unconstrained parameters print as **`any`** (no obligation yet). The return here is the real JS `+` face (`number | string`). **`unknown`** means inference failed — engine debt, not your typing style.

<details>
<summary><strong>Later / Advanced — what those faces are made of (Abs)</strong></summary>

You do **not** need this paragraph to finish Day 0 or Day 1. Signatures and cases are the product face; Abs is the computation underneath.

**Abs** = `shape × term × pred × conf` — a computable type whose constraints participate in algebra (`x>0` ⇒ `x+1>1`).

| Component | Day-0 name | What it is |
|-----------|------------|------------|
| **shape** | the signature face you already read | `prim` / `obj` / `arr` / `fn` / `sum` / … |
| **term** | value identity | `lit` (exact `42`), `var` (symbolic `A1`), `app` (`x+1`) |
| **pred** | the `expected:` line in a violation | constraints on the term (`x > 0`) |
| **conf** | the `#exact` / `#path` marks | how exact the abstraction is |

**CLI entry (when you want it):**

```bash
nudo check calc.js --abs              # algebra face (shape + conf)
nudo check calc.js --abs --generalize # adds symbolic term/pred α
nudo check calc.js --abs --assume "x>0"
```

Deep dive: [Abs](../concepts/type-values.md) · layers note: [Advanced — Abs](../concepts/layers.md#advanced--abs).

</details>

## Minutes 3–6 — Day 1: declare one obligation

Contracts live in a sidecar next to the source (`calc.nudo.js`) or as `@nudo:contract` on a function. One form, builders only:

```javascript verify-sidecar
import { number, fn } from "@nudojs/core";

export const scale = fn({ x: number().gt(0) }, number());
```

Add a violating call:

```javascript verify
scale(0); // must be > 0
```

```bash
npx nudojs check calc.js
```

```text
issues
  [ERROR L6 scale] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

Every violation answers three questions:

| Field | Meaning |
|-------|---------|
| `actual:` | What the call site really carried |
| `expected:` | The contract Pred (not a type name) |
| `fix:` | A concrete next command |

`if` is **not** a refinement. Obligations come only from declarations you accept.

## Minutes 6–8 — the product face

| When | Command | What you get |
|------|---------|--------------|
| **Day 0** | `nudo check` | Signatures + L2 entry may-throw gate |
| **Day 1** | `nudo contract` + `nudo check` | Reviewed contracts, then the same gate |
| **Ecosystem** | `nudo export` | `.d.ts` / Zod / Standard Schema (lossy views) |
| **Leaving tsc** | `nudo migrate` | One-way door: `status` → `strip` → `verify` → `retire` |

Observation is **check signatures (+ optional cases) + IDE hover**. `nudo test` is an optional debug case reporter — not the main path. There is no `infer` verb.

## Minutes 8–10 — replace TypeScript, not sit beside it

Nudo’s end state for a JS package is: **no `tsc` in the loop**.

```bash
npx nudojs migrate status ./my-pkg
npx nudojs migrate strip ./my-pkg/src/index.ts
npx nudojs migrate verify ./my-pkg/src
npx nudojs migrate retire ./my-pkg
```

| Step | Effect |
|------|--------|
| `status` | Audit `.ts` count, `tsc` scripts, `typescript` dep, blockers |
| `strip` | `.ts` → `.js` (annotations out, runtime stays) |
| `verify` | `nudo check` must pass on the JS |
| `retire` | Drop `typescript`, rewrite `tsc` scripts → `nudo check` |

Coexistence with `tsc` is a **migration tactic only**. The exit is `retire`. Walkthrough: [Migrate from TypeScript](../guides/migrating-from-typescript.md) · real package story: [`docs/examples/retire-real/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-real).

## Four rules that save an hour

1. **Call sites are evidence.** More real calls → sharper signatures.
2. **`any` ≠ `unknown`.** `any` = unconstrained entry (you refine it). `unknown` = engine failed (we fix it).
3. **Contracts are obligations, not annotations.** They participate in algebra (`x>0` ⇒ `x+1>1`).
4. **`@nudo:case` is debug-only.** It does not create CI obligations.

## What you can ignore for now

- Abs (`shape × term × pred × conf`) — open the **Later / Advanced** box above only when you want `--abs`; deep page: [Abs](../concepts/type-values.md)
- Harvest / env internals — later: [Dependency types](../guides/env-harvest.md)
- Export dialects — only when a consumer needs `.d.ts` or validators

## Next

- [Quick Start](./quick-start.md) — same path with more output
- [Error faces](../guides/error-faces.md) — what violations look like next to `tsc`
- [AI-native DX](../guides/ai-native-dx.md) — agent loops, tokens · rounds · bugs
- [Nudo vs TypeScript](../guides/vs-typescript.md) — replace / not-replace map
- [Migrate from TypeScript](../guides/migrating-from-typescript.md) — retire `tsc`
- [Playground](/playground)
