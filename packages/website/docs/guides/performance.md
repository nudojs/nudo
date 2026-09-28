---
slug: /guides/performance
description: Nudo analysis performance — budgets (forks, calls, call sites), truncation diagnostics and fixes, the .nudo/cache disk cache, and what CI should (not) restore.
---

# Performance: budgets & the analysis cache

Two separate levers, often confused:

- **Budgets** govern **precision**. Nudo analyzes finite approximations of (possibly infinite) executions. When a budget is hit, the affected results widen (`#widened`) and a diagnostic says so — never silently.
- **The disk cache** (`.nudo/cache`) governs **repeat-run latency** for a subset of cold paths. It is **off by default** and never accelerates the full analysis behind `test` / `export` / `health`.

## Analysis budgets

The evaluator (transpile → `new Function`) executes real Abs algebra over your code. Budgets bound that work:

| Budget | Default | Knob | When hit |
|---|---|---|---|
| Total calls (function entries) | 20,000 | — | `nudo:recursion-truncated` |
| Call depth | 64 | — | `nudo:recursion-truncated` |
| Branch expansions (`$fork` total) | 5,000 | `NUDO_MAX_FORKS` / `package.json#nudo.analysis.maxForks` | `nudo:fork-truncated` |
| Call sites merged per function | 3 | `package.json#nudo.analysis.callSiteBudget` (1–64) | over-budget sites fold symbolically → `#widened` |

Only the fork budget is adjustable (`NUDO_MAX_FORKS` env wins over `nudo.analysis.maxForks`; invalid values fall back to the default). Total calls and call depth are hard stops — restructure the code instead.

### When truncation fires — and what to do

**`nudo:recursion-truncated`** — the call budget (depth 64 or 20,000 total entries) ran out; affected results widen. **`nudo:fork-truncated`** — the branch-expansion budget ran out; affected results widen (**warning**). Both are visible in `nudo check` / `nudo test` output — truncation never degrades results silently.

Three levers, in the order worth trying:

1. **Add constraints.** Contracts (`*.nudo.js` / `@nudo:contract`) and call-site evidence narrow sets early — smaller Abs, fewer re-evaluations, fewer forks. This is the fix that also *improves* precision.
2. **Split functions / flatten branches.** Deep call chains burn call depth; long `if`/`else` chains and loops-in-branches multiply `$fork` counts combinatorially. Extract helpers, return early, separate concerns.
3. **Tune knobs and env.** Raise the fork budget (`NUDO_MAX_FORKS=20000` or `package.json#nudo.analysis.maxForks`); model the APIs you touch with `@nudo:env` / mocks so analysis stays on modeled, precise paths instead of forking over opaque values.

Budgets exist so analysis terminates on adversarial code. If you are raising `maxForks` regularly, the code (or the missing contracts) is usually the real story.

## The `.nudo/cache` project disk cache

Off by default. Opt in via `package.json`:

```json
{
  "nudo": {
    "cache": true
  }
}
```

`nudo.cache` accepts:

| Value | Meaning |
|---|---|
| `true` | cache at `<projectRoot>/.nudo/cache` |
| `"some/dir"` | custom directory, resolved against the project root |
| `false` / omitted | disabled (default) |

Env override (when config is unset): `NUDO_CACHE_DIR` — an absolute path, or `off` / `0` to disable.

What lands on disk (namespaced subdirectories under the root):

| Namespace | Content | Serves |
|---|---|---|
| `iface` | whole-file effectiveInterface tables (export → contract JSON, or implicit negative cache) | `nudo contract` printing / contract-read cold start |
| `check` | whole-file `CheckJson` reports | `nudo check` cold path for unchanged files — never with `--from` (live-injected evidence is not reusable as a whole report) |

**Keys are content-addressed:** sha256 over source + sidecar + dependency contents + config dimensions (e.g. `contract.autoBind`), prefixed with the analysis ABI (`nudo-check-cache-v…+<version>`, which includes the TypeScript version — not `package.json#version`). Upgrading `@nudojs/*` changes the prefix → the whole layer misses cleanly. Change source, sidecar, or a dependency → the key changes → natural miss.

**Fail-open semantics.** Corrupted JSON, ABI mismatch, unreadable entries, a deleted directory — every failure is a cache miss. Analysis recomputes; nothing throws; observable behavior is identical. You can `rm -rf .nudo/cache` at any time. Entries touched by truncation or opaque evidence are never written.

### Why it is off by default

A structurally valid **forged** `CheckJson` can manufacture false negatives — a poisoned cache could hide real violations. Therefore: enable only on trusted machines/CI; `.nudo/cache` **must be gitignored**; on untrusted runners keep `nudo.cache` unset/`false` or set `NUDO_CACHE_DIR=off`.

### The dependency layer (default ON)

A separate cross-project cache at `~/.cache/nudo/deps` (override: `NUDO_DEPS_CACHE_DIR`; `off` / `0` disables) stores `@types` harvest **signature projections** — pure JSON, never Abs bodies. It is on by default, fail-open, and shared across projects. This is where the biggest repeat-analysis win lives.

## What the cache does not accelerate

Honest boundary:

- **Serves:** `contract` printing / contract-read cold start; opt-in `check` cold paths (unchanged files); the harvest dependency layer.
- **Does not serve:** `test` / `contract --emit` / `health` full evaluator analysis; `export`'s whole projection chain.
- **Never on disk:** Abs bodies, ASTs, `PolyFn`, `AnalysisResult`, and truncated / opaque / mock-rerouted analysis results.
- `--from` (live call-site evidence) skips `CheckJson` read/write entirely.

The cache makes repeated checks of unchanged files cheaper on the algebra surface. It is not a general "make Nudo fast" switch — first check the budgets and the contracts.

## CI: restore the cache or not?

- **Default setup: nothing to restore.** The project cache is off; `nudo check` recomputes honestly every run.
- **If you enable the check cache** (trusted runners only): restoring `.nudo/cache` between runs is safe — keys are content-addressed and misses just recompute. Always gitignore it; never commit it. Contract files (`*.nudo.js`) go in git; the cache does not.
- **Untrusted runners:** keep it off — `nudo.cache: false` (or unset) and `NUDO_CACHE_DIR=off`.
- **The deps layer** (`~/.cache/nudo/deps`) is the CI-worthy one: default-on, cross-project, pure signature projections. Point `NUDO_DEPS_CACHE_DIR` at a restored directory to reuse harvest work across jobs; a stale or corrupt copy simply misses.

## Session cache limits (in-process LRU)

Separate lever from the disk cache above: every Nudo process keeps in-memory LRU caches for warm re-analysis — whole-file analysis results, per-function analyses, and evaluator runs. Their **entry counts** are capped via `package.json#nudo.sessionCache`. This is a memory-vs-warm-hit tradeoff, never a precision knob — eviction just recomputes honestly; results and diagnostics are identical either way.

| Key (`nudo.sessionCache.*`) | Env var | Caps | Default |
|---|---|---|---|
| `maxFiles` | `NUDO_CACHE_MAX_FILES` | whole-file analysis-result LRU entries | `64` |
| `maxFns` | `NUDO_CACHE_MAX_FNS` | per-function analysis LRU entries | `1024` |
| `maxEvalRuns` | `NUDO_CACHE_MAX_EVALRUNS` | evaluator-run LRU entries | `32` |

- Precedence: env var > `package.json#nudo.sessionCache` > default. `0` / `off` disables that layer; values are clamped to `65,536`.
- Lower the caps when several projects share one IDE/LSP process; raise them for a large monorepo to keep warm hits.
- Orthogonal to the persistent disk cache (`nudo.cache` / `NUDO_CACHE_DIR` above): session limits die with the process and never touch disk.

## Config summary

| Want | Set |
|---|---|
| Raise the branch budget | `NUDO_MAX_FORKS=20000` or `package.json#nudo.analysis.maxForks` |
| Merge more call sites per function | `package.json#nudo.analysis.callSiteBudget` (1–64, default 3) |
| Enable the project disk cache | `package.json#nudo.cache: true` (→ `.nudo/cache`) |
| Custom cache directory | `nudo.cache: ".nudo-cache"` or `NUDO_CACHE_DIR=/abs/path` |
| Disable the deps cache | `NUDO_DEPS_CACHE_DIR=off` |
| Cap the in-process session caches | `package.json#nudo.sessionCache.*` / `NUDO_CACHE_MAX_FILES` · `NUDO_CACHE_MAX_FNS` · `NUDO_CACHE_MAX_EVALRUNS` |

For the full config table — every `package.json#nudo` key and `NUDO_*` variable — see the [configuration reference](../reference/config.md).

## Next

- [Diagnostics](../reference/diagnostics.md) — `nudo:recursion-truncated` / `nudo:fork-truncated`
- [Limits & non-goals](../concepts/limits.md)
- [nudo check](./check.md)
- [CLI reference](../api/cli-reference.md)
