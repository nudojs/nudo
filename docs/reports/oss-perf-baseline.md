# OSS package performance & precision baseline (real JS packages)

> **Generated** by `benchmark/oss/bench-oss.mts` (`pnpm run benchmark:oss`).
> Do not hand-edit numbers — regenerate.
>
> **Corpus:** real `node_modules` **JavaScript** packages (**commander / yargs / semver / eventemitter3 / kleur / ms / is-plain-obj / escape-string-regexp / p-limit / yocto-queue**).
> This baseline is **Nudo’s product face** (JS-first analysis + L1 zero-FP). Regression gate: `pnpm run benchmark:oss:gate`.

- Generated at: 2026-11-04T11:50:54.558Z
- Node: v26.10.0
- Scale: 10 packages · **94 JS files** · 407 KB source

## Summary (Nudo product metrics — gated)

| Package | Files | Scanned | **L1 FP** | Cold analyze (ms) | Check all (ms) | Hub dirty | Hub edit (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `commander` | 7 | 7 | **0** | 4246.39 | 920.6 | 6 (4 deps) | 3678.63 |
| `yargs` | 23 | 23 | **0** | 6845.93 | 4385.36 | 8 (5 deps) | 5522.26 |
| `semver` | 49 | 49 | **0** | 1956.88 | 2564.69 | 43 (17 deps) | 1681.82 |
| `eventemitter3` | 6 | 6 | **0** | 153.02 | 103.9 | 2 (1 deps) | 76.59 |
| `kleur` | 4 | 4 | **0** | 83.09 | 59.27 | 1 (0 deps) | 15.3 |
| `ms` | 1 | 1 | **0** | 28.01 | 20.09 | 1 (0 deps) | 25.73 |
| `is-plain-obj` | 1 | 1 | **0** | 2.61 | 2.81 | 1 (0 deps) | 2.24 |
| `escape-string-regexp` | 1 | 1 | **0** | 2.05 | 2.14 | 1 (0 deps) | 1.75 |
| `p-limit` | 1 | 1 | **0** | 31.28 | 18.4 | 1 (0 deps) | 20.43 |
| `yocto-queue` | 1 | 1 | **0** | 13.73 | 6.37 | 1 (0 deps) | 10.31 |

| Total | Files | Scanned | **L1 FP** | Cold analyze | Check all |
|---|---:|---:|---:|---:|---:|
| | 94 | 94 | **0** | 13362.99 | 8083.63 |

## Why this is **not** a “Nudo vs TypeScript” table

Corpus is **unannotated pure JS**. tsc can only enter weak `allowJs+checkJs` mode here —
it is not running on its product surface (typed sources, project references, assignability).

**Do not read the tooling-load numbers below as a product comparison.**

| Where a real TS comparison lives | What it measures |
|----------------------------------|------------------|
| `benchmark/agent-dx` | Same bugs, Nudo gate vs `tsc --noEmit`: detectRate / silentGreen / rounds |
| `benchmark/micro/bench-vs-tsc.mts` | Synthetic workload latency (analyzeFile vs createProgram / LS) |
| `benchmark/lsp-rounds` | OSS bug-repair / PRD race with TS pair harness |

### Tooling-load appendix (not gated, not product)

Same bytes through tsc `createProgram` + diagnostics (`allowJs+checkJs`, no LanguageService reuse):

| Package | tsc total (ms) | tsc diagnostic count |
|---|---:|---:|
| `commander` | 512.94 | 223 |
| `yargs` | 488.46 | 1222 |
| `semver` | 310.6 | 420 |
| `eventemitter3` | 256.92 | 217 |
| `kleur` | 187.93 | 102 |
| `ms` | 157.59 | 13 |
| `is-plain-obj` | 153.08 | 1 |
| `escape-string-regexp` | 150.84 | 1 |
| `p-limit` | 167.71 | 21 |
| `yocto-queue` | 155.6 | 6 |

Total tsc load: **2541.67 ms** (ts 6.0.3) — host/tooling sensitive.

## What is pinned (gate)

| Metric | Meaning |
|--------|---------|
| **L1 FP** | Error-level false positives on real code (`entryThrows: off`) — must stay **0** |
| Cold analyze | Empty session caches, analyze every file once |
| Check all | `checkSource` gate path over the same files |
| Hub dirty set | Import-graph hub edit → dirty-set re-analyze (LSP/watch path) |
| Hub edit | Median wall-clock of dirty-set re-analyze after touching hub |

## Honest boundaries

- Packages are **real OSS** from this workspace's dependency tree — numbers track scale of those packages, not a company monorepo.
- L2 entry may-throw is **off** here (same layering as `check-real-packages`); L2 is covered by gold L2 cases + CLI `--ignore-throws`.
- Host is in-process service API (no CLI spawn). Machine-dependent — compare alongside `node -v`.
- Gate thresholds live in `benchmark/oss/baseline.json` (written from a trusted run). Only regressions fail.
