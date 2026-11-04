---
slug: /guides/directive-cheatsheet
description: "One-line syntax + semantics for every @nudo: directive — case, contract, mock, env, import, assume, invariant, budget, pure, skip, sample, as, replace, mock-module — plus the constraint-builder quick reference."
---

# Directive cheatsheet

One line per directive: syntax, what it does, and a link to the full reference. The authoritative page is [Directives](../concepts/directives.md) — this is the lookup card, not a replacement.

**Placement in one breath:** function-scoped directives sit in the block comment directly above their function (`@nudo:case` / `@nudo:mock` / `@nudo:pure` / `@nudo:skip` / `@nudo:sample` also accept the single-line `//` form); file-level directives use triple-slash `///` at the top of the file; `@nudo:as` and `@nudo:replace` are line comments above the statement they rewrite.

## The five you'll write daily

| Directive | Syntax | One-line semantics | Full docs |
|---|---|---|---|
| `@nudo:case` | `@nudo:case "name" (args)` · `@nudo:case "name" (args) => expected` | Debug witnesses: inputs `nudo test` executes the function with (`=> expected` asserts the result); also drives LSP scenario switching. **Not** the contract product. | [@nudo:case](../concepts/directives.md#nudocase--debug-witnesses) · [nudo test](./test.md) |
| `@nudo:contract` | `@nudo:contract x positive` · `@nudo:contract return positive` | In-source refinement contract on a parameter or the return; the constraint enters Abs as a Pred and participates in algebra. The main path is the `*.nudo.js` sidecar. | [@nudo:contract](../concepts/directives.md#nudocontract--source-contract) · [nudo contract](./contract.md) |
| `@nudo:mock` | `@nudo:mock fetch = (url) => ({ … })` · `@nudo:mock name from "./mock.js"` | Replace an external dependency (`fetch`, `fs`, …) with a mock during evaluation — five forms, every expression on a single line. | [Mocking](../concepts/mocking.md) |
| `@nudo:env` | `/// @nudo:env web` | File-level: enable built-in runtime API types — `es` / `web` / `node` (`web` and `node` include `es`), or a custom `./nudo-env.ts` exporting `defineEnv()`. | [@nudo:env](../concepts/directives.md#nudoenv--runtime-environment) |
| `@nudo:import` | `/// @nudo:import { positive } from "./shapes.nudo.js"` | File-level: bind constraint templates from a `*.nudo.js` module for use in `@nudo:contract` (named or `* as ns`). | [@nudo:import](../concepts/directives.md#nudoimport--constraint-templates) |

## Advanced directives

| Directive | Syntax | One-line semantics | Full docs |
|---|---|---|---|
| `@nudo:assume` | `@nudo:assume d <= max` (`<=` or `>=`) | Cross-variable lemma over two params / top-level locals that interval propagation cannot derive; an axiom the engine never verifies — proofs relying on it are tagged `nudo:assume-relied`. | [@nudo:assume](../concepts/directives.md#nudoassume--user-lemmas) |
| `@nudo:invariant` | `@nudo:invariant dp[*][*] >= 0` | Loop-carried bound over a param / top-level local (`[*]` and `.field` paths drill in; `>= <= > <` with a numeric constant); an axiom — tagged `nudo:invariant-relied`. | [@nudo:invariant](../concepts/directives.md#nudoinvariant--loop-invariants) |
| `@nudo:budget` | `@nudo:budget calls=50000 depth=128` (also `forks=…`) | Raise this function's evaluation budgets (defaults: calls 20,000 · depth 64 · forks 5,000); raises only — it cannot lift call **cycles** or loop truncation. | [Budgets](./performance.md) |
| `@nudo:pure` | `@nudo:pure` | Mark the function side-effect-free: the evaluator memoizes call results by argument Abs. | [@nudo:pure](../concepts/directives.md#nudopure--mark-pure-functions) |
| `@nudo:skip` | `@nudo:skip` · `@nudo:skip => number()` | Skip body evaluation: the declared type (or `any`) becomes the return; parameter contracts still gate call sites. | [@nudo:skip](../concepts/directives.md#nudoskip--skip-evaluation) |
| `@nudo:sample` | `@nudo:sample N` | Reserved no-op: parsed for compatibility, no consumer — loops are already bounded by unrolling. | [@nudo:sample](../concepts/directives.md#nudosample--loop-sampling-reserved-no-op) |
| `@nudo:as` | `// @nudo:as shape({ port: number() })` | Override the type of the next statement's value (variable initializer / return value). | [@nudo:as](../concepts/directives.md#nudoas--type-assertion) |
| `@nudo:replace` | `// @nudo:replace res.data array(number())` | Replace one sub-expression's type inside the next statement; multiple lines stack. | [@nudo:replace](../concepts/directives.md#nudoreplace--sub-expression-type-replacement) |
| `@nudo:mock-module` | `/// @nudo:mock-module "axios" from "./mocks/axios.js"` | File-level: replace an imported module with a mock file — `{ get }` after the specifier mocks only those exports. | [@nudo:mock-module](../concepts/directives.md#nudomock-module--module-level-mock) |

Also real: `@nudo:throws Error, TypeError` (or `*`) declares intentional throws and discharges L2 for the declared kinds — see the [directive reference](../concepts/directives.md#nudothrows--declare-intentional-throws).

## Constraint builders

The type-expression grammar shared by `@nudo:case` args, `@nudo:skip` / `@nudo:as` payloads, and `*.nudo.js` sidecars:

| Builder | Meaning |
|---|---|
| `number()` `string()` `boolean()` `any()` | primitive domains (`any()` = unconstrained) |
| `lit(v)` | literal domain — `lit(42)`, `lit("ada")`, `lit(true)` |
| `union(…)` / `nullable(c)` | join of members / `c` plus `null` & `undefined` |
| `shape({ … })` | object shape, fields recursive |
| `array(c)` | array element constraint |
| `fn({ x: … }, returns, { throws })` | function relation (params, return, throws option) |
| `and(…)` `partial(c)` `pick(c, keys)` `omit(c, keys)` `lazy(() => c)` | combinators (`lazy` is sidecar-only) |
| `.gt` `.ge` `.lt` `.le` `.int` `.min` `.max` `.length` `.shift` `.optional` | chained bounds — `number().gt(0).int()`, `string().min(1)` |

Full tables: [builders under @nudo:contract](../concepts/directives.md#nudocontract--source-contract) · [type expressions in Abs](../concepts/abs.md#type-expressions-in-directives).

## Next

- [Directives](../concepts/directives.md) — the full reference
- [Mocking](../concepts/mocking.md) · [nudo contract](./contract.md) · [Performance & budgets](./performance.md)
