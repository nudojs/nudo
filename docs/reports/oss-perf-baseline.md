# OSS package performance & precision baseline (real JS packages)

> **Generated** by `benchmark/oss/bench-oss.mts` (`pnpm run benchmark:oss`).
> Do not hand-edit numbers — regenerate.
>
> **Corpus:** real `node_modules` **JavaScript** packages (**commander / yargs / semver**).
> This baseline is **Nudo’s product face** (JS-first analysis + L1 zero-FP). Regression gate: `pnpm run benchmark:oss:gate`.

- Generated at: 2026-10-02T09:33:58.997Z
- Node: v26.10.0
- Scale: 3 packages · **79 JS files** · 354 KB source

## Summary (Nudo product metrics — gated)

| Package | Files | Scanned | **L1 FP** | Cold analyze (ms) | Check all (ms) | Hub dirty | Hub edit (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `commander` | 7 | 7 | **0** | 1735.52 | 570.12 | 6 (4 deps) | 1331.84 |
| `yargs` | 23 | 23 | **0** | 2737.22 | 765.18 | 8 (5 deps) | 2061.61 |
| `semver` | 49 | 49 | **0** | 1150.38 | 327.24 | 43 (17 deps) | 1033.29 |

| Total | Files | Scanned | **L1 FP** | Cold analyze | Check all |
|---|---:|---:|---:|---:|---:|
| | 79 | 79 | **0** | 5623.12 | 1662.54 |

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
| `commander` | 495.26 | 223 |
| `yargs` | 525.99 | 1222 |
| `semver` | 335.78 | 420 |

Total tsc load: **1357.03 ms** (ts 6.0.3) — host/tooling sensitive.

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
