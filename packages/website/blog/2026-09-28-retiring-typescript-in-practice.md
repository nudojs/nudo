---
date: 2026-09-28
slug: retiring-typescript-in-practice
title: "We retired tsc on our JavaScript packages — and the gate got sharper"
authors: [default]
tags: [engineering, typescript, migrate, case-study]
---

> The `tsc --noEmit` line on your JavaScript packages can retire. Start with zero annotations, add contracts only where you accept them, read violations as **value ⊭ predicate + a next step** — and exit through `migrate retire`, not by dual-running two compilers forever.

Most teams keep `tsc --noEmit` around not because they enjoy writing annotations, but because there was no other CI gate to reach for. Nudo's answer is not "write a second type language". It is three commitments:

1. **JS stays JS** — no runtime changes, no invented second IR.
2. **Contracts on demand** — `*.nudo.js` / `@nudo:contract`; obligations only come from declarations you accept.
3. **A one-way door** — `nudo migrate status → strip → verify → retire`. The exit is **retire tsc**, not dual-run.

We pinned this story with three runnable samples, not slides: a public checkout-demo, and two real npm consumers.

<!-- truncate -->

## Why we dared to drop the old gate

`nudo check` is a Pred-implication gate over Abs (shape × term × pred × conf) — types are computable values, so `x>0` implies `x+1>1` instead of degrading to `number`. The gate is held to gold standards, not vibes: recall = precision = 1.0 on the check suites, plus real-package zero-false-positive tests. That is what lets `nudo check` be *the* gate rather than an advisory layer.

The evidence trail is committed and re-runnable (`pnpm run verify:examples`):

| Case | Dependency | End state |
|------|------------|-----------|
| checkout-demo | synthetic small lib | `nudo check` as the only gate |
| **ms** (vercel/ms) | real npm | dependency untouched; consumer is plain JS + Nudo |
| **debug** (visionmedia/debug) | real npm | same; native returns honestly stay `unknown` |

`ms` and `debug` are real packages, not synthetic fixtures — the consumers moved, the dependencies did not.

## The four-step door

```text
audit (migrate status) → strip → verify (nudo check) → retire (drop tsc)
```

Copy-ready, with paths swapped for your package:

```bash
# 0. audit — what still carries tsc
npx nudojs migrate status ./my-pkg

# 1. strip — .ts → .js (annotations out, runtime stays). --write to emit.
npx nudojs migrate strip ./my-pkg/src --write

# 2. optional — reverse old annotations into a reviewable contract draft
npx nudojs contract --from-dts ./my-pkg/src/index.ts
#    → @nudo:draft (NOT enforced until you copy it into *.nudo.js)

# 3. verify — nudo check must pass on the stripped JS
npx nudojs migrate verify ./my-pkg/src

# 4. retire — drop typescript, rewrite tsc scripts / GHA lines, write marker
npx nudojs migrate retire ./my-pkg --dry-run   # then drop --dry-run
```

| Step | Effect | Exit when |
|------|--------|-----------|
| `status` | Counts `.ts`, finds `tsc` scripts + `typescript` dep, lists **blockers** | You know the surface area |
| `strip` | `.ts` → `.js`; optional best-effort sidecar draft | Sources are plain JS |
| `verify` | Runs `nudo check` on the stripped JS (optional `--with-tsc` dual-run **during** the move only) | Gate is green |
| `retire` | Drops `typescript`, rewrites `tsc` scripts → `nudo check`, rewrites `.github/workflows`, writes `.nudo/migrate-retired.json` | **tsc is gone** |

Two details do the heavy lifting for trust. The `--from-dts` draft is **never silent**: old annotations become obligations only after you review and copy them into a `*.nudo.js`. And dual-run exists solely as `migrate verify --with-tsc` mid-move — coexistence is a migration tactic, never the endgame.

## What a violation reads like

After the move, violations are values and predicates, not type names:

```text
actual:   0  #exact
expected: ms > 0
→ use a value satisfying ms > 0
fix:  nudo contract --draft
```

Not "report more" — **report truer, with evidence and a next step**. The faces are documented in [Error faces](/docs/guides/error-faces).

## The honest limits

Every sample above is **example-scale** (2–3 modules each) from `docs/examples/` — timings and friction counts are example-scale, not a production migration audit. We do not publish production-size hour/day numbers, and a "7-day retire path" is a product target, not a measured median: budget a real package by the `.ts` file count that `migrate status` reports, not by a blog post.

Native or unharvested dependencies stay visible as engine debt: `ms()` and `debug()` returns show `unknown` / `conf=opaque` with a `nudo:unknown-inference` or `nudo:opaque-result` warning and a fix path (`@types/*` harvest, `@nudo:mock`, or `refine return`). Honest debt stays a warning until you pin it — it is never faked as success.

## The workflow after

`nudo check` is the only gate, and signatures print **even on success** — unconstrained entry params display as `any`, true `unknown` means inference failed. Intentional `throw`s surface as L2 (`nudo:entry-may-throw`) with the exact next step (`@nudo:throws`, guard, or a softer `package.json` setting for week one). Tighten later and the faces become value + predicate.

The full command walkthrough, before/after code and diagnostics, and the friction table: [Case study: retire tsc](/docs/guides/case-study-retire). The door itself is documented in [Migrate from TypeScript](/docs/guides/migrating-from-typescript); if you are new to Nudo, start with the [Quick Start](/docs/getting-started/quick-start).
