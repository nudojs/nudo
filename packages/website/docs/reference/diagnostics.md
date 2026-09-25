---
slug: /reference/diagnostics
description: Stable Nudo diagnostic codes — meaning, minimal repro, Abs view, and fixes.
---

# Diagnostics glossary

Stable codes printed by `nudo check` / analysis. Product-native messages use **`actual ⊭ expected`** (Nudo Abs implication), not TypeScript diagnostics in disguise.

Machine-readable face: `nudo check --json`. Agents: see [Agents](/docs/reference/agents) and the published [agents.md](https://nudojs.github.io/nudo/agents.md).

## Contract gate (L1)

### `nudo:constraint-violated` {#nudo-constraint-violated}

| | |
|--|--|
| **Meaning** | Call/return does not satisfy an explicit contract Pred |
| **Layer** | L1 error |
| **Source** | `*.nudo.js` / `@nudo:refine` |

```javascript
// needsPositive with @nudo:refine x positive
needsPositive(-1);
// actual:   -1  #exact
// expected: x > 0
```

**Fix:** tighten the call site, or correct the contract if the obligation was wrong. **Intentional out-of-range input** is not a product default — change the contract, do not “ignore” L1 silently.

### `nudo:assign-mismatch` {#nudo-assign-mismatch}

Assignment / binding shape does not satisfy a previous contract shape (`leqAbs` structural fail). Fix the value or the declared slot.

### `nudo:arg-structure` {#nudo-arg-structure}

HOF argument is not a callable `fn` or arity mismatches an **explicit** relation contract. (Body-promote suggestions are warnings, not this error.)

### Call-site verification precision

These fire from call-site / contract verification (`checkCall` / `checkArg`): when a call is checked against a generalized parameter face, the checker reports not only violations but also *degraded verification* — honest "cannot prove" instead of silent pass.

### `nudo:constraint-unproven` {#nudo-constraint-unproven}

```text
cannot prove the argument satisfies x > 0
```

Argument pred does not provably imply the contract pred, and it is not a literal the engine can decide. **Warning** — verification is inconclusive, not failed. Fix: add a call site / `@nudo:case`, or state preconditions via `--assume`.

### `nudo:arg-opaque` {#nudo-arg-opaque}

```text
argument type is unknown; cannot verify constraint x > 0
```

The argument Abs is `unknown` (no term) — the constraint cannot even be checked. **Warning** — add a call site or `@nudo:case`, or provide preconditions via `--assume`. Model the value's source (env / mock) if the `unknown` is engine debt.

### `nudo:arg-count` {#nudo-arg-count}

```text
scale expects 2 argument(s), got 1
```

Arity mismatch between the call and the generalized parameter face. **Error.**

### `nudo:fn-not-found` {#nudo-fn-not-found}

```text
function nope not found
```

A call references a function the analyzer cannot resolve in scope. **Error** — check the name / export, or provide the missing module via env / `@nudo:mock-module`.

### `nudo:partial-result` {#nudo-partial-result}

```text
f(...) result confidence partial
```

Result Abs carries `#partial` confidence. **Info** — observation only. Suggestion: add a call site or constraint to improve precision.

### `nudo:case-inconsistency` {#nudo-case-inconsistency}

A declared `@nudo:case` witness conflicts with an explicit refine. Debug witness vs contract disagree — fix the witness or the contract.

### `nudo:interface-param-mismatch` {#nudo-interface-param-mismatch}

Handwritten contract param name is not on the formal surface. (Diagnostic ID keeps historical `interface` token; product term is **contract**.)

### `nudo:interface-conflict` {#nudo-interface-conflict}

Handwritten contract conjunction is unsatisfiable. Simplify the sidecar / refine.

### `nudo:interface-load` {#nudo-interface-load}

Sidecar file failed to load (parse / import / resolution error). **Error.** Fix the sidecar, or remove the binding if the contract is gone.

### `nudo:interface-name-clash` {#nudo-interface-name-clash}

Sidecar export name collides with a source export, or emit would overwrite a handwritten binding. Handwritten always wins.

### `nudo:interface-cycle` {#nudo-interface-cycle}

Sidecar `@nudo:import` chain forms a cycle. **Error.** Fix: break the sidecar import cycle.

### `nudo:interface-domain-exceeds` {#nudo-interface-domain-exceeds}

Cross-file call-site evidence injected via `nudo check --from` is not within the handwritten contract domain (`⊄`). **Error.** Fix: widen the contract, or correct the usage site.

### `nudo:interface-drift` {#nudo-interface-drift}

Persisted `@generated` sidecar segment ≠ today's recomputed call-site domain or return. **Warning** — does not gate exit.

### `nudo:interface-entry-only` {#nudo-interface-entry-only}

Exported function has **no contract root** (no handwritten / generated sidecar or `@nudo:refine`) **and no call-site domain** (only synthesized `entry@` with `any` params). **Info** — coverage/contract gap, not a gate failure. Fix: add a contract (`*.nudo.js` / `@nudo:refine`) or exercise the export from usage sites (`nudo check --from`).

### `nudo:dual-entry` {#nudo-dual-entry}

```text
dual-entry package "lib": browser (./browser.js) and node (./node.js) call-site
records do not cross files — analysis observes only the browser entry variant
```

The package ships **browser/node dual entrypoints** (package.json `exports` conditions or a `browser` field pointing at a different file than `main`/`node`), and this analysis ran on one variant. Call-site records are file-scoped: evidence collected against the other entry does **not** inject here. **Info** — observation, not a gate failure. Never fires on single-entry packages or on shared helpers that are not an entry target.

**Fix:** analyze the entry you ship and mock or skip the other variant; do not expect `--from` records to merge across the two faces. Still a ceiling — see [Limits](/docs/concepts/limits).

### `nudo:interface-emit-denied` {#nudo-interface-emit-denied}

```text
emit target 'path/lib.nudo.js' is outside package.json#nudo.contract.emit allowlist
```

`contract --emit` refused to write a sidecar outside the configured allowlist. **Warning** — the write is skipped. Fix: move the target, or extend `package.json#nudo.contract.emit`.

### `nudo:interface-multi-declarator` {#nudo-interface-multi-declarator}

```text
generated section 'a, b' is a hand-merged multi-declarator form; kept verbatim
```

A `@generated` section was hand-merged into one multi-declarator export. **Warning** — kept verbatim (handwritten wins); split it into one export per section to make it re-emittable.

### `nudo:interface-not-projectable` {#nudo-interface-not-projectable}

```text
assembled sidecar failed round-trip (path); refusing to write
```

The assembled sidecar source failed to re-parse to the derived interface. **Error** — nothing is written. Report as engine debt (round-trip must succeed), and adjust the source until `contract --emit --dry-run` is clean.

## Runtime boundary (L2)

### `nudo:entry-may-throw` {#nudo-entry-may-throw}

| | |
|--|--|
| **Meaning** | Entry/export function has undigested may-throw |
| **Layer** | L2 error (default) |
| **Display** | `throws TypeError` on the signature line |

```javascript verify
export function getName(user) {
  return user.name; // any receiver → may throw
}
```

**Fix options:** refine param to a shape; `try/catch` the path; or (while migrating) `--ignore-throws TypeError` / `package.json#nudo.check.ignoreThrows` / `--entry-throws warning`. **L2 does not gate internal helpers.**

## Engine debt / observation

### `nudo:unknown-inference` {#nudo-unknown-inference}

True `unknown` on a signature — inference failed. **Not** unconstrained entry `any`. Fix: model env, add mock, or refine.

### `nudo:unknown-recv` {#nudo-unknown-recv}

Member access on `unknown` receiver. Does not replace L2 throws modeling.

### `nudo:builtin-unknown` {#nudo-builtin-unknown}

API not covered by env/inference (e.g. unmodeled global). Prefer `@nudo:env` / mock.

### `nudo:opaque-result` {#nudo-opaque-result}

Evaluation returned opaque / uninformative Abs.

### `nudo:eval-error` {#nudo-eval-error}

Body evaluation threw during analysis.

### `nudo:recursion-truncated` {#nudo-recursion-truncated}

Recursion budget hit; result widened.

### `nudo:fork-truncated` {#nudo-fork-truncated}

Branch-expansion budget (`$fork` total count) hit; affected results widened. **Warning.** Raise via `NUDO_MAX_FORKS` or `package.json#nudo.analysis.maxForks` (default 5000).

### `nudo:no-signature` {#nudo-no-signature}

Function could not be generalized (CJS/anon forms still get L2 via entry fallback).

### `nudo:no-method` {#nudo-no-method}

Member access that cannot resolve: ``Method 'x' does not exist on type 'T'`` / ``Property 'x' does not exist on type 'T'``. **Error** on primitive receivers (`number` / `boolean` / `bigint` / `symbol`), warning otherwise. Distinct from `nudo:unknown-recv` (which fires on an `unknown` receiver).

### `nudo:mock-invalid` {#nudo-mock-invalid}

A `@nudo:mock` expression could not be parsed as a known pattern (stub/spy/mock forms, arrow functions, or type expressions). **Warning** — check the supported forms.

### `nudo:env-harvest-conflict` {#nudo-env-harvest-conflict}

```text
handwritten @nudo:env wins over harvest on module "fs"; harvest only fills missing slots
```

A handwritten `@nudo:env` module and the `@types` harvest both supply the same module key or export. **Warning** — the handwritten env is authoritative (`mergeHarvestUnderEnv`); harvest only fills missing slots. To silence: remove the overlapping export from the handwritten env, or accept the precedence.

### `nudo:interface-underivable` {#nudo-interface-underivable}

A **derived** contract row (root-driven derivation / `nudo contract --draft`) cannot be derived from source evidence (opaque / truncated / no evidence). **Info** — the row is skipped; handwritten contracts are never flagged by this code.

### `nudo-unreachable` {#nudo-unreachable}

Code after `return`/`throw` — info level. Note the hyphen: this is the one diagnostic id without a colon.

### `nudo:may-throw` {#nudo-may-throw}

Case-path may throw (test / clue). L2 elevates **entry** throws.

## Module graph

Reported when Abs module evaluation (`evalAbsModuleGraph`) hits a load problem. `cycle`/`depth` are warnings; `missing` is an error.

### `nudo:module-cycle` {#nudo-module-cycle}

```text
Circular module load: a.js -> b.js -> a.js
(bindings inside the cycle resolve to their partially evaluated types)
```

**Fix:** break the cycle (extract shared logic) or accept the partial types.

### `nudo:module-depth` {#nudo-module-depth}

```text
Module load chain too deep (depth N > M max): a.js -> b.js -> …
(loading truncated, deeper modules typed as unknown)
```

**Fix:** the chain exceeds the loader depth budget — flatten re-export hops or raise the budget.

### `nudo:module-missing` {#nudo-module-missing}

```text
Module file not found for 'spec' (from file); tried: path
```

**Error.** The analyzed file imports a module the loader cannot resolve. **Fix:** correct the spec, or mock the module (`@nudo:mock-module` / `@nudo:mock`).

### `nudo:missing-slot` {#nudo-missing-slot}

```text
Field 'name' is missing on the evaluated object shape
```

**Warning, default off.** C0.5: evaluation actually hit a closed object shape's missing field (opt in with `package.json#nudo.analysis.evalMissingSlot: "warning"`). It is **observation, not an obligation** — it never invents check errors; handwritten contracts still gate through `nudo:constraint-violated`.

## Test assertions (`nudo test`)

### `nudo:case-expected` {#nudo-case-expected}

```text
debug "bad": expected 5, got 4. The inferred return type does not match the
expected type declared in the @nudo:case witness
```

A declared `@nudo:case "name" (…) => expected` witness whose expected type does not match the inferred result. **Error in the test run** — a declared assertion failure sets `nudo test` exit `1`; synthetic `call@` / `entry@` cases never fail the run.

The failure face in the report:

```text
=== double ===
  debug "bad"  (2) => 4

assertions
  ✗ 0 passed · 1 failed · 0 unchecked
  [FAIL] double  case "bad"
         expected: 5
         actual:   4
```

**Fix:** correct the witness expectation or the function body.

## Reading `actual ⊭ expected`

```text
actual:   0  #exact     // Abs observed at the call
expected: price > 0     // Pred from the contract
```

Conf markers on Abs: `#exact` / `#path` / `#widened` / `#mock` / `#partial` / `#opaque` — see [Abs](/docs/concepts/type-values).

## Config that affects diagnostics

```json
{
  "nudo": {
    "analysis": { "mode": "exports", "evalMissingSlot": "off" },
    "check": {
      "ignoreThrows": ["TypeError"],
      "entryThrows": "error"
    },
    "contract": { "autoBind": true }
  }
}
```

`ignoreThrows` / `entryThrows` affect **L2 only** — they never swallow L1 contract violations.

## Next

- [nudo check](/docs/guides/check)
- [Contracts](/docs/guides/contract)
- [Limits](/docs/concepts/limits)
- [CLI reference](/docs/api/cli-reference)
