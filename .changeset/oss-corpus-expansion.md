---
"nudojs": patch
---

**Chore:** expand the OSS real-package benchmark corpus from 3 to 10 packages (`commander` / `yargs` / `semver` + `eventemitter3` / `kleur` / `ms` / `is-plain-obj` / `escape-string-regexp` / `p-limit` / `yocto-queue`) and regenerate `benchmark/oss/baseline.json` + `docs/reports/oss-perf-baseline.{md,json}`. Every package is L1 zero-FP on the new corpus. Candidate packages that could not join honestly are documented in `benchmark/oss/packages.mts`: `debug` and `@changesets/cli` crash on the analyze path (evaluating them clobbers host `process.env` / `globalThis.Error` — engine debt, not gate-threshold material), `lodash` blows the wall-clock budget, `@babel/types` crashes `checkSource`, and `@babel/parser` / `@babel/traverse` single-file bundles dominate a bench round. Benchmark-only change — no engine code touched.
