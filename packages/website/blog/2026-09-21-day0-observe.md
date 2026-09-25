---
title: Day 0 — observe JavaScript without rewriting it
authors: [default]
tags: [nudo, type-inference, check]
---

Welcome back to JavaScript. Nudo does not ask you to rewrite a JS package in another language surface before you can see types or gate obligations.

**Day 0 product face:** `nudo check` prints signatures on success and failure. Call sites are evidence. Unconstrained entry params display as **`any`** — not `unknown`. Optional `nudo test` reports cases for debugging; it is not the CI gate.

```bash
npx nudojs check src/
```

```text
signatures
  subtract(a: any, b: any) => number
```

Even without sidecar contracts, export functions carry the L2 runtime boundary: undigested may-throw on entry functions is an error (`nudo:entry-may-throw`), filterable while you migrate.

Try it in the [Playground](/playground), or read the [Quick Start](/docs/getting-started/quick-start).

<!-- truncate -->

## Why Day 0 matters

TypeScript’s default story is “annotate first.” Nudo’s default story is **observe first**: run the abstract interpreter on Abs, print what execution computed, and only then decide which obligations you want to write down.

That matches codebases that are JavaScript-first — tooling CLIs, script layers, plugin hosts — where rewriting into `.ts` is not the product path.

## Next

Day 1 is contracts: `*.nudo.js` / `@nudo:contract`, then `nudo check` L1 gates (`actual ⊭ expected`). See [nudo contract](/docs/guides/contract).
