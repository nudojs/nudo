---
slug: /reference/diagnostics
description: Stable Nudo diagnostic codes — meaning, minimal repro, Abs view, and fixes.
---

# Diagnostics glossary

Stable codes printed by `nudo check` / analysis. Product-native messages use **`actual ⊭ expected`** (Nudo Abs implication), not TypeScript diagnostics in disguise.

Machine-readable face: `nudo check --json`. Agents: see [Agents](/docs/reference/agents) and the published [agents.md](https://nudojs.github.io/nudo/agents.md).

## Contract gate (L1)

### `nudo:constraint-violated`

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

### `nudo:assign-mismatch`

Assignment / binding shape does not satisfy a previous contract shape (`leqAbs` structural fail). Fix the value or the declared slot.

### `nudo:arg-structure`

HOF argument is not a callable `fn` or arity mismatches an **explicit** relation contract. (Body-promote suggestions are warnings, not this error.)

### `nudo:case-inconsistency`

A declared `@nudo:case` witness conflicts with an explicit refine. Debug witness vs contract disagree — fix the witness or the contract.

### `nudo:interface-param-mismatch`

Handwritten contract param name is not on the formal surface. (Diagnostic ID keeps historical `interface` token; product term is **contract**.)

### `nudo:interface-conflict`

Handwritten contract conjunction is unsatisfiable. Simplify the sidecar / refine.

### `nudo:interface-load` / `nudo:interface-name-clash`

Sidecar load failure, or emit would overwrite a handwritten binding. Handwritten always wins.

## Runtime boundary (L2)

### `nudo:entry-may-throw`

| | |
|--|--|
| **Meaning** | Entry/export function has undigested may-throw |
| **Layer** | L2 error (default) |
| **Display** | `throws TypeError` on the signature line |

```javascript
export function getName(user) {
  return user.name; // any receiver → may throw
}
```

**Fix options:** refine param to a shape; `try/catch` the path; or (while migrating) `--ignore-throws TypeError` / `package.json#nudo.check.ignoreThrows` / `--entry-throws warning`. **L2 does not gate internal helpers.**

## Engine debt / observation

### `nudo:unknown-inference`

True `unknown` on a signature — inference failed. **Not** unconstrained entry `any`. Fix: model env, add mock, or refine.

### `nudo:unknown-recv`

Member access on `unknown` receiver. Does not replace L2 throws modeling.

### `nudo:builtin-unknown`

API not covered by env/inference (e.g. unmodeled global). Prefer `@nudo:env` / mock.

### `nudo:opaque-result`

Evaluation returned opaque / uninformative Abs.

### `nudo:eval-error`

Body evaluation threw during analysis.

### `nudo:recursion-truncated`

Recursion budget hit; result widened.

### `nudo:no-signature`

Function could not be generalized (CJS/anon forms still get L2 via entry fallback).

### `nudo:unreachable`

Code after `return`/`throw` — info level.

### `nudo:may-throw`

Case-path may throw (test / clue). L2 elevates **entry** throws.

## Module graph

Reported when Abs module evaluation (`evalAbsModuleGraph`) hits a load problem. `cycle`/`depth` are warnings; `missing` is an error.

### `nudo:module-cycle`

```text
Circular module load: a.js -> b.js -> a.js
(bindings inside the cycle resolve to their partially evaluated types)
```

**Fix:** break the cycle (extract shared logic) or accept the partial types.

### `nudo:module-depth`

```text
Module load chain too deep (depth N > M max): a.js -> b.js -> …
(loading truncated, deeper modules typed as unknown)
```

**Fix:** the chain exceeds the loader depth budget — flatten re-export hops or raise the budget.

### `nudo:module-missing`

```text
Module file not found for 'spec' (from file); tried: path
```

**Error.** The analyzed file imports a module the loader cannot resolve. **Fix:** correct the spec, or mock the module (`@nudo:mock-module` / `@nudo:mock`).

### `nudo:missing-slot`

```text
Field 'name' is missing on the evaluated object shape
```

**Warning, default off.** C0.5: evaluation actually hit a closed object shape's missing field (opt in with `package.json#nudo.analysis.evalMissingSlot: "warning"`). It is **observation, not an obligation** — it never invents check errors; handwritten contracts still gate through `nudo:constraint-violated`.

## Reading `actual ⊭ expected`

```text
actual:   0  #exact     // Abs observed at the call
expected: price > 0     // Pred from the contract
```

Conf markers on Abs: `#exact` / `#path` / `#widened` / `#partial` / `#opaque` — see [Abs](/docs/concepts/type-values).

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
