---
title: Nudo vs TypeScript — when a JS-first gate is the right tool
authors: [default]
tags: [nudo, typescript, type-inference]
---

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
