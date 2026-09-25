---
slug: /guides/health
description: nudo health — analysis errors and solidification drift in CI.
---

# nudo health

`nudo health` reports **analysis errors** and **call-site solidification drift**. It complements `nudo check` (contract gate): health watches whether recorded evidence still matches the code.

```bash
npx nudojs health [paths…] [--watch] [--from paths…] [--json]
```

Exit `1` on drift or analysis errors. Uncovered functions are informational only.

## What health watches vs what check gates

| | `nudo check` | `nudo health` |
|---|---|---|
| Gates | L1 explicit contracts + L2 entry may-throw | Analysis errors + call-site solidification drift |
| Truth | Pred implication on Abs | Whether generated `call@` directives still match usage sites |
| Uncovered functions | Entry fallback (`any` params) | Reported, informational only |
| CI role | The product gate | Optional evidence-freshness watch |
| Exit `1` | Any error-level diagnostic | Drift or analysis errors |

`check` answers "do the contracts still hold?". `health` answers "does the recorded call-site evidence still describe how this code is used?". Keep `check` in the pipeline; add `health` when you have frozen `call@` cases and want CI to notice when tests move.

## Flags

| Flag | Description |
|---|---|
| `paths…` | Files or directories to health-check |
| `--watch` | Re-run on file changes |
| `--from paths…` | Usage-site files (tests, apps). Health re-runs the same re-solidify chain as `test --freeze=update` and reports drift when generated `call@` directives would change |
| `--json` | Structured health report |

Without `--from`, health reports analysis errors and contract drift only — call-site drift needs usage-site files to re-harvest.

## Worked example — drift after a code change

Start from a library and a test that exercises it. Freeze the harvested cases once:

```bash
npx nudojs test lib/slugify.js --from tests/ --freeze
# writes generated call@ directives into lib/slugify.js
```

Later the test changes its arguments — say `slugify("Hello World")` becomes `slugify("Hello  World")` or the helper is called with a different shape. The frozen `call@` directive no longer matches the usage site. `health` reports it:

```bash
npx nudojs health lib/ --from tests/
```

```text
lib/slugify.js
  · 1 function(s)
  ✗ drift: 3 witness directive(s) changed (+2 new, -1 removed) — refresh: nudo test lib/slugify.js --from tests/ --freeze=update

Summary: 1 file(s) · 1 case drift · 0 contract drift · 0 error(s) · 0 uncovered function(s)
Result: FAIL (drift or errors found)
```

The suggested refresh is exactly the re-solidify command:

```bash
npx nudojs test lib/slugify.js --from tests/ --freeze=update
```

`--freeze=update` strips previously generated `call@` directives, re-analyzes the stripped source, and writes the refreshed set back. Hand-written `@nudo:case` directives are never touched (`call@` is a reserved generated prefix). Both `freeze` and `freeze=update` are idempotent on a synced file (`freeze: no changes.`).

> `test --freeze` is an **optional** debug solidification tool — the product CI gate remains `nudo check`. Health is the watcher that tells you when the optional solidification went stale.

To turn drift detection into a gate without writing files, use the dry-run form from [Call-site discovery](./callsite-discovery.md#persisting-harvested-results):

```bash
npx nudojs test lib/ --from tests/ --freeze=update --dry-run --exit-on-diff
```

## CI recipes

### GitHub Actions

```yaml
# .github/workflows/nudo.yml
jobs:
  nudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g nudojs
      - run: npx nudojs check src/
      - run: npx nudojs health src/ --from tests/
```

`check` stays first: it is the product gate. `health` fails the job when recorded evidence drifted.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No drift, no analysis errors |
| `1` | Drift or analysis errors (uncovered functions are informational only) |

Same exit surface as `check` for CI purposes — a non-zero run blocks the pipeline.

### JSON

`--json` emits a structured health report for dashboards and agent tooling. Pair it with `check --json` when a bot needs both the contract gate and the drift watch in one parse.

## When to run health vs check

| Situation | Command |
|---|---|
| CI on every PR (Day 0 / Day 1) | `nudo check` |
| CI after freezing `call@` cases | `nudo check` then `nudo health --from` |
| Local watch while editing | `nudo health --watch` (or `nudo check --watch`) |
| Before a release, with frozen cases | `nudo health src/ --from tests/` |
| No frozen cases yet | `nudo check` only — health has nothing to re-solidify |

More task recipes: [Recipes](./recipes.md).

## Next

- [nudo check](./check.md) — the contract gate health complements
- [Call-site discovery](./callsite-discovery.md) — harvest, `--freeze`, and the re-solidify chain
- [Diagnostics](../reference/diagnostics.md) — code index for analysis errors
- [Recipes](./recipes.md) — CI gate and monorepo recipes
- [CLI Reference](../api/cli-reference.md#nudo-health) — flag and exit-code contract
