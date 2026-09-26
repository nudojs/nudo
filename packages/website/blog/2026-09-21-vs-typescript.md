---
date: 2026-09-21
slug: vs-typescript
title: Nudo vs TypeScript — when a JS-first gate is the right tool
authors: [default]
tags: [nudo, typescript, type-inference, launch-series]
---

> **Launch series** (3/5) — published together on 2026-09-21. Read in order:
> [Day 0 — observe JavaScript without rewriting it](/blog/day0-observe) · [Contracts are JS — Day 1 with sidecar *.nudo.js](/blog/day1-contracts) · **Nudo vs TypeScript — when a JS-first gate is the right tool** · [Nudo for coding agents — agents.md, agent integration, stable diagnostics](/blog/agents-docs) · [The 22-file smear: how call-site attribution almost shipped fake precision](/blog/attribution-gate)

Honest positioning: Nudo is built to **replace TypeScript as the day-to-day type gate for JavaScript-first codebases** — not to reimplement the TypeScript compiler.

| | TypeScript | Nudo |
|---|---|---|
| Primary surface | `.ts` + annotations | Plain `.js` |
| Contracts | Type language | `*.nudo.js` builders + `@nudo:contract` |
| Inference | From annotations | From **executing** code on Abs |
| CI gate | `tsc --noEmit` | `nudo check` |
| `.d.ts` | The model | A **lossy projection** of Abs |

<!-- truncate -->

## Prefer Nudo when

- The package is JavaScript-first and you refuse a second IR just to get types
- Behavior (branches, string algebra, loops, bounds) matters more than declared interfaces
- You want runtime-shaped obligations in CI without body-AST slot invention

## Keep TypeScript primary when

- The codebase is `.ts`-first
- You need the full TS type language as programming
- Your ecosystem is DefinitelyTyped / project references

## Coexistence

Split **by package**: JS packages on Nudo LSP + `nudo check`; TS packages on `tsc`. See [coexistence](/docs/guides/coexistence) and [limits](/docs/concepts/limits).

Full map: [Nudo vs TypeScript](/docs/guides/vs-typescript) · [Migrate from TS](/docs/guides/migrating-from-typescript).
