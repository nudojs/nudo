---
"nudojs": patch
---

**Chore:** re-admit `debug` and `@changesets/cli` to the OSS real-package benchmark corpus (10 → 12 packages, 120 files) after the host-global-purity fix (B1/B2: fork/member-write rebinds gated on `$rebindable` — analysis no longer clobbers host `process` / `globalThis.Error`). Both are L1 zero-FP across 4 trusted runs; `benchmark/oss/baseline.json` + `docs/reports/oss-perf-baseline.{md,json}` regenerated (envelope = observed max of 4 quiet runs ×1.10, same convention as the previous expansion). `@babel/types` stays excluded for wall-clock only (single ~3 MB bundle, one `checkSource` pass ≈ 4 min past the per-round budget) — its earlier crash is fixed (B3).
