---
slug: /reference/config
description: Every package.json#nudo key and NUDO_* environment variable — values, defaults, precedence, and where each is enforced.
---

# Configuration reference

Nudo reads project configuration from the `nudo` key in `package.json` — there is no `nudo.json`, `.nudorc`, or `nudo.config.js`. Process-level knobs are `NUDO_*` environment variables.

**Where the config is found:** for each analyzed file, Nudo walks up the directory tree from that file and uses the **nearest `package.json` that contains a `nudo` key**. A `package.json` without a `nudo` key does not stop the search — in a monorepo, a config at the repository root stays visible to sub-packages that have their own `nudo`-less `package.json`.

Keys are normalized leniently: invalid values fall back to the default (and `nudo.check.entryThrows` additionally prints a warning on stderr) rather than failing the run.

## Minimal example

```json
{
  "name": "my-app",
  "nudo": {
    "check": {
      "profile": "adoption",
      "ignoreThrows": ["TypeError"]
    },
    "analysis": {
      "mode": "exports",
      "exclude": ["**/node_modules/**", "**/dist/**", "**/coverage/**"]
    },
    "sessionCache": {
      "maxEvalRuns": 64
    }
  }
}
```

## `nudo.check` — the CI gate

| Key | Values | Default | Meaning |
|---|---|---|---|
| `check.profile` | `"adoption"` \| `"strict"` | `"strict"` | Named gate preset. `adoption` demotes L2 entry-may-throw to **warning**; `strict` keeps it an error. Never swallows L1 contract violations — those stay errors under both profiles. |
| `check.entryThrows` | `"error"` \| `"warning"` \| `"off"` | `"error"` | Severity of the L2 `nudo:entry-may-throw` diagnostic. An explicit value beats `profile` at the same layer. Invalid values warn on stderr and use `"error"`. |
| `check.ignoreThrows` | string[] (throw type names) | `[]` | L2-only filter of throw type names (e.g. `["TypeError", "RangeError"]`). The CLI flag `--ignore-throws` **merges additively** with this list (union), so a project config can be tightened or extended per invocation. Never filters L1 violations. |

See [CLI reference — `nudo check`](../api/cli-reference.md) for the flags these mirror and [Diagnostics](./diagnostics.md) for the codes they gate.

### L2 `entryThrows` resolution order

The effective L2 severity is the first of these that is set:

1. CLI `--entry-throws` (explicit — beats any profile)
2. CLI `--profile` preset (`adoption` → `warning`, `strict` → `error`)
3. `package.json#nudo.check.entryThrows`
4. `package.json#nudo.check.profile`
5. Default `strict` (`error`)

The same explicit-beats-preset rule applies inside `package.json` alone (rule 3 before rule 4), so the IDE/LSP gate — which reads only the config — matches the CLI. L1 contract violations are unaffected at every step.

## `nudo.contract` — sidecars

| Key | Values | Default | Meaning |
|---|---|---|---|
| `contract.autoBind` | boolean | `true` | Ambient binding of `*.nudo.js` sidecars for `check`, LSP enforcement, and `contract` printing. `false` stops sidecars from being ambient-loaded. |
| `contract.emit` | string \| string[] (globs, relative to the project root) | `[]` | Allowlist for contract emit (`nudo contract --emit` and the LSP persist lens). Empty = no path filtering. Patterns match the **source file** path (not the sidecar path); an emit target outside the allowlist is refused with an `emit-denied` warning. |

## `nudo.env` — runtime environments

| Key | Values | Default | Meaning |
|---|---|---|---|
| `env` | string[] of env names | `[]` | Project-level runtime env presets: built-in `"es"`, `"web"`, `"node"` (`web` and `node` imply `"es"`), or path-based env modules. Unioned — deduplicated — with file-level `/// @nudo:env` directives, so both layers always apply. |

See [`@nudo:env`](../concepts/directives.md) for path-based env files and the built-in envs.

## `nudo.analysis` — scope and noise (IDE / watch)

| Key | Values | Default | Meaning |
|---|---|---|---|
| `analysis.include` | string[] (globs) | `[]` (no path filter) | Path filter for IDE / vite-plugin / watch-scan analysis. |
| `analysis.exclude` | string[] (globs) | `["**/node_modules/**", "**/dist/**", "**/coverage/**"]` | Paths excluded from IDE analysis. An explicitly empty array falls back to this default safety list — the `node_modules` guard cannot be turned off by accident. |
| `analysis.mode` | `"directives"` \| `"exports"` \| `"all"` | `"exports"` | Which files the IDE / build analyzes: `exports` = files with `export` / sidecar / `@nudo:` directives; `directives` = only annotated files; `all` = every target path. Named-path CLI commands (`nudo check src/lib.js`) analyze the named file regardless of mode. |
| `analysis.diagnostics` | `"off"` \| `"errors"` \| `"default"` \| `"verbose"` | `"errors"` when `mode` is `"directives"`, else `"default"` | Diagnostic noise level in the IDE. |
| `analysis.evalMissingSlot` | `"off"` \| `"warning"` | `"off"` | C0.5: emit a `nudo:missing-slot` **warning** when evaluation actually hits a missing field on a known shape. Observation, never an obligation — see [Limits](../concepts/limits.md). |
| `analysis.callSiteBudget` | integer 1–64 | `3` | Precise call-site cases kept per function (polyvariance). Over-budget sites fold symbolically into `#widened` results. |
| `analysis.maxForks` | integer ≥ 1 | `5000` | Total branch-expansion (`$fork`) budget. When hit: `nudo:fork-truncated` warning and widened results. `NUDO_MAX_FORKS` wins over this key; invalid values fall back to the default. |

Scope tuning recipes (mixed TS/JS repos, `directives` vs `exports`) are in [Coexisting with TypeScript](../guides/coexistence.md); budget behavior in [Performance](../guides/performance.md).

## `nudo.cache` — project disk cache

| Value | Meaning |
|---|---|
| `true` | Cache at `<projectRoot>/.nudo/cache`. |
| `"some/dir"` | Custom cache root, resolved against the project root. |
| `false` / omitted | Disabled (default). |

Off by default — a forged cache report could hide violations, so enable it only on trusted machines and gitignore `.nudo/cache`. What lands on disk, fail-open semantics, and CI guidance: [Performance — the `.nudo/cache` disk cache](../guides/performance.md).

**Precedence note:** unlike most keys, any explicit `nudo.cache` value (including `false`) wins over `NUDO_CACHE_DIR`; the env var is only consulted when `nudo.cache` is unset.

## `nudo.sessionCache` — in-process LRU limits

| Key | Env var | Default | Caps |
|---|---|---|---|
| `sessionCache.maxFiles` | `NUDO_CACHE_MAX_FILES` | `64` | Whole-file analysis-result LRU entries. |
| `sessionCache.maxFns` | `NUDO_CACHE_MAX_FNS` | `1024` | Per-function analysis LRU entries. |
| `sessionCache.maxEvalRuns` | `NUDO_CACHE_MAX_EVALRUNS` | `32` | Evaluator-run LRU entries. |

`0` (or env `"off"` / `"0"`) disables that layer; values are clamped to a hard cap of 65,536. This is a memory-vs-warm-hit tradeoff only — eviction recomputes honestly, results and diagnostics are identical. Details: [Performance — session cache limits](../guides/performance.md).

## Environment variables

| Variable | Controls | Default | Values |
|---|---|---|---|
| `NUDO_MAX_FORKS` | Branch-expansion budget (same knob as `nudo.analysis.maxForks`) | `5000` | Integer ≥ 1; invalid falls back to the default. Wins over the config key. |
| `NUDO_CACHE_DIR` | Project disk cache root (same knob as `nudo.cache`) | unset (off) | Absolute path, or `off` / `0` to disable. Only read when `nudo.cache` is unset. |
| `NUDO_CACHE_MAX_FILES` | Session LRU `maxFiles` | `64` | Integer; `0` / `off` disables the layer; clamped to 65,536. |
| `NUDO_CACHE_MAX_FNS` | Session LRU `maxFns` | `1024` | Same rules as above. |
| `NUDO_CACHE_MAX_EVALRUNS` | Session LRU `maxEvalRuns` | `32` | Same rules as above. |
| `NUDO_DEPS_CACHE_DIR` | Cross-project `@types` harvest cache root | `~/.cache/nudo/deps` | Path, or `off` / `0` to disable the deps layer. Fail-open; see [Performance](../guides/performance.md). |
| `NUDO_HARVEST_NODE` | `@types/node` harvest | enabled | `off` disables harvesting Node APIs (explicit skip, not a silent fallback). |
| `NUDO_DRAFT_FORCE` | Write guard for contract drafts | unset | `1` allows `contract --draft --write` (and the agent draft-write tool) when no project root is found for the file. |

## Precedence

The general order is **CLI flag > environment variable > `package.json#nudo` > default**, but several keys deviate — each of these is the verified behavior:

| Knob | Actual precedence |
|---|---|
| L2 `entryThrows` | The 5-step order above: CLI flag > CLI preset > config value > config preset > default. |
| `ignoreThrows` | **Additive**, not overriding: CLI `--ignore-throws` is unioned with `nudo.check.ignoreThrows`. |
| `maxForks` | `NUDO_MAX_FORKS` > `nudo.analysis.maxForks` > 5000 (no CLI flag). |
| `sessionCache.*` | Explicit host API (`setSessionCacheLimits`) > `NUDO_CACHE_MAX_*` > `nudo.sessionCache.*` > default. |
| Disk cache | `nudo.cache` (any explicit value, even `false`) > `NUDO_CACHE_DIR` (only when the key is unset) > off. |
| `NUDO_DEPS_CACHE_DIR` / `NUDO_HARVEST_NODE` / `NUDO_DRAFT_FORCE` | Env-only knobs; no `package.json` counterpart. |

Config lookup itself (`findProjectConfig`) is keyed by the analyzed file's location, so different packages in one monorepo can sit under different configs by giving each its own `nudo`-bearing `package.json`.
