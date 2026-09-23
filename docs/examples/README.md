# Nudo Examples

Single entry point. Grouped by scenario, independent of implementation layout.

| Directory | Scenario |
|-----------|----------|
| [`constraints/`](./constraints/) | `@nudo:refine` × Pred: scalars / shapes / return refinement |
| [`structure/`](./structure/) | Abs `leq`: assignment / argument structure |
| [`vs-ts/`](./vs-ts/) | Same logic, side by side with TypeScript |
| [`mini-repo/`](./mini-repo/) | Multi-file integration (ESM + class + async) |
| [`algebra/`](./algebra/) | Types as computation (spread / HOF / reduce / mixin) |
| [`interface-derivation/`](./interface-derivation/) | Contract tier derivation (handwritten root → generated rows) |
| [`interface-draft/`](./interface-draft/) | Code first: reviewable contract drafts from logic |
| [`migrate/`](./migrate/) | **Retire the tsc boilerplate package** (one-way before/after gate) |

Browse by theme on the website [Examples guide](https://nudojs.github.io/nudo/docs/guides/examples); this directory is the CI gate's source of truth (`pnpm run verify:examples`).

## Product command face

- **Day 0**: `pnpm run check <file>` (gate + signatures) · `pnpm run test:cli <file>` (per-case report)
- **Day 1**: `pnpm run contract` / `pnpm run nudo -- contract` · keep running `check`
- **Ecosystem**: `pnpm run export:nudo … --format dts|guard|schema|standard|all` (`--dialect zod` for schema)

## Refinement model

Contracts are not type annotations — they are **Preds entering Abs**, and they participate in algebra (`x>0` ⇒ `x+1>1`).

- Refinement comes only from **declarations** (templates exported by `.nudo.js`); an `if` branch is not a refinement
- One form: `@nudo:refine <param|return> <constraint>`; object shapes use `shape({...})` — no `interface` / `type` needed
- Template syntax, return refinement, and the contrast with `@nudo:case`: [`constraints/README.md`](./constraints/README.md) (tutorial in this directory)

## Without contracts, follow real JS

```js
function score(x) { return x + 1; }
// check signatures: score(x: any) => number | string
// score("x") is legal and returns "x1"; no shape error
```

- **`any`** = the default contract for unconstrained entry params (union of JS values; the developer refines it)
- **`unknown`** = inference failed / engine has no information (Nudo must fix it)

These are not the same thing; the CLI **never** prints unconstrained entry params as `unknown`.
Dangerous operations on entry `any` may surface as L2 `nudo:entry-may-throw` (error by default).

## How to run

The **single source of truth** for every example command and its expected exit code is the matrix below; one command verifies all of it:
`pnpm run verify:examples` (CI gate, see `scripts/verify-examples.sh`).

- **Commands and exit codes**: edit the matrix only — the gate parses commands × exit
  codes from this table, so adding/removing an example or changing a promised exit
  code means editing this one table and the script follows.
- **Two-way file cross-check**: the script cross-checks matrix ↔ disk — every row's
  target file must exist (a typo'd path on a negative-example row would otherwise pass
  as exit 1), and every runnable `.js` / `.ts` under `docs/examples` must appear in at
  least one row (`*.nudo.js` templates are excluded — they are pulled in via
  `@nudo:import`; `*.d.ts` are declarations produced by `export --format dts`, also
  excluded). The target is the first whitespace-separated token after `docs/examples/`
  in the command; CLI options (e.g. `--assume "x>0"`) follow it.
  Adding an example file = adding a matrix row, or CI goes red.
- **Output promises**: output lines promised by example file headers and subdirectory
  READMEs are pinned line by line (fixed-string match, the script's `pins` section —
  `pin` for command stdout; `export --format dts` prints declarations to stdout and only
  writes files with `--out <dir>`, where `pin_file` applies). When engine precision
  changes an output, CI goes red — update the example file comments/READMEs and the
  script pins together.

The single-line commands in each subdirectory README and example file header are local hints only.

| Command | Exit | Notes |
|---------|------|-------|
| `pnpm run check docs/examples/constraints/set-delay.js` | **1** | Negative: `setDelay[ms]: argument ⊭ precondition` / `needsPositive[x]: argument ⊭ precondition` |
| `pnpm run check docs/examples/constraints/register.js` | **0** | Positive: user / config shape refinement (signatures pinned) |
| `pnpm run check docs/examples/constraints/return-contract.js` | **1** | Negative: `bad: return value ⊭ @nudo:refine return positive` |
| `pnpm run check docs/examples/constraints/declared-vs-if.js` | **1** | Negative: `if` ≠ refinement |
| `pnpm run check docs/examples/constraints/add-pred.js` | **1** | Negative: `scale[x]: argument ⊭ precondition` (`actual: -1 #exact`) |
| `pnpm run test:cli docs/examples/constraints/add-pred.js` | **0** | Pred flows into algebra (test case report, positive) |
| `pnpm run check docs/examples/structure/assign.js` | **1** | Negative: `config: assignment ⊭ existing shape` (missing port) |
| `pnpm run check docs/examples/structure/arg-structure.js` | **1** | Negative: shape contract missing field (`constraint-violated`, not a body scan) |
| `pnpm run check docs/examples/vs-ts/constraints/nudo.js` | **1** | Nudo reports; tsc does not |
| `pnpm exec tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts` | **0** | tsc side of the contrast (clean) |
| `pnpm run check docs/examples/vs-ts/structure/nudo.js` | **1** | Nudo reports (contract missing name / assignment missing port) |
| `pnpm exec tsc --noEmit --strict docs/examples/vs-ts/structure/tsc.ts` | **2** | tsc reports 3 sites (missing name / excess / missing port) |
| `pnpm run check docs/examples/algebra/0-add-intensional.js` | **0** | Signatures (check; term/pred/conf need `--verbose`/`--abs`) |
| `pnpm run test:cli docs/examples/algebra/0-add-intensional.js` | **0** | Literal cases (`call@` / `debug`) |
| `pnpm run check docs/examples/algebra/0-add-intensional.js --abs --assume "x>0"` | **0** | Algebra view (term/pred/conf, `--assume`) |
| `pnpm run test:cli docs/examples/algebra/a-spread-optional.js` | **0** | Spread config object |
| `pnpm run export:nudo docs/examples/algebra/a-spread-optional.js --format dts` | **0** | dts projection: one widened signature + literal union (signature pinned on stdout) |
| `pnpm run test:cli docs/examples/algebra/b-hof-map.js` | **0** | HOF callback propagation |
| `pnpm run test:cli docs/examples/algebra/c-reduce-sum.js` | **0** | reduce single-pass accumulation |
| `pnpm run test:cli docs/examples/algebra/d-mixin-meet.js` | **0** | Spread shape meet |
| `pnpm run test:cli docs/examples/algebra/e-index-proj.js` | **0** | Index projection (literal exact / dynamic keys unioned) |
| `pnpm run test:cli docs/examples/algebra/f-async-eff.js` | **0** | async × `@nudo:mock` |
| `pnpm run test:cli docs/examples/algebra/g-narrow-subtract.js` | **0** | Guard narrowing |
| `pnpm run test:cli docs/examples/algebra/h-array-boundary.js` | **0** | Array method precision boundary (reduce / forEach / some all exact) |
| `pnpm run test:cli docs/examples/algebra/i-map-set.js` | **0** | Map / Set literal entry tracking (get lookup / for-of elements) |
| `pnpm run test:cli docs/examples/algebra/j-this-binding.js` | **0** | `this` binding: member-call receiver injection exact (`compute(5)` → `25`) |
| `pnpm run test:cli docs/examples/algebra/k-try-catch.js` | **0** | try/catch: deterministic return fold / catch param bound to Error.message |
| `pnpm run test:cli docs/examples/algebra/l-primitive-conversion.js` | **0** | Primitive wrapper construction (String / Number / Boolean / parseInt / parseFloat literal folds) |
| `pnpm run test:cli docs/examples/algebra/sample.js` | **0** | No call sites → `entry@`; params display as **`any`** |
| `pnpm run check docs/examples/mini-repo/user-service.js` | **1** | Multi-file integration (check) — L2: unconstrained array arg to `sumAges` reports `entry-may-throw` |
| `pnpm run test:cli docs/examples/mini-repo/user-service.js` | **0** | Multi-file integration (test case report) |
| `pnpm run check docs/examples/mini-repo/validators.js` | **0** | Support-file signatures: unconstrained entry params = any |
| `pnpm run test:cli docs/examples/mini-repo/validators.js` | **0** | Support file on its own: `entry@` signatures (any) |
| `pnpm run test:cli docs/examples/mini-repo/store.js` | **0** | Class methods enumerated by the analyzer: no call sites → `entry@` |
| `pnpm run check docs/examples/interface-derivation/lib.js` | **0** | Root contract (handwritten `lib.nudo.js` add4) loads |
| `pnpm run check docs/examples/interface-derivation/add.js` | **0** | Downstream derived contract (`add.nudo.js` generated) enforces |
| `pnpm run contract --draft docs/examples/interface-draft/greet.js` | **0** | Code-first draft: callsite projection + body-read suggestions (no invented check obligations) |
| `pnpm run check docs/examples/l2-export-any.js` | **1** | L2: export `any` member access → `nudo:entry-may-throw` |
| `pnpm run check docs/examples/l2-export-any.js --ignore-throws TypeError` | **0** | L2 migration switch: ignoring TypeError stops gating exit |
| `pnpm run nudo -- migrate status docs/examples/migrate/before/package.json` | **0** | migrate status: audit typescript deps / tsc scripts / `.ts` count |
| `pnpm run nudo -- migrate strip docs/examples/migrate/before/src/math.ts` | **0** | migrate strip dry-run: `.ts` → `.js` (writes nothing) |
| `pnpm run nudo -- migrate strip docs/examples/migrate/before/src/cart.ts` | **0** | migrate strip dry-run: cross-file cart (`type Item` stripped) |
| `pnpm run check docs/examples/migrate/after/src/math.js` | **0** | Post-retire gate: math signatures |
| `pnpm run check docs/examples/migrate/after/src/cart.js` | **0** | Post-retire gate: cart across files |
| `pnpm run nudo -- migrate verify docs/examples/migrate/after/src/math.js` | **0** | migrate verify: `nudo check` passes |
| `pnpm run nudo -- migrate retire docs/examples/migrate/before/package.json --dry-run` | **0** | migrate retire dry-run: drop typescript / tsc → nudo check (writes nothing) |
| `pnpm run nudo -- contract --from-dts docs/examples/migrate/before/src/math.ts` | **0** | dts/TS → contract draft (`@nudo:draft`, not enforced until confirmed) |

> Negative-example files (check on constraints / structure / vs-ts) **exit non-zero on purpose** — the reported lines are what they demonstrate.
