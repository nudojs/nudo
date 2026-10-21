---
"@nudojs/service": patch
---

The analysis service finds the functions, the call sites and the evidence the
way the source describes them.

- A function declared as `export const f = () => {}` was invisible to
  `nudo test`, `nudo export` and `nudo contract`, although `nudo check` saw
  it. Every product now sees the same set of functions.
- `module.exports = { f: fn }` was invisible for the same reason.
- `export default function f() {}` was looked up under its local name, while
  an ESM default export lives under `default` — the lookup missed, the
  signature degraded to `unknown`, and a misleading `nudo:opaque-result` was
  reported.
- A call site inside an exported function body produced no `call@` case at
  all, so the call-site domain of that function was lost and the export was
  reported as entry-only. Call sites are now collected while the function
  body is evaluated.
- A case name taken from the line number in the *calling* file collided
  between two call sites, pointed at an unrelated line, and made a second
  freeze drop the new witnesses. The name now carries the file it refers to
  when the call site is elsewhere, and the emitter compares witnesses by
  identity.
- An expectation written as a predicate — `number().gt(0)` — was compared
  structurally and therefore always failed. The value is now checked against
  the predicate, and the report says so when a predicate is not satisfied.
- A `@nudo:case` on a class method was never evaluated, so the witness was
  always `unknown` and every expectation failed. Class methods are evaluated
  now.
- The value reported for a synthesized call-site witness was re-evaluated in
  the target's context and could disagree with the actual call. The
  observed value is reported now.
- A sidecar that failed to load was reported as "no contract root", which
  sends the reader to write a contract that already exists. The load failure
  is reported as `nudo:interface-load` now.
- A line-level directive (`@nudo:as`, `@nudo:replace`) inside a loop body, a
  `try` block, a `switch` case, a labeled statement, an arrow function body
  or a class method body was dropped without a word. Those positions are
  collected now, and a directive that cannot be applied anywhere is reported
  as `nudo:directive-syntax`.
- A dependency module's own `@nudo:as` / `@nudo:replace` directives were
  ignored, so the same file analyzed as a root and as a dependency got
  different types.
- A live import binding was frozen into a snapshot when the module graph was
  merged, so a change inside the dependency was invisible to the importer.
- The synthetic `entry@` cases shared one module instance, so module-level
  state leaked from one case into the next.
- A project-level path env file's *content* was not part of the analysis
  cache key, so a changed env file reused the previous result within the same
  process.
- Two functions declaring a `@nudo:mock` of the same name: the one declared
  last won the whole file, and the first function was given the wrong type.
  The mock is now chosen by scope.
- An inline `@nudo:mock` lost the fact that it can or cannot be constructed,
  so `new` on it did not throw where it should have.
- A `@nudo:mock` in its `rejects` form was modelled as returning `never`,
  which made any return contract vacuously true and wrote `f(): never` into
  the generated declaration file. It is modelled as a promise that never
  fulfills now.
- A `@nudo:pure` directive never reached the function it marked, so the
  directive did nothing.
- `nudo:builtin-unknown` reported an imported or exported alias as an
  uncovered built-in, adding a warning next to a type that had already been
  inferred exactly.
- A `--what-if` binding naming a type Nudo cannot express was silently
  widened to `any`, while the report said the binding had been applied as
  written. It degrades to `unknown` now, and the report says what was
  actually injected.
