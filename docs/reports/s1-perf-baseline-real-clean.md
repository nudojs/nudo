# ABS-16 real-monorepo baseline (clean corpus) — monorepo cold / warm / edit

> **Generated** by `benchmark/s1/bench-monorepo.mts` (`pnpm run benchmark:s1:real:clean`).
> Do not hand-edit numbers — regenerate the report.
>
> **Corpus:** **real monorepo** at `.` (path relative to repo root; `--corpus`).
> Numbers describe **this checkout** (its layout, its dependencies), not the synthetic scale baseline — compare only across runs on the same corpus.
> **Variant:** `--report clean` — separate report file; does not overwrite the canonical baseline.

- Generated at: 2026-11-12T15:47:30.176Z
- Scale: **286 files**, 0.26 MB, 630 import edges (real corpus — no uniform packages × files-per-package shape)
- Host: node v22.22.2 · darwin arm64 · Apple M4 Pro (14 cores) · 48 GiB RAM · peak RSS 2182.8 MiB
- Host env: NODE_OPTIONS **unset** · fs-broker shim injected: **no** (values are not recorded — they may contain absolute paths)
- Corpus filter: **`--clean-corpus`** — skip dirs: `node_modules`, `.git`, `dist`, `coverage`, `.nudo`, `.bundles`, `out`, `tmp`, `.docusaurus`
- Skipped **1** file(s) > 256 KiB — bundled build output, not source. The skip count is reported, not silently dropped.
- **Sampling: `--quick`** — cold 1 / warm 3 / check 2 / edit 3 / live 5 repetitions (fewer than the default S1 profile). Medians use the reported `n`; interpret accordingly.

## Summary

| Phase | Median (ms) | Notes |
|---|---:|---|
| module graph cold | 108.92 | `buildModuleGraph` no cache |
| module graph warm | 54.97 | re-parse edges |
| module graph cached | 2.25 | mtime edge-cache hit |
| **analyze all — cold** | **13496.62** | empty session caches |
| analyze all — warm | 4117.17 | file cache hits |
| check all — warm | 483.5 | `checkSource` gate path |

## Edit (dirty-set re-analyze)

| Scenario | Dirty files | dirty median | IDE analyze 1 | IDE check 1 |
|---|---:|---:|---:|---:|
| leaf (`benchmark/src/runner.js`) | 1 | 73.95 | 0.74 | 17.89 |
| mid (`benchmark/lsp-rounds/starters-oss-semver/typescript/lib/functions/diff.js`) | 3 | 251.36 | 4.22 | 5.72 |
| hub (`benchmark/s1/.corpus/packages/pkg0-util/mod0.js`) | 106 | 999.74 | 1.09 | 2.83 |

## Live editor (in-memory buffer edit, no disk)

| Op | Median (ms) | min | max | n |
|---|---:|---:|---:|---:|
| analyzeFile (1 file) | 1.7 | 1.37 | 8.37 | 5 |
| checkSource (1 file) | 3.96 | 3.65 | 6.35 | 5 |

## Cache hit telemetry (ABS-16)

Deltas of the two process-global `fn-summary` counters per measurement window.
One `resetFnSummaryCache()` before the run makes **cold #1 truly cold** (only one cold round sampled with `--quick` — cross-cold reuse is not measured here).

| Phase | instance hits / misses | instance hit rate | fn-level hits / misses | fn hit rate | stores (inst / fn) |
|---|---:|---:|---:|---:|---:|---|
| cold #1 | 0 / 408 | 0.0% | 0 / 183 | 0.0% | 92 / 0 |
| warm #1 | 0 / 0 | n/a | 0 / 0 | n/a | 0 / 0 |
| warm #2 | 0 / 0 | n/a | 0 / 0 | n/a | 0 / 0 |
| warm #3 | 0 / 0 | n/a | 0 / 0 | n/a | 0 / 0 |
| check #1 | 0 / 0 | n/a | 0 / 0 | n/a | 0 / 0 |
| check #2 | 0 / 0 | n/a | 0 / 0 | n/a | 0 / 0 |

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
- **Host env matters**: a `NODE_OPTIONS` fs-broker shim can roughly double wall-clock on this fs-heavy harness; the clean runner (`benchmark:s1:real:clean`) spawns the measurement process with `NODE_OPTIONS` removed. Compare only runs with the same host-env row.
- **Not comparable to the 2026-11-11 report**: that run included `out/` build artifacts (one esbuild bundle alone was 44.2% of cold) and had a fs-broker shim injected via `NODE_OPTIONS`. It is kept for reproducibility only — do not quote its numbers.
- **Real corpus mode** (`--corpus`): edit targets are picked dynamically from the module graph (hub = max fan-in, mid = median, leaf = zero fan-in); the edit phase mutates **in-memory sources only** — `writeFileSync` is skipped, your files are never touched.
