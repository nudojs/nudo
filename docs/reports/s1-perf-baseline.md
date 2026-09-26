# S1 performance baseline — monorepo cold / warm / edit

> **Generated** by `benchmark/s1/bench-monorepo.mts` (`pnpm run benchmark:s1`).
> Do not hand-edit numbers — regenerate the report.
>
> **Corpus:** deterministic generated monorepo at `benchmark/s1/.corpus/` (gitignored).
> Not committed — repo stays small; regenerate with `--regen`.

- Generated at: 2026-09-23T05:03:12.060Z
- Scale: 8 packages × 15 files (**120 files**, 0.06 MB, 368 import edges)

## Summary

| Phase | Median (ms) | Notes |
|---|---:|---|
| module graph cold | 26.64 | `buildModuleGraph` no cache |
| module graph warm | 10.79 | re-parse edges |
| module graph cached | 0.25 | mtime edge-cache hit |
| **analyze all — cold** | **1234.88** | empty session caches |
| analyze all — warm | 34.86 | file cache hits |
| check all — warm | 27.22 | `checkSource` gate path |

## Edit (dirty-set re-analyze)

| Scenario | Dirty files | dirty median | IDE analyze 1 | IDE check 1 |
|---|---:|---:|---:|---:|
| leaf (`pkg7-index/mod14.js`) | 1 | 4.27 | 0.52 | 1.09 |
| mid (`pkg2-store/mod0.js`) | 61 | 189.38 | 0.19 | 0.55 |
| hub (`pkg0-util/mod0.js`) | 106 | 268.33 | 0.12 | 0.24 |

## Live editor (in-memory buffer edit, no disk)

| Op | Median (ms) | min | max | n |
|---|---:|---:|---:|---:|
| analyzeFile (1 file) | 0.19 | 0.18 | 0.47 | 10 |
| checkSource (1 file) | 0.39 | 0.37 | 0.69 | 10 |

## Honest boundaries

- Corpus is **synthetic** (deterministic generator), not a real company monorepo — numbers track relative cold/warm/edit cost and scale with size, not absolute product SLOs.
- Host is in-process service API (no CLI process spawn); tsserver-style LS not included (see `benchmark/micro` for tsc comparisons).
- Edit scenarios re-analyze the dirty set only (LSP/watch path). Full-tree cold is the adoption "first open" number.
- Machine-dependent: record alongside `node -v` / CPU when comparing across hosts. This run: node v24.19.0.
