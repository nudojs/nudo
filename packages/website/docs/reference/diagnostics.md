---
slug: /reference/diagnostics
description: Stable Nudo diagnostic codes — meaning, minimal repro, Abs view, and fixes.
---

# Diagnostics glossary

Stable codes printed by `nudo check` / analysis. Product-native messages use **`actual ⊭ expected`** (Nudo Abs implication), not TypeScript diagnostics in disguise.

Machine-readable face: `nudo check --json`. Agents: see [Agents](./agents.md) and the published [agents.md](https://nudojs.github.io/nudo/agents.md).

## Contract gate (L1)

### `nudo:constraint-violated` {#nudo-constraint-violated}

| | |
|--|--|
| **Meaning** | Call/return does not satisfy an explicit contract Pred |
| **Layer** | L1 error |
| **Source** | `*.nudo.js` / `@nudo:contract` |

```javascript
// needsPositive with @nudo:contract x positive
needsPositive(-1);
// actual:   -1  #exact
// expected: x > 0
```

**Fix:** tighten the call site, or correct the contract if the obligation was wrong. **Intentional out-of-range input** is not a product default — change the contract, do not “ignore” L1 silently.

Context: [L1 — explicit contracts](../guides/check.md#l1--explicit-contracts) · [Gate with check](../guides/contract.md#gate-with-check)

### `nudo:assign-mismatch` {#nudo-assign-mismatch}

Assignment / binding shape does not satisfy a previous contract shape (`leqAbs` structural fail). Fix the value or the declared slot.

Context: [L1 — explicit contracts](../guides/check.md#l1--explicit-contracts) · [Contracts](../guides/contract.md)

### `nudo:arg-structure` {#nudo-arg-structure}

HOF argument is not a callable `fn` or arity mismatches an **explicit** relation contract. (Body-promote suggestions are warnings, not this error.)

Context: [nudo check](../guides/check.md#what-it-checks) · [Contracts](../guides/contract.md)

### Call-site verification precision

These fire from call-site / contract verification (`checkCall` / `checkArg`): when a call is checked against a generalized parameter face, the checker reports not only violations but also *degraded verification* — honest "cannot prove" instead of silent pass.

### `nudo:constraint-unproven` {#nudo-constraint-unproven}

```text
cannot prove the argument satisfies x > 0
```

Argument pred does not provably imply the contract pred, and it is not a literal the engine can decide. **Warning** — verification is inconclusive, not failed. Fix: add a call site / `@nudo:case`, or state preconditions via `--assume`.

Context: [nudo check](../guides/check.md#what-it-checks) · [Predicate implication (bounded)](../concepts/limits.md#predicate-implication-bounded)

### `nudo:arg-opaque` {#nudo-arg-opaque}

```text
argument type is unknown; cannot verify constraint x > 0
```

The argument Abs is `unknown` (no term) — the constraint cannot even be checked. **Warning** — add a call site or `@nudo:case`, or provide preconditions via `--assume`. Model the value's source (env / mock) if the `unknown` is engine debt.

Context: [`any` vs `unknown`](../concepts/limits.md#any-vs-unknown) · [nudo check](../guides/check.md#what-it-checks)

### `nudo:arg-count` {#nudo-arg-count}

```text
scale expects 2 argument(s), got 1
```

Arity mismatch between the call and the generalized parameter face. **Error.**

Context: [nudo check](../guides/check.md#what-it-checks) · [Usage sites (`--from`)](../guides/test.md#usage-sites---from)

### `nudo:fn-not-found` {#nudo-fn-not-found}

```text
function nope not found
```

A call references a function the analyzer cannot resolve in scope. **Error** — check the name / export, or provide the missing module via env / `@nudo:mock-module`.

Context: [@nudo:mock-module](../concepts/directives.md#nudo--module-level-mock) · [Dependency types](../guides/env-harvest.md)

### `nudo:partial-result` {#nudo-partial-result}

```text
f(...) result confidence partial
```

Result Abs carries `#partial` confidence. **Info** — observation only. Suggestion: add a call site or constraint to improve precision.

Context: [nudo check](../guides/check.md#what-it-checks) · [Usage sites (`--from`)](../guides/test.md#usage-sites---from)

### `nudo:case-inconsistency` {#nudo-case-inconsistency}

A declared `@nudo:case` witness conflicts with an explicit refine. Debug witness vs contract disagree — fix the witness or the contract.

Context: [@nudo:case](../concepts/directives.md#nudocase--debug-witnesses) · [Declared assertions](../guides/test.md#declared-assertions)

### `nudo:interface-param-mismatch` {#nudo-interface-param-mismatch}

Handwritten contract param name is not on the formal surface. (Diagnostic ID keeps historical `interface` token; product term is **contract**.)

Context: [Contracts first](../guides/contract.md#contracts-first-contracts-style) · [Interface diagnostics](../guides/check.md#interface-diagnostics)

### `nudo:interface-conflict` {#nudo-interface-conflict}

Handwritten contract conjunction is unsatisfiable. Simplify the sidecar / refine.

Context: [Contracts first](../guides/contract.md#contracts-first-contracts-style) · [Interface diagnostics](../guides/check.md#interface-diagnostics)

### `nudo:interface-load` {#nudo-interface-load}

Sidecar file failed to load (parse / import / resolution error). **Error.** Fix the sidecar, or remove the binding if the contract is gone.

Context: [Sidecar auto-binding](../concepts/directives.md#main-path-sidecar-auto-binding) · [Interface diagnostics](../guides/check.md#interface-diagnostics)

### `nudo:interface-name-clash` {#nudo-interface-name-clash}

Sidecar export name collides with a source export, or emit would overwrite a handwritten binding. Handwritten always wins.

Context: [Emit generated segments](../guides/contract.md#emit-generated-segments) · [Interface diagnostics](../guides/check.md#interface-diagnostics)

### `nudo:interface-cycle` {#nudo-interface-cycle}

Sidecar `@nudo:import` chain forms a cycle. **Error.** Fix: break the sidecar import cycle.

Context: [@nudo:import](../concepts/directives.md#nudo--constraint-templates) · [Interface diagnostics](../guides/check.md#interface-diagnostics)

### `nudo:interface-domain-exceeds` {#nudo-interface-domain-exceeds}

Cross-file call-site evidence injected via `nudo check --from` is not within the handwritten contract domain (`⊄`). **Error.** Fix: widen the contract, or correct the usage site.

Context: [Interface diagnostics](../guides/check.md#interface-diagnostics) · [Usage sites (`--from`)](../guides/test.md#usage-sites---from)

### `nudo:interface-drift` {#nudo-interface-drift}

Persisted `@generated` sidecar segment ≠ today's recomputed call-site domain or return. **Warning** — does not gate exit.

Context: [Emit generated segments](../guides/contract.md#emit-generated-segments) · [Interface diagnostics](../guides/check.md#interface-diagnostics)

### `nudo:interface-entry-only` {#nudo-interface-entry-only}

Exported function has **no contract root** (no handwritten / generated sidecar or `@nudo:contract`) **and no call-site domain** (only synthesized `entry@` with `any` params). **Info** — coverage/contract gap, not a gate failure. Fix: add a contract (`*.nudo.js` / `@nudo:contract`) or exercise the export from usage sites (`nudo check --from`).

Context: [Observation → draft](../guides/contract.md#observation--draft-logic-first) · [Interface diagnostics](../guides/check.md#interface-diagnostics)

### `nudo:dual-entry` {#nudo-dual-entry}

```text
dual-entry package "lib": browser (./browser.js) and node (./node.js) call-site
records do not cross files — analysis observes only the browser entry variant
```

The package ships **browser/node dual entrypoints** (package.json `exports` conditions or a `browser` field pointing at a different file than `main`/`node`), and this analysis ran on one variant. Call-site records are file-scoped: evidence collected against the other entry does **not** inject here. **Info** — observation, not a gate failure. Never fires on single-entry packages or on shared helpers that are not an entry target.

**Fix:** analyze the entry you ship and mock or skip the other variant; do not expect `--from` records to merge across the two faces. Still a ceiling — see [Limits](../concepts/limits.md).

Context: [Call-site discovery ceiling](../concepts/limits.md#call-site-discovery-ceiling)

### `nudo:interface-emit-denied` {#nudo-interface-emit-denied}

```text
emit target 'path/lib.nudo.js' is outside package.json#nudo.contract.emit allowlist
```

`contract --emit` refused to write a sidecar outside the configured allowlist. **Warning** — the write is skipped. Fix: move the target, or extend `package.json#nudo.contract.emit`.

Context: [Emit generated segments](../guides/contract.md#emit-generated-segments)

### `nudo:interface-multi-declarator` {#nudo-interface-multi-declarator}

```text
generated section 'a, b' is a hand-merged multi-declarator form; kept verbatim
```

A `@generated` section was hand-merged into one multi-declarator export. **Warning** — kept verbatim (handwritten wins); split it into one export per section to make it re-emittable.

Context: [Emit generated segments](../guides/contract.md#emit-generated-segments)

### `nudo:interface-not-projectable` {#nudo-interface-not-projectable}

```text
assembled sidecar failed round-trip (path); refusing to write
```

The assembled sidecar source failed to re-parse to the derived interface. **Error** — nothing is written. Report as engine debt (round-trip must succeed), and adjust the source until `contract --emit --dry-run` is clean.

Context: [Emit generated segments](../guides/contract.md#emit-generated-segments)

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

Context: [L2 — entry throws](../guides/check.md#l2--entry-throws) · [@nudo:throws](../concepts/directives.md#nudothrows--declare-intentional-throws)

## Engine debt / observation

### `nudo:unknown-inference` {#nudo-unknown-inference}

True `unknown` on a signature — inference failed. **Not** unconstrained entry `any`. Fix: model env, add mock, or refine.

Context: [`any` vs `unknown`](../concepts/limits.md#any-vs-unknown) · [Dependency types](../guides/env-harvest.md)

### `nudo:unproven-return` {#nudo-unproven-return}

Return postcondition could not be proved (any / unknown / opaque face, or a widened/bound-less arm facing a bounded obligation, or an out-of-bounds marker arm — an abstract index read like `d[m][n]` on a loop-built table joins a synthetic `undefined`; the loop-bound/length relation is lost, so neither proof nor disproof is possible). A bare widened `prim` arm still proves a bound-less prim contract (`number()` / `string()`) — the value domain is known even without term/pred evidence; only bounds (`gt(0)`, `int`, …) remain unprovable. **Warning** — inference failed to discharge the obligation; do not treat as success. Distinct from `nudo:constraint-violated` (definite violation).

Context: [nudo check](../guides/check.md#what-it-checks)

### `nudo:unknown-recv` {#nudo-unknown-recv}

Member access on `unknown` receiver. Does not replace L2 throws modeling.

Context: [`any` vs `unknown`](../concepts/limits.md#any-vs-unknown) · [L2 — entry throws](../guides/check.md#l2--entry-throws)

### `nudo:builtin-unknown` {#nudo-builtin-unknown}

API not covered by env/inference (e.g. unmodeled global). Prefer `@nudo:env` / mock.

Context: [@nudo:env](../concepts/directives.md#nudo--runtime-environment) · [Dependency types](../guides/env-harvest.md)

### `nudo:opaque-result` {#nudo-opaque-result}

Evaluation returned opaque / uninformative Abs.

Context: [Evaluator gaps](../concepts/limits.md#evaluator-gaps-summary)

### `nudo:eval-error` {#nudo-eval-error}

Body evaluation threw during analysis.

Context: [Evaluator gaps](../concepts/limits.md#evaluator-gaps-summary)

### `nudo:recursion-truncated` {#nudo-recursion-truncated}

Recursion budget hit; result widened. Budget knobs and what to do: [Performance](../guides/performance.md).

Context: [Analysis budgets](../guides/performance.md#analysis-budgets)

### `nudo:fork-truncated` {#nudo-fork-truncated}

Branch-expansion budget (`$fork` total count) hit; affected results widened. **Warning.** Raise via `NUDO_MAX_FORKS` or `package.json#nudo.analysis.maxForks` (default 5000). Budgets and fixes: [Performance](../guides/performance.md).

Context: [Analysis budgets](../guides/performance.md#analysis-budgets)

### `nudo:promise-micro-truncated` {#nudo-promise-micro-truncated}

Promise microtask queue hit the hard cap (`MAX_PROMISE_MICROS = 1024`); remaining queued callbacks were dropped. **Info.** Affected promise results stay widened rather than silently wrong.

Context: [Analysis budgets](../guides/performance.md#analysis-budgets)

### `nudo:promise-micro-error` {#nudo-promise-micro-error}

A queued promise microtask threw while being drained at an eval exit. **Info.** The callback's effect is incomplete; inspect the reported error and the expression that queued the then/catch.

Context: [Analysis budgets](../guides/performance.md#analysis-budgets)

### `nudo:math-fold-error` {#nudo-math-fold-error}

A Math native fold threw during analysis (host-tampered or divergent `Math.*`); the result was widened to `number`. **Info.** Keep `Math.*` builtins unmodified in analyzed code, or mock them with `@nudo:mock` — non-blocking.

Context: [Mocking external dependencies](../concepts/mocking.md)

### `nudo:host-effect-blocked` {#nudo-host-effect-blocked}

Host side-effect function (`fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `setTimeout` / `setInterval` / `setImmediate` / `queueMicrotask` / `requestAnimationFrame` / `requestIdleCallback`) was not executed during analysis — running it for real would perform network I/O or schedule real timers with Abs arguments. Result widened to `unknown#opaque`. **Info.** Mock it with `@nudo:mock` / `@nudo:env`, or feed the value in from a call site.

Context: [Mocking external dependencies](../concepts/mocking.md) · [@nudo:env](../concepts/directives.md#nudo--runtime-environment)

### `nudo:no-signature` {#nudo-no-signature}

Function could not be generalized (CJS/anon forms still get L2 via entry fallback).

Context: [Evaluator gaps](../concepts/limits.md#evaluator-gaps-summary) · [nudo check](../guides/check.md#what-it-checks)

### `nudo:no-method` {#nudo-no-method}

Member access that cannot resolve: ``Method 'x' does not exist on type 'T'`` / ``Property 'x' does not exist on type 'T'``. **Error** on primitive receivers (`number` / `boolean` / `bigint` / `symbol`), warning otherwise. Distinct from `nudo:unknown-recv` (which fires on an `unknown` receiver).

Context: [Evaluator gaps](../concepts/limits.md#evaluator-gaps-summary)

### `nudo:mock-invalid` {#nudo-mock-invalid}

A `@nudo:mock` expression could not be parsed as a known pattern (stub/spy/mock forms, arrow functions, or type expressions). **Warning** — check the supported forms.

Context: [Mocking syntax](../concepts/mocking.md#syntax) · [@nudo:mock](../concepts/directives.md#nudo--mock-external-dependencies)

### `nudo:directive-syntax` {#nudo-directive-syntax}

Malformed `@nudo:case` / `@nudo:mock` / `@nudo:as` / `@nudo:skip` directive syntax (bad name, trailing comment, unrecognized type expression). **Warning** — the directive is ignored; fix the form.

Context: [Directive syntax](../concepts/directives.md) · [Skip grammar](../concepts/directives.md#nudo--skip-evaluation)

### `nudo:contract-syntax` {#nudo-contract-syntax}

Malformed `@nudo:contract` segment or `@nudo:import` form (e.g. `x > 0` instead of `x positive`, default import). **Warning** — the segment is ignored; use `<param> <constraintName>` or `return <constraintName>`.

Context: [Contracts](../concepts/directives.md#nudo--constraint-templates) · [Contract gate (L1)](../guides/check.md#l1--explicit-contracts)

### `nudo:env-unresolved` {#nudo-env-unresolved}

```text
path env failed to load: ./nudo-env.mjs — Cannot find package '@nudojs/env'
path env failed to load: ./nope.mjs — path env not found: <resolved-path>
```

A **path-type** env entry (`package.json#nudo.env` path item, or `/// @nudo:env <path>`) failed to load — either the direct `import()` and the bare-specifier rewrite fallback both failed, or the pointed-to file does not exist. **Warning** — the env falls back to "env off" semantics for that entry, so the analysis silently loses those bindings (a run where the env loads can infer more); do not treat the warning as benign.

**Emitted by:** `nudo check` (issues section), `nudo test` (env warnings section, identical line format; with `--json` the warning goes to stderr so stdout stays a single JSON document), and the LSP (warning diagnostic with this code, same message format). It never gates the exit code.

**Fix:** check that the `package.json#nudo.env` path (or `/// @nudo:env <path>`) points at an existing, intended file and that its imports resolve — fix the import specifiers inside the env file, make sure `@nudojs/env` (and `@nudojs/core`) are resolvable from the project, or drop the entry.

Context: [Env & harvest](../guides/env-harvest.md)

### `nudo:env-harvest-conflict` {#nudo-env-harvest-conflict}

```text
handwritten @nudo:env wins over harvest on module "fs"; harvest only fills missing slots
```

A handwritten `@nudo:env` module and the `@types` harvest both supply the same module key or export. **Warning** — the handwritten env is authoritative (`mergeHarvestUnderEnv`); harvest only fills missing slots. To silence: remove the overlapping export from the handwritten env, or accept the precedence.

Context: [Common pitfalls](../guides/env-harvest.md#common-pitfalls)

### `nudo:interface-underivable` {#nudo-interface-underivable}

A **derived** contract row (root-driven derivation / `nudo contract --draft`) cannot be derived from source evidence (opaque / truncated / no evidence). **Info** — the row is skipped; handwritten contracts are never flagged by this code.

Context: [Observation → draft](../guides/contract.md#observation--draft-logic-first)

### `nudo-unreachable` {#nudo-unreachable}

Code after `return`/`throw` — info level. Note the hyphen: this is the one diagnostic id without a colon.

Context: [nudo check](../guides/check.md#what-it-checks)

### `nudo:may-throw` {#nudo-may-throw}

Case-path may throw (test / clue). L2 elevates **entry** throws.

Context: [L2 — entry throws](../guides/check.md#l2--entry-throws) · [@nudo:throws](../concepts/directives.md#nudothrows--declare-intentional-throws)

### `nudo:internal` {#nudo-internal}

```text
Check error: <message>
```

Internal analysis/check failure surfaced as a diagnostic (check gate could not run to completion). **Error** — the check channel must not silently disappear; fix the underlying failure or report the bug.

Context: [nudo check](../guides/check.md#what-it-checks)

## Module graph

Reported when Abs module evaluation (`evalAbsModuleGraph`) hits a load problem. `cycle`/`depth` are warnings; `missing` / `missing-export` are errors.

### `nudo:module-cycle` {#nudo-module-cycle}

```text
Circular module load: a.js -> b.js -> a.js
(bindings inside the cycle resolve to their partially evaluated types)
```

**Fix:** break the cycle (extract shared logic) or accept the partial types.

Context: [nudo check](../guides/check.md#what-it-checks)

### `nudo:module-depth` {#nudo-module-depth}

```text
Module load chain too deep (depth N > M max): a.js -> b.js -> …
(loading truncated, deeper modules typed as unknown)
```

**Fix:** the chain exceeds the loader depth budget — flatten re-export hops or raise the budget.

Context: [nudo check](../guides/check.md#what-it-checks)

### `nudo:module-missing` {#nudo-module-missing}

```text
Module file not found for 'spec' (from file); tried: path
```

**Error.** The analyzed file imports a module the loader cannot resolve. **Fix:** correct the spec, or mock the module (`@nudo:mock-module` / `@nudo:mock`).

Context: [@nudo:mock-module](../concepts/directives.md#nudo--module-level-mock) · [nudo check](../guides/check.md#what-it-checks)

### `nudo:exports-unresolved` {#nudo-exports-unresolved}

Package.json `exports` declared targets but the subpath/conditions did not resolve to a file. **Warning** — analysis fell back to harvest stub / file guess, which may not match the real entry. Distinct from `nudo:module-missing` (no module at all).

Context: [Evaluator gaps](../concepts/limits.md#evaluator-gaps-summary)

### `nudo:missing-export` {#nudo-missing-export}

```text
Module './m.js' has no export 'b' (from index.js)
```

**Error.** A named `import` (or `export { x } from`) references a name the source module does not export — typically a typo. Only reported when the source module's export table came from a successful evaluation (fail-closed empty tables and unresolved modules stay silent so this never stacks on `nudo:module-missing`). **Fix:** correct the imported name, add the export to the source module, or mock the module (`@nudo:mock-module`).

Context: [@nudo:mock-module](../concepts/directives.md#nudo--module-level-mock) · [nudo check](../guides/check.md#what-it-checks)

### `nudo:missing-slot` {#nudo-missing-slot}

```text
Field 'name' is missing on the evaluated object shape
```

**Warning, default off.** C0.5: evaluation actually hit a closed object shape's missing field (opt in with `package.json#nudo.analysis.evalMissingSlot: "warning"`). It is **observation, not an obligation** — it never invents check errors; handwritten contracts still gate through `nudo:constraint-violated`.

Context: [Non-goals](../concepts/limits.md#non-goals)

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

Context: [Declared assertions](../guides/test.md#declared-assertions) · [@nudo:case](../concepts/directives.md#nudocase--debug-witnesses)

## CLI path resolution

Path errors from CLI target / `--from` resolution — collected in the `--json` envelope's `pathErrors[]` (`{ path, code, message, suggestion? }`), or printed as a one-line reason + `fix:` hint on the human face. Non-empty `pathErrors` ⇒ `ok: false` ⇒ exit `1`. Usage errors before analysis starts — not Abs diagnostics.

### `nudo:path-not-found` {#nudo-path-not-found}

```text
Not found: /abs/path
```

The requested path does not exist. **Error** (usage) — check the path; it must be an existing `.js`/`.mjs`/`.ts` file or a directory containing them.

Context: [nudo check](../api/cli-reference.md#nudo-check) · [What it checks](../guides/check.md#what-it-checks)

### `nudo:path-empty-dir` {#nudo-path-empty-dir}

```text
No nudo files found in directory: /abs/dir
```

The directory exists but holds no analysis targets. **Error** (usage) — add `.js`/`.mjs`/`.ts` sources (or point at a directory that has them); sidecar/decl/JSX are skipped.

Context: [nudo check](../api/cli-reference.md#nudo-check) · [What it checks](../guides/check.md#what-it-checks)

### `nudo:path-not-target` {#nudo-path-not-target}

```text
Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): /abs/file.nudo.js
```

The file exists but is not an analysis target (`.nudo.js` sidecars, `.d.ts` decls, and `.jsx`/`.tsx` are excluded). **Error** (usage) — pass a `.js`/`.mjs`/`.ts` analysis file.

Context: [nudo check](../api/cli-reference.md#nudo-check) · [What it checks](../guides/check.md#what-it-checks)

### `nudo:path-missing-callsite` {#nudo-path-missing-callsite}

```text
Callsite file not found: /abs/tests
```

A `--from` usage-site path does not exist. **Error** (usage) — pass `--from <file-or-dir>` that exists; it supplies `call@` records for generation.

Context: [Usage sites (`--from`)](../guides/test.md#usage-sites---from) · [nudo check](../api/cli-reference.md#nudo-check)

### `nudo:path-io` {#nudo-path-io}

```text
export --out mkdir failed: out/dir
```

A `--out` output-directory IO operation failed (`mkdir` / `write`). **Error** (usage) — the raw `errno` never reaches the product face; check that `--out <dir>` is writable and is a directory path, then re-run. (BUG-023: added so `nudo export` carries the same PathError face as `check` / `test`.)

Context: [nudo export](../api/cli-reference.md#nudo-export)

## Reading `actual ⊭ expected`

```text
actual:   0  #exact     // Abs observed at the call
expected: price > 0     // Pred from the contract
```

Conf markers on Abs: `#exact` / `#path` / `#widened` / `#mock` / `#partial` / `#opaque` — see [Abs](../concepts/abs.md).

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

- [nudo check](../guides/check.md)
- [Contracts](../guides/contract.md)
- [Limits](../concepts/limits.md)
- [CLI reference](../api/cli-reference.md)
