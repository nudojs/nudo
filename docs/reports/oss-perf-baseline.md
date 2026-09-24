# OSS package performance & precision baseline (real packages)

> **Generated** by `benchmark/oss/bench-oss.mts` (`pnpm run benchmark:oss`).
> Do not hand-edit numbers — regenerate.
>
> **Corpus:** real `node_modules` packages (**commander / yargs / semver**), not synthetic.
> Regression gate: `node benchmark/oss/gate.mjs` (blocks only worse-than-baseline / new FP).

- Generated at: 2026-09-24T19:42:23.445Z
- Node: v24.19.0
- TypeScript: 5.9.3 (reference column only)
- Scale: 3 packages · **79 JS files** · 353 KB source

## Summary

| Package | Files | Scanned | **L1 FP** | Nudo cold (ms) | Nudo check (ms) | **tsc total (ms)** | Hub dirty | Hub edit (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `commander` | 7 | 7 | **0** | 757.24 | 171.61 | 262.86 | 6 (4 deps) | 685.93 |
| `yargs` | 23 | 23 | **0** | 1181.42 | 252.64 | 246.99 | 8 (5 deps) | 1015.22 |
| `semver` | 49 | 49 | **0** | 299.48 | 179.88 | 148.16 | 1 (0 deps) | 19.69 |

| Total | Files | Scanned | **L1 FP** | Nudo cold | Nudo check | **tsc total** |
|---|---:|---:|---:|---:|---:|---:|
| | 79 | 79 | **0** | 2238.14 | 604.13 | 658.01 |

## Nudo vs tsc (same .js file set)

> **Reference only — not a gate.** Different questions: tsc = assignability on `allowJs+checkJs`;
> Nudo = Abs abstract interpretation + Pred contracts. Compare **latency**, not algorithm constants.
> tsc `createProgram` is cold per package (no LanguageService reuse).

| Package | Nudo cold | Nudo check | tsc createProgram | tsc diagnostics | **tsc total** | tsc diags count | check/tsc |
|---|---:|---:|---:|---:|---:|---:|---:|
| `commander` | 757.24 | 171.61 | 123.29 | 139.57 | **262.86** | 30 | 0.65 |
| `yargs` | 1181.42 | 252.64 | 99.11 | 147.88 | **246.99** | 41 | 1.02 |
| `semver` | 299.48 | 179.88 | 74.04 | 74.13 | **148.16** | 16 | 1.21 |

## What is pinned (gate)

| Metric | Meaning |
|--------|---------|
| **L1 FP** | Error-level false positives on real code (`entryThrows: off`) — must stay **0** |
| Cold analyze | Empty session caches, analyze every file once |
| Check all | `checkSource` gate path over the same files |
| Hub dirty set | Import-graph hub edit → dirty-set re-analyze (LSP/watch path) |
| Hub edit | Median wall-clock of dirty-set re-analyze after touching hub |

tsc numbers are **reported but not gated** (host/tooling sensitive; different product question).

## Honest boundaries

- Packages are **real OSS** from this workspace's dependency tree — numbers track scale of those packages, not a company monorepo.
- L2 entry may-throw is **off** here (same layering as `check-real-packages`); L2 is covered by gold L2 cases + CLI `--ignore-throws`.
- Host is in-process service API (no CLI spawn). Machine-dependent — compare alongside `node -v`.
- Gate thresholds live in `benchmark/oss/baseline.json` (written from a trusted run). Only regressions fail.
