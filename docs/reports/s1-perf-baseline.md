# S1 performance baseline — monorepo cold / warm / edit

> **Generated** by `benchmark/s1/bench-monorepo.mts` (`pnpm run benchmark:s1`).
> Do not hand-edit numbers — regenerate the report.
>
> **Corpus:** deterministic generated monorepo at `benchmark/s1/.corpus/` (gitignored).
> Not committed — repo stays small; regenerate with `--regen`.

- Generated at: 2026-09-23T04:47:01.880Z
- Scale: 8 packages × 15 files (**120 files**, 0.06 MB, 368 import edges)

## Summary

| Phase | Median (ms) | Notes |
|---|---:|---|
| module graph cold | 25.55 | `buildModuleGraph` no cache |
| module graph warm | 12.27 | re-parse edges |
| module graph cached | 0.32 | mtime edge-cache hit |
| **analyze all — cold** | **1311.65** | empty session caches |
| analyze all — warm | 214.3 | file cache hits |
| check all — warm | 28.87 | `checkSource` gate path |

## Edit (dirty-set re-analyze)

| Scenario | Dirty files | dirty median | IDE analyze 1 | IDE check 1 |
|---|---:|---:|---:|---:|
| leaf (`pkg7-index/mod14.js`) | 1 | 3.93 | 0.46 | 0.95 |
| mid (`pkg2-store/mod0.js`) | 61 | 189 | 0.2 | 0.53 |
| hub (`pkg0-util/mod0.js`) | 106 | 262.55 | 0.48 | 0.2 |

## Live editor (in-memory buffer edit, no disk)

| Op | Median (ms) | min | max | n |
|---|---:|---:|---:|---:|
| analyzeFile (1 file) | 0.22 | 0.19 | 1.02 | 10 |
| checkSource (1 file) | 0.4 | 0.35 | 1.18 | 10 |

## Honest boundaries

- Corpus is **synthetic** (deterministic generator), not a real company monorepo — numbers track relative cold/warm/edit cost and scale with size, not absolute product SLOs.
- Host is in-process service API (no CLI process spawn); tsserver-style LS not included (see `benchmark/micro` for tsc comparisons).
- Edit scenarios re-analyze the dirty set only (LSP/watch path). Full-tree cold is the adoption "first open" number.
- Machine-dependent: record alongside `node -v` / CPU when comparing across hosts. This run: node v24.19.0.
