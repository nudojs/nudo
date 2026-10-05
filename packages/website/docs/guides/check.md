---
slug: /guides/check
description: nudo check — L1 refinement gate + L2 entry throws on Abs; prints signatures; CI command.
---

# nudo check

`nudo check` is Nudo's **gate on Abs**. It enforces:

1. **L1 explicit contracts** — refinements from `*.nudo.js` / `@nudo:contract` (Pred implication on Abs)
2. **L2 default JS contracts** — undigested may-throw on **entry/export** functions

The report is **Nudo-native** (`actual ⊭ expected`), not a TypeScript diagnostic in disguise. On success **and** failure, `check` prints signatures — it is not silent.

```bash
npx nudojs check path/to/file.js
# exit 1 if any error
```

```bash
nudo check <path> [--watch|-w] [--json] [--verbose] [--abs]
           [--from paths…] [--ignore-throws names] [--entry-throws error|warning|off]
           [--profile adoption|strict]
```

![check validate vs export project](/img/check-vs-export.svg)

*`check` validates Abs (solid); `export` projects dts/guard/schema one-way and lossy (dashed). Nothing reads a projection back.*

## Default output (signatures + issues)

```js verify
export function getName(user) {
  return user.name;
}

export function subtract(a, b) {
  return a - b;
}
```

```bash
nudo check user.js
```

```text
nudo check  user.js
FAILED
  2 error · 0 warning · 0 info · 3 fn

signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => number  throws TypeError
  clamp(n: any, lo: any, hi: any) => any

issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → property 'name' on any (unconstrained value) → @nudo:throws TypeError  |  sidecar: fn({ … }): shape({ <body-read fields> })  |  refine / guard / try-catch
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
  [ERROR L5 subtract] subtract (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   subtract(a: any, b: any) => number    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → ToNumber coercion of abstract operand → @nudo:throws TypeError  |  sidecar: fn({ … }): shape({ <body-read fields> })  |  refine / guard / try-catch
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

> `L1` in `[ERROR L1 getName]` is the **line number** (the function is declared on line 1 here) — the layer is L2 (`nudo:entry-may-throw`). `L#` is always a location, never a contract layer.

- Unconstrained entry parameters display as **`any`**.
- **`unknown` means inference failed** (engine debt) — never the default for unconstrained entry params.
- Throws always appear on the signature line when present.
- `[ERROR L# name]` — `L#` is the **line number** of the offending call/declaration, not a contract layer (L1/L2 are the layers; `L#` is a location).

## What it checks

| Code | Layer | Severity | Meaning |
|------|-------|----------|---------|
| `nudo:constraint-violated` | L1 | error | Call/return ⊭ `@nudo:contract` (scalar bounds / shape fields) |
| `nudo:assign-mismatch` | L1 | error | Assignment ⊭ previous binding shape (`leqAbs`) |
| `nudo:arg-structure` | L1 | error (explicit contract) / warning (body-promote) | HOF: argument is not a callable `fn` / arity mismatch. Usage-driven body promotion is a **warning suggestion**; only explicit relation contracts make it an error |
| `nudo:case-inconsistency` | L1 | error | `@nudo:case` witness ⊭ refine |
| `nudo:constraint-unproven` | L1 | warning | Cannot prove the argument satisfies the contract Pred (`cannot prove … x > 0`) — inconclusive, not failed. Add a call site / `@nudo:case`, or state preconditions via `--assume` |
| `nudo:arg-opaque` | L1 | warning | Argument Abs is `unknown` (no term) — the constraint cannot even be checked. Add a call site / `@nudo:case` / `--assume`, or model the value's source |
| `nudo:arg-count` | L1 | error | Arity mismatch between the call and the generalized parameter face |
| `nudo:fn-not-found` | L1 | error | Call references a function the analyzer cannot resolve in scope |
| `nudo:partial-result` | L1 | info | Result Abs carries `#partial` confidence — observation only |
| `nudo:interface-param-mismatch` | L1 | error | Handwritten contract param name is not on the formal surface |
| `nudo:interface-conflict` | L1 | error | Handwritten contract conjunction unsatisfiable |
| `nudo:interface-load` | L1 | error | Sidecar file failed to load (parse / import / resolution error) |
| `nudo:interface-name-clash` | L1 | error | Sidecar export name collides with a source export, or emit would overwrite a handwritten binding (handwritten wins, write skipped) |
| `nudo:interface-cycle` | L1 | error | Sidecar `@nudo:import` chain forms a cycle |
| `nudo:interface-domain-exceeds` | L1 | error | Call records injected via `--from` ⊄ the handwritten contract domain |
| `nudo:interface-drift` | L1 | warning | Persisted `@generated` segment ≠ today's recomputed interface (also surfaced by `nudo health`; does not gate exit) |
| `nudo:interface-entry-only` | L1 | info | Export has no contract root and no call-site domain (only synthesized `entry@`) — coverage gap, not a gate failure |
| `nudo:dual-entry` | L1 | info | Browser/node dual entrypoints: call-site records do not cross files — analysis observes only one entry variant |
| `nudo:interface-emit-denied` | L1 | warning | `contract --emit` target outside the `package.json#nudo.contract.emit` allowlist — write skipped |
| `nudo:interface-multi-declarator` | L1 | warning | `@generated` section hand-merged into one multi-declarator export — kept verbatim |
| `nudo:interface-not-projectable` | L1 | error | Assembled sidecar failed round-trip re-parse — nothing written (engine debt) |
| **`nudo:entry-may-throw`** | **L2** | **error** (default) | Entry/export function has undigested may-throw |
| `nudo:may-throw` | test / L2 clue | warning | Case path may throw (internal included); L2 can elevate entry throws |
| `nudo:unknown-inference` | engine debt | warning | True `unknown` on a signature (inference failed) — unconstrained entry params are `any`, not this code |
| `nudo:unknown-recv` | engine debt | warning | Member access on `unknown` receiver — does **not** replace L2 throws modeling |
| `nudo:builtin-unknown` | engine debt | warning | API not covered by env/inference (e.g. unmodeled global). Prefer `@nudo:env` / mock |
| `nudo:opaque-result` | engine | info | Evaluation returned opaque / uninformative Abs |
| `nudo:eval-error` | engine | error | Body evaluation threw during analysis |
| `nudo:recursion-truncated` | engine | warning | Recursion budget hit; result widened |
| `nudo:fork-truncated` | engine | warning | Branch-expansion (`$fork`) budget hit; result widened |
| `nudo:host-effect-blocked` | engine | info | Host side-effect function (`fetch` / timers / …) not executed during analysis — result widened to `unknown#opaque`. Mock with `@nudo:mock` / `@nudo:env` |
| `nudo:no-signature` | engine/L1 | warning | Function could not be generalized (CJS/anon forms still get L2 via entry fallback) |
| `nudo:no-method` | engine | error (primitive receivers) / warning | Member access cannot resolve — ``Method 'x' does not exist on type 'T'``. Distinct from `nudo:unknown-recv` |
| `nudo:mock-invalid` | engine | warning | `@nudo:mock` expression is not a known pattern (stub/spy/mock, arrow, type expression) |
| `nudo:env-harvest-conflict` | engine | warning | Handwritten `@nudo:env` and `@types` harvest supply the same module key — handwritten wins, harvest fills missing slots only |
| `nudo:interface-underivable` | engine | info | Derived contract row has no source evidence (opaque / truncated / none) — row skipped; handwritten rows never flagged |
| `nudo-unreachable` | info | info | Code after return/throw |
| `nudo:module-cycle` | module graph | warning | Circular module load — bindings inside the cycle resolve to partially evaluated types |
| `nudo:module-depth` | module graph | warning | Module load chain too deep — loading truncated, deeper modules typed `unknown` |
| `nudo:module-missing` | module graph | error | Imported module the loader cannot resolve — fix the spec or mock it (`@nudo:mock-module`) |
| `nudo:missing-slot` | eval | warning (default off) | Evaluation hit a closed object shape's missing field (opt in `nudo.analysis.evalMissingSlot`) — observation, never invents check errors |
| `nudo:case-expected` | test | error (fails `nudo test`) | Declared `@nudo:case` expected type ⊭ inferred result — synthetic `call@` / `entry@` cases never fail the run |

Full list — per-code anchors, minimal repros, Abs views, and fixes: [Diagnostics glossary](../reference/diagnostics.md).

## L1 — explicit contracts

Refinements are declared with `@nudo:contract` — Preds that enter Abs and participate in algebra.

```js
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  return x;
}

needsPositive(-1);
// [ERROR L12 needsPositive] needsPositive[x]: argument ⊭ precondition  (nudo:constraint-violated)
//   actual:   -1  #exact
//   expected: x > 0
//   → use a value satisfying x > 0, or relax the precondition on x
```

**`if` is not a refinement.** Clamp-style guards accept out-of-range input when no refine is declared:

```js verify
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);  // OK — no @nudo:contract declared
```

Nudo does **not** invent required slots from body AST scans.

## L2 — entry throws

Without an explicit contract, the contract degrades to the **JS runtime boundary**:

> Entry parameters are `any`. Operations on `any`/nullish values may throw. Exported functions must not silently carry undeclared, uncaptured throws.

```js
export function getName(user) {
  return user.name;  // property access on unconstrained `user`
}
```

Key lines from the report — the full transcript lives in [Default output](./check.md#default-output-signatures--issues):

```text
signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => number  throws TypeError
issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
  [ERROR L5 subtract] subtract (export): may throw TypeError  (nudo:entry-may-throw)
```

> Reminder: `L1` in the header is the **line number** — this diagnostic's layer is L2.

### What L2 gates

- **Only entry/export functions** — `export` / `export default`, CJS `exports.x =` / `module.exports`.
- **Internal helpers are not gated.** They may throw; observe them in `nudo test`.
- `try`/`catch` digests throws on a path (removed from exit effects).
- Refine narrowing the param to a shape removes or downgrades L2 (becomes L1).

The first fix path is declaring the intentional throw on the function with [`@nudo:throws`](../concepts/directives.md#nudothrows--declare-intentional-throws) — full syntax (`Error`-family coverage, `*` wildcard, `!! throws` case suffix, sidecar `fn` option) in the directive reference.

### Filtering L2

```bash
nudo check src/ --ignore-throws TypeError
nudo check src/ --ignore-throws TypeError,RangeError
nudo check src/ --entry-throws warning   # demote L2 while migrating
nudo check src/ --entry-throws off
```

Semantics:

- `--ignore-throws` **only** filters L2 entry throws — never L1 contract violations.
- Default: **do not ignore** any throws.
- Filters the throws type/shape, not the whole check.

Persist these in `package.json#nudo.check` — config block: [CLI Reference](../api/cli-reference.md#nudo-check).

### Profiles: adoption vs strict

`--profile` is a **named L2 preset** — it is not a way to turn the gate off:

- `strict` (default) — L2 `entry-may-throw` is **error**.
- `adoption` — migration profile: L2 entry may-throw demoted to **warning** (exit 0), while **L1 explicit contract violations stay error**. Adoption never swallows L1.

```bash
nudo check src/ --profile adoption
```

Persist it under `package.json#nudo.check.profile` instead of passing the flag:

```json
{
  "nudo": {
    "check": {
      "profile": "adoption"
    }
  }
}
```

L2 entry-throws severity resolves first-match:

1. CLI `--entry-throws` — an explicit value overrides any profile
2. CLI `--profile` (`adoption` → `warning`, `strict` → `error`)
3. `package.json#nudo.check.entryThrows`
4. `package.json#nudo.check.profile`
5. default `strict` (`error`)

Full flag / config table: [CLI Reference](../api/cli-reference.md#nudo-check).

### Node analogy

An uncaught exception makes a Node process exit non-zero. Likewise, undeclared/uncaptured throws on the **export boundary** fail `nudo check`. Throws inside an internal call stack are implementation details, handled by the caller or by L1.

## Options

All flags and `package.json#nudo.check` config are specified once in the [CLI Reference](../api/cli-reference.md#nudo-check). Highlights:

| Option | Description |
|--------|-------------|
| `--watch` / `-w` | Re-run on changes (flag, not a verb) |
| `--json` | Machine-readable signatures + diagnostics (`CheckJson` / `CheckJsonMulti`) |
| `--verbose` | Expand Abs signatures (term/pred/conf detail) |
| `--abs` | Per-function algebra face (shape + conf; `--generalize` adds the symbolic term/pred α) — observation, still gates L1/L2 |
| `--fn <name>` | With `--abs`: restrict to one function |
| `--assume <pred…>` | With `--abs`: assume constraints on entry params (e.g. `x>0 y>=1`) |
| `--generalize` | With `--abs`: polymorphic signatures via symbolic execution |
| `--from <paths…>` | Usage-site files injecting call records |
| `--ignore-throws <names>` | Comma-separated L2 throw types to ignore (never swallows L1) |
| `--entry-throws error\|warning\|off` | L2 severity (default `error`) |
| `--profile adoption\|strict` | Gate profile (default `strict`); `adoption` ≡ L2 entry-throws `warning`, L1 stays error — see [Profiles](./check.md#profiles-adoption-vs-strict) |
| `--gha` | GitHub Actions inline annotations (`::error` / `::warning`); auto-enabled when `GITHUB_ACTIONS=true` |
| `--gitlab` | GitLab Code Quality JSON array on stdout — redirect to `gl-code-quality-report.json` |

## Interface diagnostics

The sidecar / contract-plumbing codes (`nudo:interface-*`, `nudo:dual-entry`) are all listed in [What it checks](./check.md#what-it-checks). Two scoping rules:

- Violations written **in the analyzed file** report `nudo:constraint-violated`.
- `nudo:interface-domain-exceeds` covers call records injected from usage-site files (`nudo check --from <paths...>`).

## CI integration

`nudo check` is the CI gate for contracts and entry throws — aligned with `tsc --noEmit`, except check **still prints signatures on success**. `--abs` remains observation but still gates on L1/L2 errors. Exit codes: `0` = no error-level diagnostic, `1` = any error-level diagnostic (L1 or non-ignored L2) — full table in [CLI Reference](../api/cli-reference.md#nudo-check).

### GitHub Actions

```yaml
name: nudo-check
on: [pull_request]
jobs:
  nudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx nudojs check .
```

Diagnostics land as PR inline annotations (`::error` / `::warning`) on the offending lines in **Files changed** — no extra flag needed: GitHub runners set `GITHUB_ACTIONS=true`, which auto-enables `--gha`. Pass `--gha` explicitly to force annotations when that variable is absent; combined with `--json`, stdout stays machine-readable while annotations still reach the log stream (stderr).

### GitLab CI

```yaml
nudo:check:
  script:
    - npx nudojs check . --gitlab > gl-code-quality-report.json
  artifacts:
    reports:
      codequality: gl-code-quality-report.json
```

`--gitlab` emits the GitLab Code Quality JSON array on stdout; the redirect writes `gl-code-quality-report.json`, and declaring it as a `codequality` artifact lets the pipeline's **Code Quality** tab render the diagnostics on merge-request diffs.

```bash
# machine-readable (1 file → CheckJson; N files → CheckJsonMulti envelope)
nudo check src/lib.js --json
```

### CI wiring recipes

**Monorepo scan roots** — gate source roots only, never `node_modules`, build output, or vendored corpora:

```bash
npx nudojs check packages/*/src
```

**L2 adoption policy** — by default L2 (`nudo:entry-may-throw`) is error. Adopting on legacy JS? `--profile adoption` demotes only entry may-throw to warning while L1 stays error — semantics, persistence, and resolution order in [Profiles](./check.md#profiles-adoption-vs-strict):

```bash
npx nudojs check . --profile adoption
```

**Cache sizing** — the analysis session cache is an in-process LRU (default 64 files). Cap it when CI analyzes many projects; raise it for warm hits on one large repo:

```bash
NUDO_CACHE_MAX_FILES=32 npx nudojs check packages/*/src   # many projects
NUDO_CACHE_MAX_FILES=512 npx nudojs check .               # one large repo
```

Full internal design note (in-repo, leaves this site): [`docs/ci-nudo-check.md`](https://github.com/nudojs/nudo/blob/main/docs/ci-nudo-check.md).

## Next

- [CLI Usage](./cli.md) — all primary verbs
- [nudo test](./test.md) — case reports and declared assertions
- [Abs](../concepts/abs.md) — `any` vs `unknown`
- [Diagnostics glossary](../reference/diagnostics.md) — stable codes and how to read them
- [Concept Layers](../concepts/layers.md) — Observation / Contracts
