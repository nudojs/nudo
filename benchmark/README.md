# Benchmark suite map

> **Read this before quoting any accuracy number.**  
> Different suites measure **different questions** with **different oracles**.  
> Product precision gates live in package tests (`check-recall-gold`, real-package zero-FP), **not** in `benchmark/results/`.

| Suite | Question | Oracle / metric | Product gate? | Entry |
|-------|----------|-----------------|:---:|-------|
| **check gold** (in `packages/core`) | Can `nudo check` classify known violations? | 178 hand-labeled rows, **recall=precision=1.0** | **Yes** (CI) | `pnpm vitest run packages/core/src/algebra/__tests__/check-recall-gold.test.ts` |
| **real-package zero-FP** | Does `check` stay quiet on real OSS JS? | 0 error on commander / lodash / … | **Yes** (CI) | `check-real-packages.test.ts` |
| **S1 monorepo** | Cold / warm / edit latency at repo scale | wall-clock (synthetic 120-file corpus) | No (baseline report) | `pnpm run benchmark:s1` → `docs/reports/s1-perf-baseline.md` |
| **OSS real packages** | Cold / check / hub-edit + **L1 zero-FP** on real code | wall-clock + FP count (commander / yargs / semver) | **Regression gate** | `pnpm run benchmark:oss` / `benchmark:oss:gate` → `docs/reports/oss-perf-baseline.md` |
| **micro vs tsc** | Single-file analyze vs `tsc` program cost | median ms | No | `benchmark/micro/` |
| **agent-dx** | Agent red→green loops Nudo vs TS | detectRate / silentGreen / rounds / tokens | No (DX ops metric) | `pnpm run agent-dx` |
| **legacy infer** (`results/`) | *Old* “infer type string” accuracy on 24 synth cases | exact% against type-string expected | **No — different oracle** | `pnpm run benchmark` → `benchmark/results/latest.json` |

## Legacy infer suite — do not mix with product claims

`benchmark/results/*.json` (including `latest.json`) comes from the **pre-Abs / infer-verb** harness (`benchmark/src/runner.js`, `pnpm run infer`).

- Metric is **type-string exact match** on 24 synthetic cases (array methods, set/map, pipelines, …).
- Current `check` gold uses **Pred implication / diagnostic codes**, not type-string equality.
- A historical `exact: 62.5%` in `latest.json` is **not** a statement about `nudo check` quality.
- `benchmark/failure-analysis.md` and `benchmark/test-coverage-reflection.md` document **that** suite’s bugs/oracle issues.

**When publishing numbers**, prefer:

1. `check-recall-gold` + real-package zero-FP (precision)
2. `docs/reports/s1-perf-baseline.md` (latency, honest synthetic scale)
3. `benchmark/agent-dx` (agent DX vs tsc)

Regenerate legacy infer data only with `pnpm run benchmark`; the gate (`pnpm run benchmark:gate`) still compares that suite to `benchmark/baseline.json` for **regression tracking of the legacy harness**, not product release criteria.

## Layout

```text
benchmark/
  README.md          ← this map
  baseline.json      ← legacy infer baseline (see above)
  results/           ← legacy infer outputs (latest.json = last run)
  src/               ← legacy infer runner / gate / compare
  s1/                ← monorepo cold/warm/edit (synthetic)
  oss/               ← real OSS packages (commander/yargs/semver) + regression gate
  micro/             ← micro benches (incl. vs tsc)
  agent-dx/          ← Nudo vs TS agent repair loops
  lsp-rounds/        ← OSS bug-repair / PRD race harness outputs
```
