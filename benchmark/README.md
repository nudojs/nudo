# Benchmark suite map

> **Read this before quoting any accuracy number.**  
> Different suites measure **different questions** with **different oracles**.  
> Product precision gates live in package tests (`check-recall-gold`, real-package zero-FP), **not** in `benchmark/results/`.

| Suite | Question | Oracle / metric | Product gate? | Entry |
|-------|----------|-----------------|:---:|-------|
| **check gold** (in `packages/core`) | Can `nudo check` classify known violations? | 178 hand-labeled rows, **recall=precision=1.0** | **Yes** (CI) | `pnpm vitest run packages/core/src/algebra/__tests__/check-recall-gold.test.ts` |
| **real-package zero-FP** | Does `check` stay quiet on real OSS JS? | 0 error on commander / lodash / … | **Yes** (CI) | `check-real-packages.test.ts` |
| **S1 monorepo** | Cold / warm / edit latency at repo scale | wall-clock (synthetic 120-file corpus) | No (baseline report) | `pnpm run benchmark:s1` → `docs/reports/s1-perf-baseline.md` |
| **S1 real corpus** (ABS-16) | Same phases on a **real monorepo** + cache hit telemetry | wall-clock + `fn-summary` hit/miss deltas + host info | No (measurement only) | `pnpm run benchmark:s1:real` → `docs/reports/s1-perf-baseline-real.md` ⚠️ 2026-11-12 首测数字失真（语料污染 + 宿主 fs shim），保留但勿引用 |
| **S1 real corpus — clean** (ABS-16 订正) | Same phases, generated-output dirs skipped and `NODE_OPTIONS` removed | wall-clock + host-env row + skip dirs | No (measurement only) | `pnpm run benchmark:s1:real:clean` → `docs/reports/s1-perf-baseline-real-clean.md` |
| **S1 per-file profile** (ABS-17) | Where does a full-tree cold run actually spend its time? | per-file ms / `loadModule` calls / CPU self-time | No (diagnostic) | `benchmark/s1/profile-cold.mts` |
| **OSS real packages** | Cold / check / hub-edit + **L1 zero-FP** on real code | wall-clock + FP count (12 packages: commander / yargs / semver / @changesets/cli / …) | **Regression gate** | `pnpm run benchmark:oss` / `benchmark:oss:gate` → `docs/reports/oss-perf-baseline.md` |
| **micro vs tsc** | Single-file analyze vs `tsc` program cost | median ms | No | `benchmark/micro/` |
| **agent-dx** | Agent red→green loops Nudo vs TS | detectRate / silentGreen / rounds / tokens | No (DX ops metric) | `pnpm run agent-dx` |
| **legacy infer** (`results/`) | *Old* “infer type string” accuracy on 24 synth cases | exact% against type-string expected | **No — different oracle** | `pnpm run benchmark` → `benchmark/results/latest.json` |

## Legacy infer suite — do not mix with product claims

`benchmark/results/*.json` (including `latest.json`) comes from the **pre-Abs / infer-verb** harness (`benchmark/src/runner.js`, `pnpm run infer`).

- Metric is **type-string exact match** on 24 synthetic cases (array methods, set/map, pipelines, …).
- Current `check` gold uses **Pred implication / diagnostic codes**, not type-string equality.
- A historical `exact: 62.5%` in `latest.json` is **not** a statement about `nudo check` quality.
- `benchmark/failure-analysis.md` and `benchmark/test-coverage-reflection.md` document **that** suite’s bugs/oracle issues.

**真实仓基准（ABS-16）**只回答「这个检出在这个宿主上要花多久、两层摘要缓存命中多少」，
不回答「Nudo 有多准 / 多快」；与合成基线 / OSS 基线的 oracle 和宿主都不同，
**不得跨语料或跨 Node 版本比较绝对耗时**。它同样属于「我们如何测」的方法说明。

**对外口径（唯一允许引用的三个数字）**：

1. `check-recall-gold` + real-package zero-FP (precision)
2. `docs/reports/s1-perf-baseline.md` (latency, honest synthetic scale)
3. `benchmark/agent-dx` (agent DX vs tsc)

**禁止引用**：`benchmark/results/*.json`（含历史 `exact: 62.5%`）、micro 单项耗时、
`benchmark:oss:gate` 的倍率——它们各自回答不同问题、oracle 不同，不是产品精度或
性能口径。其余套件（micro / s1 / oss / lsp-rounds / agent-dx）对外只作为「我们如何测」
的方法说明，不作为「Nudo 有多准 / 多快」的宣传数字。精度宣称一律以
`docs/design/limitations.md` §5 的适用边界为前提。

Regenerate legacy infer data only with `pnpm run benchmark`; the gate (`pnpm run benchmark:gate`) still compares that suite to `benchmark/baseline.json` for **regression tracking of the legacy harness**, not product release criteria.

## Layout

```text
benchmark/
  README.md          ← this map
  baseline.json      ← legacy infer baseline (see above)
  results/           ← legacy infer outputs (latest.json = last run)
  src/               ← legacy infer runner / gate / compare
  s1/                ← monorepo cold/warm/edit (synthetic + `--corpus` real mode)
  oss/               ← real OSS packages (10-pkg corpus, see oss/packages.mts) + regression gate
  micro/             ← micro benches (incl. vs tsc)
  agent-dx/          ← Nudo vs TS agent repair loops
  lsp-rounds/        ← OSS bug-repair / PRD race harness outputs
```
