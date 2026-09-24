# OSS package performance & precision baseline (real packages)

> **Generated** by `benchmark/oss/bench-oss.mts` (`pnpm run benchmark:oss`).
> Do not hand-edit numbers — regenerate.
>
> **Corpus:** real `node_modules` packages (**commander / yargs / semver**), not synthetic.
> Regression gate: `node benchmark/oss/gate.mjs` (blocks only worse-than-baseline / new FP).

- Generated at: 2026-09-24T19:37:13.253Z
- Node: v24.19.0
- Scale: 3 packages · **79 JS files** · 353 KB source

## Summary

| Package | Files | Scanned | **L1 FP** | Cold analyze (ms) | Check all (ms) | Hub dirty set | Hub edit (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `commander` | 7 | 7 | **0** | 735.07 | 165.16 | 6 (4 deps) | 675.98 |
| `yargs` | 23 | 23 | **0** | 1141.93 | 239.6 | 8 (5 deps) | 952.28 |
| `semver` | 49 | 49 | **0** | 266.13 | 159.99 | 1 (0 deps) | 20.98 |

| Total | Files | Scanned | **L1 FP** | Cold analyze | Check all |
|---|---:|---:|---:|---:|---:|
| | 79 | 79 | **0** | 2143.13 | 564.75 |

## What is pinned

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
