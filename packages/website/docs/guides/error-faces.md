---
slug: /guides/error-faces
description: Top Nudo error faces next to TypeScript — actual values, Preds, and a fix line. Runnable, CI-pinned samples.
---

# Error faces: Nudo vs TypeScript

**You'll leave with:** how Nudo violations read on a bad day of business code — and why they are faster to fix than `tsc` type names.

Goal: **not “report more.” Report more true, with evidence, and with a next step.**

Full CI-pinned suite: [`docs/examples/errors/`](https://github.com/nudojs/nudo/tree/main/docs/examples/errors) (`pnpm run verify:examples`). Deep Chinese write-up: [`docs/errors-vs-typescript.md`](https://github.com/nudojs/nudo/blob/main/docs/errors-vs-typescript.md).

## The face every violation shares

```text
      actual:   <Abs at the call site / RHS>
      expected: <contract Pred or existing shape>
      → <one line: how to change it>
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

You see **values and predicates**, not invented type names. `fix:` always points at a reviewable contract draft — accepting a draft is what creates an L1 obligation (never silent).

## Runnable tour (four faces)

The block below is the real gate: a bound Pred, a return Pred, a length Pred, an entry may-throw, and a shape reassignment — one `nudo check`.

```javascript verify
/// @nudo:import { delay, positive, nonEmpty } from "./error-faces.nudo.js"

/**
 * @nudo:contract ms delay
 */
export function setDelay(ms) {
  return ms;
}

/**
 * @nudo:contract return positive
 */
export function bad() {
  return 0;
}

/**
 * @nudo:contract s nonEmpty
 */
export function tag(s) {
  return "[" + s + "]";
}

export function getName(user) {
  return user.name;
}

export let config = { host: "localhost", port: 8080 };
config = { host: "y" };

setDelay(0);
bad();
tag("");
```

```javascript verify-sidecar
import { number, string } from "@nudojs/core";

export const delay = number().gt(0);
export const positive = number().gt(0);
export const nonEmpty = string().min(1);
```

```bash
npx nudojs check error-faces.js
```

```text
nudo check  error-faces.js
FAILED
  5 error · 0 warning · 0 info · 4 fn

signatures
  setDelay(ms: number) => number
  bad() => 0
  tag(s: string) => string
  getName(user: any) => any  throws TypeError

issues
  [ERROR bad] bad: return value ⊭ @nudo:contract return positive  (nudo:constraint-violated)
      actual:   0  #exact
      expected: return > 0
      → return a value satisfying > 0
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)

  [ERROR L24 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)

  [ERROR L31 setDelay] setDelay[ms]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: ms > 0
      → use a value satisfying ms > 0, or relax the precondition on ms
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)

  [ERROR L33 tag] tag[s]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   ""  #exact
      expected: length(s) ≥ 1
      → use a value whose length is ≥ 1, or relax the precondition on s
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)

  [ERROR L29 config] config: assignment ⊭ existing shape  (nudo:assign-mismatch)
      actual:   { host: "y" }  #exact
      expected: { host: "localhost", port: 8080 }  #exact
      → missing slot port
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

Each issue is independent — fix them in any order. On GitHub Actions / GitLab, `nudo check` also emits inline annotations / Code Quality rows.

## Top faces side by side

| # | Situation | TypeScript | Nudo |
|---|-----------|------------|------|
| 1 | `setDelay(0)` bound | Often **silent** (`ms: number` is legal) | `actual: 0 #exact` · `expected: ms > 0` |
| 2 | `greet({ id: 2 })` missing `name` | Needs an `interface` first, or a property error | `missing field u.name` · shape in one sidecar |
| 3 | `config = { host: "y" }` drops `port` | Depends on inference; silent on wide types | `assign-mismatch` · `missing slot port` |
| 4 | `user.name` on unconstrained `user` | **No throws story** — runtime explosion | `throws TypeError` + L2 `entry-may-throw` in CI |
| 5 | `return 0` under `positive` | `number` return accepts `0` | `return value ⊭ …` · `expected: return > 0` |
| 6 | real `+` (`x + 1`) | Often claims `number` (lies about `"7"`) | Honest `number \| string`, or the contract blocks the call |
| 7 | `n = "str"` after `n = 2` | Familiar type name, no value | `prim string ⊭ prim number` · `#exact` literals |
| 8 | `tag("")` length bound | `string` is legal; needs a branded type | `length(s) ≥ 1` · `actual: ""` |
| 9 | several violations at once | Nested generic noise | One `actual`/`expected`/`fix:` per site |
| 10 | how do I fix this? | “Not assignable” | **`fix: nudo contract --draft`** |

Why these are easier to fix: the report is a **value and a predicate**, plus one next command — not a type-name riddle.

## Reading `actual` / `expected`

| You see | It means |
|---------|----------|
| `#exact` | Literal / fully known Abs at that site |
| `expected: ms > 0` | A **Pred** from the accepted contract (participates in algebra) |
| `missing field u.name` | Structural face of the shape you declared |
| `throws TypeError` | The JS runtime effect on that entry — gated as L2 |

Codes and more examples: [Diagnostics](../reference/diagnostics.md).

## Related

- [Mental model](../getting-started/mental-model.md) — 10-minute product face
- [nudo check](./check.md) — L1 + L2 gate
- [Contracts](./contract.md) — draft / accept
- [Nudo vs TypeScript](./vs-typescript.md)
- Runnable matrix: [`docs/examples/errors/`](https://github.com/nudojs/nudo/tree/main/docs/examples/errors)
