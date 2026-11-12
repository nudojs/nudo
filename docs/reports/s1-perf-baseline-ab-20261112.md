# S1 performance baseline — monorepo cold / warm / edit

> **Generated** by `benchmark/s1/bench-monorepo.mts` (`pnpm run benchmark:s1`).
> Do not hand-edit numbers — regenerate the report.
>
> **Corpus:** deterministic generated monorepo at `benchmark/s1/.corpus/` (gitignored).
> Not committed — repo stays small; regenerate with `--regen`.
> **Variant:** `--report ab-20261112` — separate report file; does not overwrite the canonical baseline.

- Generated at: 2026-11-12T11:34:21.448Z
- Scale: 8 packages × 15 files (**120 files**, 0.06 MB, 368 import edges)

## Summary

| Phase | Median (ms) | Notes |
|---|---:|---|
| module graph cold | 47.19 | `buildModuleGraph` no cache |
| module graph warm | 24.2 | re-parse edges |
| module graph cached | 1.35 | mtime edge-cache hit |
| **analyze all — cold** | **13355.77** | empty session caches |
| analyze all — warm | 432.11 | file cache hits |
| check all — warm | 58.48 | `checkSource` gate path |

## Edit (dirty-set re-analyze)

| Scenario | Dirty files | dirty median | IDE analyze 1 | IDE check 1 |
|---|---:|---:|---:|---:|
| leaf (`pkg7-index/mod14.js`) | 1 | 10.12 | 0.61 | 3.31 |
| mid (`pkg2-store/mod0.js`) | 61 | 578.38 | 0.31 | 3.14 |
| hub (`pkg0-util/mod0.js`) | 106 | 1050.16 | 0.84 | 2.87 |

## Live editor (in-memory buffer edit, no disk)

| Op | Median (ms) | min | max | n |
|---|---:|---:|---:|---:|
| analyzeFile (1 file) | 0.38 | 0.33 | 2.51 | 10 |
| checkSource (1 file) | 1.06 | 0.91 | 2.68 | 10 |

## Honest boundaries

- Corpus is **synthetic** (deterministic generator), not a real company monorepo — numbers track relative cold/warm/edit cost and scale with size, not absolute product SLOs.
- Host is in-process service API (no CLI process spawn); tsserver-style LS not included (see `benchmark/micro` for tsc comparisons).
- Edit scenarios re-analyze the dirty set only (LSP/watch path). Full-tree cold is the adoption "first open" number.
- Machine-dependent: record alongside `node -v` / CPU when comparing across hosts. This run: node v22.22.2.
