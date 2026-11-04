# OSS package performance & precision baseline (real JS packages)

> **Generated** by `benchmark/oss/bench-oss.mts` (`pnpm run benchmark:oss`).
> Do not hand-edit numbers — regenerate.
>
> **Corpus:** real `node_modules` **JavaScript** packages (**commander / yargs / semver / debug / @changesets/cli / eventemitter3 / kleur / ms / is-plain-obj / escape-string-regexp / p-limit / yocto-queue**).
> This baseline is **Nudo’s product face** (JS-first analysis + L1 zero-FP). Regression gate: `pnpm run benchmark:oss:gate`.

- Generated at: 2026-11-04T16:51:37.122Z
- Node: v26.10.0
- Scale: 12 packages · **120 JS files** · 507 KB source

## Summary (Nudo product metrics — gated)

| Package | Files | Scanned | **L1 FP** | Cold analyze (ms) | Check all (ms) | Hub dirty | Hub edit (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `commander` | 7 | 7 | **0** | 4330.84 | 917.1 | 6 (4 deps) | 3706.63 |
| `yargs` | 23 | 23 | **0** | 6967.18 | 4371.92 | 8 (5 deps) | 5732.24 |
| `semver` | 49 | 49 | **0** | 2007.26 | 2577.6 | 43 (17 deps) | 1718.62 |
| `debug` | 4 | 4 | **0** | 132.54 | 78.26 | 4 (2 deps) | 82.51 |
| `@changesets/cli` | 22 | 22 | **0** | 9981.67 | 1101.07 | 16 (13 deps) | 4508.65 |
| `eventemitter3` | 6 | 6 | **0** | 163.18 | 210.62 | 2 (1 deps) | 77.75 |
| `kleur` | 4 | 4 | **0** | 81.49 | 57.47 | 1 (0 deps) | 15.93 |
| `ms` | 1 | 1 | **0** | 27.3 | 15.66 | 1 (0 deps) | 25.87 |
| `is-plain-obj` | 1 | 1 | **0** | 7.05 | 2.55 | 1 (0 deps) | 2.22 |
| `escape-string-regexp` | 1 | 1 | **0** | 2.07 | 2.09 | 1 (0 deps) | 1.77 |
| `p-limit` | 1 | 1 | **0** | 24.31 | 12.98 | 1 (0 deps) | 19.73 |
| `yocto-queue` | 1 | 1 | **0** | 15.19 | 5.34 | 1 (0 deps) | 10.07 |

| Total | Files | Scanned | **L1 FP** | Cold analyze | Check all |
|---|---:|---:|---:|---:|---:|
| | 120 | 120 | **0** | 23740.08 | 9352.66 |

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
| `commander` | 509.7 | 223 |
| `yargs` | 505.62 | 1222 |
| `semver` | 316.11 | 420 |
| `debug` | 226.54 | 100 |
| `@changesets/cli` | 419.51 | 564 |
| `eventemitter3` | 259.18 | 217 |
| `kleur` | 194.86 | 102 |
| `ms` | 156.9 | 13 |
| `is-plain-obj` | 158.15 | 1 |
| `escape-string-regexp` | 156.96 | 1 |
| `p-limit` | 166.75 | 21 |
| `yocto-queue` | 158.06 | 6 |

Total tsc load: **3228.34 ms** (ts 6.0.3) — host/tooling sensitive.

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
