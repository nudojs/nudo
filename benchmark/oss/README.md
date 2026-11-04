# OSS real-package baseline (S1 upgrade)

Real `node_modules` **JavaScript** packages — not the synthetic S1 corpus.

This suite is **Nudo’s JS product face**: precision (L1 zero-FP) + latency on real code.

```bash
pnpm run benchmark:oss          # measure + write docs/reports/oss-perf-baseline.*
pnpm run benchmark:oss:gate     # regression gate (fails only when worse)
```

| Package | Why |
|---------|-----|
| `commander` | Medium CLI library (already zero-FP in unit gold) |
| `yargs` | Larger CLI surface, more import edges (hub-edit interesting) |
| `semver` | Mid-size utility with internal graph |
| `debug` | Env-poking logger — top-level `process.env` member writes (host-purity canary) |
| `@changesets/cli` | Bundled CLI with lazy error-code classes — `globalThis.Error` member writes (host-purity canary) |
| `eventemitter3` | Class-heavy event emitter |
| `kleur` | Terminal-color utility (chain-call style) |
| `ms` | Single-file time-formatting util |
| `is-plain-obj` | Single-file type predicate |
| `escape-string-regexp` | Single-file string util |
| `p-limit` | Single-file async concurrency limiter (uses yocto-queue) |
| `yocto-queue` | Single-file class queue (p-limit dependency) |

12 packages / 120 files. Deliberately excluded (see `packages.mts` for the full reasons): `lodash` (1000+ files, blows the wall-clock budget), `@babel/types` (single ~3 MB bundled lib — one `checkSource` pass takes ~4 min, past the per-round budget; its earlier `checkSource` crash is fixed), `@babel/parser` / `@babel/traverse` (single-file bundles whose cold-analyze cost dominates a bench round). `debug` and `@changesets/cli` are back in the corpus after the host-global-purity fix (analysis no longer clobbers the host `process` / `globalThis.Error`).

## Metrics (gated)

| Metric | Gate? |
|--------|-------|
| L1 false positives (`entryThrows: off`) | **Yes — must stay 0** |
| Cold analyze wall-clock | Yes (envelope in `baseline.json`) |
| Check-all wall-clock | Yes (envelope) |
| Hub-edit dirty-set median | Yes (envelope) |
| File count floor | Yes (`minFiles`) |

## Not a “Nudo vs TypeScript” suite

Corpus is **unannotated pure JS**. tsc only enters weak `allowJs+checkJs` here — that is **not** its product surface. The tooling-load appendix in the report is host noise, not a product score.

| Real TS comparison | Suite |
|--------------------|-------|
| Same-bug detect / silentGreen / rounds | `benchmark/agent-dx` |
| Synthetic latency (analyzeFile vs createProgram/LS) | `benchmark/micro/bench-vs-tsc.mts` |
| OSS bug-repair pairs | `benchmark/lsp-rounds` |

## Policy

- **Regressions only.** Faster than baseline never fails.
- `baseline.json` is a **generous envelope** (≈3× a trusted run). Tighten after you have multi-host data.
- Report numbers live in `docs/reports/oss-perf-baseline.md` (generated — do not hand-edit).

## Relation to other suites

| Suite | Corpus | Question |
|-------|--------|----------|
| `benchmark/s1` | synthetic monorepo | scale curve / edit cost |
| **`benchmark/oss`** | **real OSS JS packages** | **real-code perf + zero-FP** |
| `check-real-packages.test.ts` | same packages | CI precision unit gate |
