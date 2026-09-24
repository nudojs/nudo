# OSS package performance & precision baseline (real JS packages)

> **Generated** by `benchmark/oss/bench-oss.mts` (`pnpm run benchmark:oss`).
> Do not hand-edit numbers — regenerate.
>
> **Corpus:** real `node_modules` **JavaScript** packages (**commander / yargs / semver**).
> This baseline is **Nudo’s product face** (JS-first analysis + L1 zero-FP). Regression gate: `pnpm run benchmark:oss:gate`.

- Generated at: 2026-09-24T19:49:47.730Z
- Node: v24.19.0
- Scale: 3 packages · **79 JS files** · 353 KB source

## Summary (Nudo product metrics — gated)

| Package | Files | Scanned | **L1 FP** | Cold analyze (ms) | Check all (ms) | Hub dirty | Hub edit (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `commander` | 7 | 7 | **0** | 766.46 | 178.88 | 6 (4 deps) | 700.88 |
| `yargs` | 23 | 23 | **0** | 1239.24 | 259.54 | 8 (5 deps) | 983.77 |
| `semver` | 49 | 49 | **0** | 269.44 | 172.27 | 1 (0 deps) | 22.88 |

| Total | Files | Scanned | **L1 FP** | Cold analyze | Check all |
|---|---:|---:|---:|---:|---:|
| | 79 | 79 | **0** | 2275.14 | 610.69 |

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
| `commander` | 270.58 | 30 |
| `yargs` | 243.61 | 41 |
| `semver` | 139.56 | 16 |

Total tsc load: **653.75 ms** (ts 5.9.3) — host/tooling sensitive.

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
