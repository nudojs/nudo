# ABS-16 real-monorepo baseline — monorepo cold / warm / edit

> **Generated** by `benchmark/s1/bench-monorepo.mts` (`pnpm run benchmark:s1`).
> Do not hand-edit numbers — regenerate the report.
>
> **Corpus:** **real monorepo** at `.` (path relative to repo root; `--corpus`).
> Numbers describe **this checkout** (its layout, its dependencies), not the synthetic scale baseline — compare only across runs on the same corpus.

- Generated at: 2026-11-11T16:25:37.641Z
- Scale: **310 files**, 0.46 MB, 637 import edges (real corpus — no uniform packages × files-per-package shape)
- Host: node v22.22.2 · darwin arm64 · Apple M4 Pro (14 cores) · 48 GiB RAM · peak RSS 3552.2 MiB
- Skipped **1** file(s) > 256 KiB — bundled build output, not source. The skip count is reported, not silently dropped.
- **Sampling: `--quick`** — cold 1 / warm 3 / check 2 / edit 3 / live 5 repetitions (fewer than the default S1 profile). Medians use the reported `n`; interpret accordingly.

## Summary

| Phase | Median (ms) | Notes |
|---|---:|---|
| module graph cold | 888.95 | `buildModuleGraph` no cache |
| module graph warm | 782.84 | re-parse edges |
| module graph cached | 2.33 | mtime edge-cache hit |
| **analyze all — cold** | **102802.63** | empty session caches |
| analyze all — warm | 34941.39 | file cache hits |
| check all — warm | 65936.01 | `checkSource` gate path |

## Edit (dirty-set re-analyze)

| Scenario | Dirty files | dirty median | IDE analyze 1 | IDE check 1 |
|---|---:|---:|---:|---:|
| leaf (`benchmark/micro/out/command_copy.js`) | 1 | 141.75 | 3.87 | 528.3 |
| mid (`benchmark/lsp-rounds/starters-oss-semver/nudo/lib/ranges/intersects.js`) | 3 | 4095.52 | 44.36 | 47.93 |
| hub (`benchmark/s1/.corpus/packages/pkg0-util/mod0.js`) | 106 | 10504.13 | 3.07 | 2.3 |

## Live editor (in-memory buffer edit, no disk)

| Op | Median (ms) | min | max | n |
|---|---:|---:|---:|---:|
| analyzeFile (1 file) | 44.84 | 40.35 | 340.79 | 5 |
| checkSource (1 file) | 46.69 | 40.65 | 47.06 | 5 |

## Cache hit telemetry (ABS-16)

Deltas of the two process-global `fn-summary` counters per measurement window.
One `resetFnSummaryCache()` before the run makes **cold #1 truly cold** (only one cold round sampled with `--quick` — cross-cold reuse is not measured here).

| Phase | instance hits / misses | instance hit rate | fn-level hits / misses | fn hit rate | stores (inst / fn) |
|---|---:|---:|---:|---:|---:|---|
| cold #1 | 0 / 1099 | 0.0% | 0 / 188 | 0.0% | 107 / 0 |
| warm #1 | 13 / 63 | 17.1% | 0 / 60 | 0.0% | 0 / 0 |
| warm #2 | 0 / 0 | n/a | 0 / 0 | n/a | 0 / 0 |
| warm #3 | 0 / 0 | n/a | 0 / 0 | n/a | 0 / 0 |
| check #1 | 3 / 3 | 50.0% | 0 / 0 | n/a | 0 / 0 |
| check #2 | 3 / 3 | 50.0% | 0 / 0 | n/a | 0 / 0 |

- **instance-level** = ABS-10 per-shape post cache; **fn-level** = ABS-14 bounded summary fast path.
- `n/a` means **no summary lookup happened** in that window (not a miss): warm/check mostly hit the service file cache before reaching core.
- Edit / live phases are **not** instrumented — their windows mix targeted evictions with single-file re-analysis, so a hit rate there would be misleading.
- The service file / AST / evaluator caches have no counter API; their effect is visible only through the cold → warm wall-clock ratio.

## Honest boundaries

- Corpus is **real** (`--corpus .`) — numbers describe this checkout's absolute cost; compare only against other runs of the same corpus.
- Host is in-process service API (no CLI process spawn); tsserver-style LS not included (see `benchmark/micro` for tsc comparisons).
- Edit scenarios re-analyze the dirty set only (LSP/watch path). Full-tree cold is the adoption "first open" number.
- Machine-dependent: record alongside `node -v` / CPU when comparing across hosts. This run: node v22.22.2.
- **Cache telemetry** covers the two process-global `fn-summary` layers only; it is not a whole-engine cache hit rate.
- **Real corpus mode** (`--corpus`): edit targets are picked dynamically from the module graph (hub = max fan-in, mid = median, leaf = zero fan-in); the edit phase mutates **in-memory sources only** — `writeFileSync` is skipped, your files are never touched.
