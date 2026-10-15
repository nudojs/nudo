---
description: "Syntax reference for all @nudo: directives — case, mock, pure, skip, sample, contract, assume, invariant, throws, import, env, mock-module, as, replace — with constraints and examples."
---

# Directives

Directives are structured comments that control how Nudo analyzes your code. They use the `@nudo:` namespace to avoid conflicts with JSDoc and other tools. Place directives in block comments immediately above the function they apply to.

The **contract product** (refinement obligations) lives primarily in sidecar files — `*.nudo.js` modules auto-bound to same-name exports of your source file — with `@nudo:contract` as the in-source form. See [@nudo:contract](#nudocontract--source-contract) and the [`nudo contract`](../guides/contract.md) command.

## Directive Syntax

All directives live in the `@nudo:` namespace and are written as structured comments:

```javascript
/**
 * @nudo:case "name" (arg1, arg2)
 * @nudo:mock fetch = ...
 */
function myFunction(a, b) {
  // ...
}
```

Multiple directives can appear in the same comment block. The parser extracts them before the engine runs.

Function-scoped directives (`@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`) are also accepted in single-line `// @nudo:…` comments placed directly above the function:

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
// @nudo:case "user" (1)
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

Both forms are parsed identically — in particular, the single-line rule for mock expressions applies to both (see [@nudo:mock](./mocking.md)). Prefer the block form when a `//`-prefixed directive could read as commented-out code.

---

## @nudo:case — Debug Witnesses {#nudocase--debug-witnesses}

Cases are **debug witnesses**: concrete inputs Nudo executes the function with for scenario runs. They are **not** the contract product — obligations live in `*.nudo.js` sidecars / `@nudo:contract` (see [@nudo:contract](#nudocontract--source-contract)). `@nudo:case` remains supported for optional `nudo test` assertions and LSP scenario switching. Cases use concrete arguments or constraint builders.

Provide named execution cases. Each case defines inputs (concrete or symbolic) for Nudo to run the function with.

### Syntax

```text
@nudo:case "name" (arg1, arg2, ...)
@nudo:case "name" (arg1, arg2) => expectedType
```

- **name** — A string identifier for the case (e.g. `"double digits"`).
- **args** — Comma-separated **concrete** arguments (`5`, `"hello"`, `{…}`) or constraint-builder expressions.
- **expected** (optional) — After `=>`, a type expression (a concrete literal or a constraint builder, same grammar as args) asserted against the inferred result by `nudo test`.

### Examples

```javascript verify
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 */
function subtract(a, b) {
  return a - b;
}
```

```javascript verify
/**
 * @nudo:case "strings" ("hello")
 * @nudo:case "numbers" (42)
 * @nudo:case "array" ([1, 2, 3])
 */
function process(x) {
  if (typeof x === "string") return x.length;
  if (typeof x === "number") return x * 2;
  return x.length;
}
```

With expected return type:

```javascript verify
/**
 * @nudo:case "basic" ("abc") => number()
 * @nudo:case "empty" ("") => lit(0)
 */
function len(s) {
  return s.length;
}
```

---

## @nudo:mock — Mock External Dependencies

Replace external dependencies with mocks during evaluation — `fetch`, file system APIs, or other code Nudo cannot execute directly. Full syntax (five forms), the single-line rule, evaluator caveats, and worked examples: [Mocking External Dependencies](./mocking.md).

---

## @nudo:pure — Mark Pure Functions

Mark a function as pure. The Abs `fn` value carries a pure marker and the evaluator **memoizes call results by argument Abs** (same args → cached result). Declare it only for side-effect-free functions; analysis results stay correct with or without the directive.

### Syntax

```text
@nudo:pure
```

### Example

```javascript verify
/**
 * @nudo:pure
 * @nudo:case "add" (number(), number())
 */
function add(a, b) {
  return a + b;
}
```

---

## @nudo:skip — Skip Evaluation

Skip abstract interpretation of the function body: the engine does not evaluate it, so a skipped function never produces engine-debt (`nudo:unknown-inference`) noise. Without a return type expression the function is reported as `skipped (no return type declared)` and `nudo check` prints its return as `any` (unconstrained — not `unknown`, which is reserved for inference failure); add a constraint-builder expression after the directive to declare one.

### Syntax

```text
@nudo:skip
@nudo:skip => returnsExpr
@nudo:skip (returnsExpr)
```

- **returnsExpr** (optional) — A constraint-builder / concrete expression used as the return type. Must be written as `=> expr` or fully wrapped in `(…)`; bare prose after `@nudo:skip` is ignored (it is not a type).

### Scope

- **No body evaluation.** The declared type (or `any`) becomes the signature return; entry may-throw (L2) is not evaluated for a skipped body.
- **Parameter obligations stay.** `@nudo:contract` preconditions still gate call sites, and the parameter display still comes from the handwritten contract — `nudo check` reports `needsPositive(x: number) => any` for a skipped `needsPositive` with `@nudo:contract x positive`.
- **Return contracts still checked.** `@nudo:skip => lit(0)` under `@nudo:contract return positive` reports `nudo:constraint-violated`.

### Examples

```javascript verify
/**
 * @nudo:skip
 */
function heavyComputation(data) {
  // Complex algorithm Nudo should not evaluate
  return processData(data);
}
```

**Inferred output (`nudo test`):**

```text
=== heavyComputation ===
  skipped (no return type declared)
```

```javascript verify
/**
 * @nudo:skip => number()
 */
function unannotatedHeavy(x) {
  // Explicit return type via the directive
  return expensiveOp(x);
}
```

**Inferred output (`nudo test`):**

```text
=== unannotatedHeavy ===
  skipped (declared): number
```

---

## @nudo:sample — Loop Sampling (Reserved, No-Op)

`@nudo:sample` is **parsed but has no consumer** — the analyzer discards it (`void sampleDirective` in `service/src/analyzer.ts`). It does not change loop evaluation: loops already terminate via bounded unrolling (`DEFAULT_MAX_LOOP_ITERS = 8`), so there is no fixed-point phase to switch into. The directive is accepted for source compatibility but has no effect on output; do not rely on it to trade precision for performance.

### Syntax

```text
@nudo:sample N
```

- **N** — A positive integer. Ignored at analysis time.

---

## @nudo:contract — Source Contract {#nudocontract--source-contract}

Attach a refinement contract to a parameter or the return value. The constraint enters Abs as a Pred and **participates in algebra** (`x>0` ⇒ `x+1>1`) — it is not just a call-site gate.

The **product name** is **contract** (sidecar `*.nudo.js` / `@nudo:contract`); some diagnostic codes still carry the historical `interface` token (`nudo:interface-param-mismatch`, …).

### Main path: sidecar auto-binding

The recommended form writes contracts in a sidecar file next to the source: `<file>.nudo.js` (for `.js`/`.mjs`) or `<file>.nudo.ts` (for `.ts`/`.mts`). Every `export const <name> = fn({ ... }, ...)` **auto-binds** to the same-name local named export of the source file — the source needs no annotation at all:

```javascript
// calc.js
export function addTax(x) {
  return x + 1;
}

export function greet(name) {
  return name;
}
```

```javascript
// std.nudo.js — shared constraint templates
import { number } from "@nudojs/core";

export const positive = number().gt(0);
```

```javascript
// calc.nudo.js — sidecar contracts
import { fn, lit, number, string, union } from "@nudojs/core";
import { positive } from "./std.nudo.js";

export const addTax = fn({ x: positive.shift(1) }, number());
export const greet = fn({ name: union(lit("ada"), lit("bob")) }, string());
```

```bash
$ nudo contract calc.js
calc.js
  addTax  [handwritten]  (x: number().gt(1)) → number()
  greet  [handwritten]  (name: union(lit("ada"), lit("bob"))) → string()
```

Sidecars are real JS modules: they may import builders from `@nudojs/core` and constraints from **other sidecars** via relative imports. Loading failures, import cycles, and unrecognized export forms are **errors** (`nudo:interface-load`, `nudo:interface-cycle`) instead of silent fallbacks.

**Builders** (`@nudojs/core`, also injectable bare):

| Builder | Meaning | Example |
|---------|---------|---------|
| `number()` / `string()` / `boolean()` | primitive domain | `number()` |
| `shape({ id: number() })` | object shape (fields recursive) | `shape({ id: number().gt(0) })` |
| `array(c)` | array element constraint | `array(string())` |
| `lit(v)` | literal domain | `lit(42)` / `lit("ada")` / `lit(true)` |
| `union(...cs)` | join of domains | `union(lit(42), lit("a"))` |
| `fn(params, returns?, { throws? })` | first-class function interface | `fn({ x: number() }, number())` |
| `.gt(n)` `.ge(n)` `.lt(n)` `.le(n)` `.int()` | numeric bounds (chained) | `number().gt(0).int()` |
| `.min(n)` `.max(n)` | length bounds — `length(s)` pred (strings/arrays) | `string().min(1)` |
| `.length(n)` | length equality bound (`length(s) = n`) | `string().length(3)` |
| `.shift(n)` | translate every constant bound by `+n` | `positive.shift(1)` |
| `and(...cs)` | scalar conjunction (top-level function, not a chained method) | `and(positive, number().lt(10))` |
| `partial(c)` / `pick(c, keys)` / `omit(c, keys)` | shape utilities | `partial(user)` |
| `lazy(() => c)` | self-referential template (sidecars only — directive grammar has no arrow functions) | `shape({ object: lazy(() => node).optional() })` |

`shift` is legal only on numeric scalar chains (every bound's right side is a literal); anything else throws. `partial`/`pick`/`omit` accept `shape(...)` constraints.

**Auto-binding rules:**

- Binds only **same-name local named exports** of the source file (`export function` / `export const`). Re-exports, `export default`, and CJS are out of scope.
- Inside `fn({ ... })`, keys bind by parameter name: plain identifiers, destructured binding names, or **dot-path keys** for nested destructuring. The outer key of a nested pattern stays bindable as a whole-object `shape(...)`; array elements have no path form. Flat names always win over a dotted key that would spell the same string.

```javascript
// v.js
export function nested({ card: { grade } }) {
  return grade + "#";
}
```

```javascript
// v.nudo.js — 'card.grade' binds the inner field; 'card' binds the whole object
import { fn, string } from "@nudojs/core";

export const nested = fn({ "card.grade": string() }, string());
```

- Sidecars under `node_modules/` are never auto-loaded.
- Same-parameter annotations from source and sidecar are **conjoined**; a contradictory conjunction (e.g. `x > 0` ∧ `x < 0`) reports `nudo:interface-conflict`.
- A sidecar binding wins over nothing else — merge order is: handwritten (source annotation ∪ sidecar binding) > generated segment > implicit inference. The layer is shown by `nudo contract` (`[handwritten]` / `[generated]` / `[implicit]`).

### In-source form

```text
@nudo:contract <param> <constraint>
@nudo:contract return <constraint>
```

- **param** — Parameter name, or the literal `return` for the postcondition
- **constraint** — Name exported from a `*.nudo.js` module, imported via `/// @nudo:import`

### Examples

```javascript
/// @nudo:import { positive, delay } from "./shapes.nudo.js"

/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function inc(x) {
  return x + 1;
}

/**
 * @nudo:contract ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

setDelay(0);   // error: 0 ⊭ delay
setDelay(100); // ok
```

Object shapes without `interface`:

```javascript
// shapes.nudo.js
export const user = shape({
  id: number().gt(0),
  name: string(),
});

/**
 * @nudo:contract u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}
```

---

## @nudo:assume — User Lemmas {#nudoassume--user-lemmas}

Declare a **cross-variable lemma** the engine cannot derive — an algorithmic fact relating two parameters or top-level locals (edit distance ≤ the longer string's length) that plain interval propagation cannot express, because it needs a correlation between two abstract values. The premise feeds relational division folding — `d <= max ∧ max > 0 ⇒ d/max <= 1` (mirrors and negative denominators flip the inequality) — and downstream `+` / `-` / `*` folding consumes the derived bound, so return contracts like `1 - d/max ∈ [0,1]` become provable.

### Syntax

```text
@nudo:assume <name> <= <name>
@nudo:assume <name> >= <name>
```

- **Function-scoped** — the comment block immediately above the function, on the same scan path as `@nudo:contract`; it anchors to the nearest function.
- Both names must be **parameters of the anchored function or top-level `const`/`let`/`var` locals of its body** (`d`, `max`) — plain `Identifier` declarators among the body's direct statements; destructuring, nested blocks, and `for`-init declarations are not accepted. Otherwise error `nudo:assume-invalid`.
- Locals follow **SSA semantics** — the lemma anchors to the bound value at its definition point and applies from definition to the end of the scope; after a reassignment the relevance conservatively lapses (no fold).
- Anchoring activates only in the target function's own frame — callee frames see an empty premise slot, so same-name locals there cannot mismatch.
- Only `<=` / `>=` (`>=` is normalized to `le`). `<`, `>`, `==`, and constant bounds (`d <= 10`) are invalid — constant bounds belong to sidecar contracts (`number().le(10)`).
- Constant bounds still belong to sidecars — but a sidecar cannot reach a function's own locals: put a local's constant bound on the **return of the callee that produces it** (e.g. a levenshtein sidecar `return number().ge(0)`).
- Multiple lines stack — premises are conjoined.

### Semantics — an axiom, not a checked fact

- **The engine never verifies the lemma.** When a proof relies on it, `nudo check` emits info `nudo:assume-relied` (`sim: return contract proved via @nudo:assume d <= max`) and suggests falsifying it with concrete `@nudo:case` runs (`nudo test`). A wrong lemma makes the affected proof unsound — keep lemmas few and reviewable.
- **Premises never cross call boundaries.** Callee frames see an empty premise slot (cleared at function entry, restored on exit); recursive calls are conservatively cleared. A lemma about `sim`'s `d`/`max` cannot leak into another function's same-name parameters. While premises are active, contract-face adoption is also skipped: an info-free argument is not re-anchored to the callee's parameter names, so fabricated same-name terms cannot flow back into the caller frame and masquerade as the lemma's variables (a `helper(d)` call inside `sim` would otherwise let `helper`'s own `d` collide with the lemma's `d`).

### Example — similarity score

```javascript
// sim.js
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
```

```javascript
// sim.nudo.js
import { fn, number } from "@nudojs/core";

export const sim = fn(
  { d: number().ge(0), max: number().ge(1) },
  number().ge(0).le(1),
);
```

```text
$ nudo check sim.js
OK
  0 error · 0 warning · 1 info · 1 fn

signatures
  sim(d: number, max: number) => number

issues
  [INFO sim] sim: return contract proved via @nudo:assume d <= max  (nudo:assume-relied)
      → @nudo:assume is a user-supplied axiom — falsify it with concrete @nudo:case runs (nudo test)
```

Remove the `@nudo:assume` line and the same file + sidecar stays **honestly unproven** — warning `nudo:unproven-return`:

```text
[WARNING sim] sim: return value ⊭ @nudo:contract return number().ge(0).le(1)  (nudo:unproven-return)
```

Interval propagation knows `d >= 0` and `max >= 1` separately, but nothing correlates the two values — that correlation is exactly what the lemma supplies.

### Example — locals as lemma names

Lemma names may also be top-level locals of the anchored function's body:

```javascript
// sim.js
/**
 * @nudo:assume d <= max
 */
export function sim(a, b) {
  const d = rawDist(a, b);   // edit distance
  const max = maxLen(a, b);  // longer string's length
  return 1 - d / max;
}
```

`d` and `max` are top-level `const` locals — each anchors at its definition (SSA semantics) and stays lemma-relevant to the end of the scope. Their **constant** bounds come from the producing callees' sidecars, because the enclosing function's sidecar cannot reach its locals:

```javascript
// rawDist.nudo.js / maxLen.nudo.js
import { fn, number, string } from "@nudojs/core";

export const rawDist = fn({ a: string(), b: string() }, number().ge(0));
export const maxLen = fn({ a: string(), b: string() }, number().ge(1));
```

With `d >= 0` (rawDist), `max >= 1` (maxLen), and the lemma `d <= max`, the `1 - d/max ∈ [0,1]` return contract folds — same proof shape as the parameter version (sim's own sidecar carries `number().ge(0).le(1)` as usual).

### Division of labor with sidecar contracts

| Fact | Belongs to |
|------|-----------|
| Constant bound — `d <= 10`, `max >= 1` | Sidecar / `@nudo:contract` builders (`number().le(10)`) |
| Cross-variable lemma — `d <= max` | `@nudo:assume` (the engine cannot derive it) |
| Loop-carried bound — `dp[*][*] >= 0` | `@nudo:invariant` (loop joins/widening lose interval evidence) |

`.le("max")` used to be accepted silently, building a **string-literal** predicate (`le(self, lit("max"))`) that never participated in any proof. Numeric-bound builders (`gt` / `ge` / `lt` / `le` / `min` / `max` / `shift`) now reject non-numeric, non-finite arguments at load time — the sidecar fails with `nudo:interface-load`:

```text
sidecar './sim.nudo.js' failed to load: nudo le(): finite numeric bound expected, got "max" — variable references are not supported; express cross-variable lemmas with @nudo:assume (issue #152)
```

Migrate such sidecars to `@nudo:assume`.

---

## @nudo:invariant — Loop Invariants {#nudoinvariant--loop-invariants}

Declare a **loop-carried bound** the engine cannot re-derive — the loop-analogue of [`@nudo:assume`](#nudoassume--user-lemmas). Loop joins and widening keep the value domain (`number`) but lose interval evidence: even `let last = 0; for (let j = 1; j <= n; j++) last = j; return last` cannot prove `last >= 1` (deriving loop invariants automatically is research-grade — Nudo does not attempt it). The directive lets the user supply the invariant; the engine strengthens the bound at loop join / widening points.

### Syntax

```text
@nudo:invariant <name><path> <rel> <number>
@nudo:invariant dp[*][*] >= 0
@nudo:invariant last >= 1
```

- **Function-scoped** — the comment block immediately above the function, same scan path as `@nudo:contract` / `@nudo:assume`; multiple lines stack.
- `<name>` must be a **parameter of the anchored function or a top-level `const`/`let`/`var` local of its body**; otherwise warning `nudo:invariant-invalid`.
- `<path>` drills into the binding: `[*]` steps into array elements / tuple members / union numeric arms; `.ident` steps into an object slot. An empty path means the scalar itself. Non-numeric leaves (strings, objects) and structural mismatches are skipped silently — a wrong-direction invariant surfaces as a proof failure, not a report.
- `<rel>` is `>=` / `<=` / `>` / `<` with a **numeric constant** (`==`, `!=`, non-numeric bounds are invalid → `nudo:invariant-invalid`).
- Strengthened leaves carry a fresh symbolic term with the declared pred (conf `path`); literal leaves are left untouched — a concrete value already has its truth.

### Semantics — an axiom, not a checked fact

- **The engine never verifies the invariant.** When a proof relies on it, `nudo check` emits info `nudo:invariant-relied` (`levenshtein: return contract proved via @nudo:invariant dp[*][*] >= 0`) and suggests falsifying it with concrete `@nudo:case` runs (`nudo test`). A wrong invariant makes the affected proof unsound — keep invariants few and reviewable.
- **Invariants never cross call boundaries.** Callee frames see an empty invariant slot (cleared at function entry, restored on exit) — a lemma about the caller's `dp` cannot leak into a callee's same-name local.
- What the invariant does **not** fix: out-of-bounds read facts stay honest. An abstract-index read `dp[m][n]` still joins a synthetic `undefined`; the `if (out === undefined) return 0` guard narrows it before the return contract sees it.

### Example — edit distance

```javascript
// levenshtein.js
/**
 * @nudo:invariant dp[*][*] >= 0
 */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
                          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const out = dp[m][n];
  if (out === undefined) return 0;
  return out;
}
```

```javascript
// levenshtein.nudo.js
import { fn, number, string } from "@nudojs/core";

export const levenshtein = fn(
  { a: string(), b: string() },
  number().ge(0),
);
```

```text
$ nudo check levenshtein.js
OK
  0 error · 0 warning · 1 info · 1 fn

signatures
  levenshtein(a: string, b: string) => 0 | number

issues
  [INFO levenshtein] levenshtein: return contract proved via @nudo:invariant dp[*][*] >= 0  (nudo:invariant-relied)
      → @nudo:invariant is a user-supplied axiom — falsify it with concrete @nudo:case runs (nudo test)
```

Remove the `@nudo:invariant` line and the same file + sidecar stays **honestly unproven** — warning `nudo:unproven-return` (the abstract `dp[m][n]` read joins a synthetic out-of-bounds `undefined`; the guard narrows it, but no bound survives widening to prove `ge(0)`).

---

## @nudo:throws — Declare Intentional Throws {#nudothrows--declare-intentional-throws}

Declare that a function **intentionally throws**. L2 (`nudo:entry-may-throw`) requires entry/export functions to be total — instead of hiding a fail-fast, declare it. The declaration discharges L2 for the declared kinds only; the throw stays visible on the signature (declared, not removed).

### Syntax

```text
@nudo:throws Error
@nudo:throws Error, TypeError
@nudo:throws *
```

- **kinds** — Comma-separated constructor names (spaces or `|` also separate). Declaring `Error` covers the whole Error family (`TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `URIError`, `EvalError`, `AggregateError`) — `instanceof Error` semantics; a specific kind covers only itself.
- **`*`** — Declares any throw; L2 is fully discharged.
- Undeclared kinds still report — a declaration is precise, not a blanket ignore.

The directive is function-scoped: it lives in the comment block immediately above the function, on the same scan path as `@nudo:contract`. Two other forms declare the same thing:

- `@nudo:case "name" (args) !! throws` — a case-suffix declaration; bare `!! throws` declares any throw, `!! throws Error` declares by kind (`@nudo:case` stays debug-only).
- Sidecar option — `fn(params, returns, { throws: "Error" })` on a same-name `*.nudo.js` binding.

Declaring is not `--ignore-throws`: a declaration says "this fail-fast is intentional" and is honored per-kind; `--ignore-throws` is a migration-period blanket pass. When both are present, the declaration is applied first.

### Example

```javascript
/**
 * @nudo:throws RangeError
 */
export function clampPercent(n) {
  if (n < 0 || n > 100) throw new RangeError("n must be within 0..100");
  return n;
}
```

**Inferred output (`nudo check`):**

```text
nudo check  clamp.js
OK
  0 error · 0 warning · 0 info · 1 fn

signatures
  clampPercent(n: any) => any  throws RangeError

(no issues)
```

Without the declaration, the same function fails L2 — the `throw RangeError` is undigested:

```text
nudo check  clamp.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  clampPercent(n: any) => any  throws RangeError

issues
  [ERROR L1 clampPercent] clampPercent (export): may throw RangeError  (nudo:entry-may-throw)
      actual:   clampPercent(n: any) => any    throws RangeError
      expected: entry total, or @nudo:throws / try-catch
      → throw RangeError → @nudo:throws RangeError / refine / guard / try-catch
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)

docs
  nudo:entry-may-throw → https://nudojs.github.io/nudo/docs/reference/diagnostics#nudo-entry-may-throw
```

`L1` in the issue header is the **line number**, not a contract layer — the diagnostic's layer is L2. For L2 semantics and the other discharge paths (refine narrowing, `try`/`catch` digestion, `--ignore-throws`), see [L2 — entry throws](../guides/check.md#l2--entry-throws).

---

## @nudo:import — Constraint Templates

Import constraint templates from a `*.nudo.js` module for use with `@nudo:contract`. This is a **file-level** directive using triple-slash comments.

### Syntax

```text
/// @nudo:import { name1, name2 } from "./shapes.nudo.js"
/// @nudo:import * as ns from "./shapes.nudo.js"
```

- **named** — bind exported template names used by `@nudo:contract`
- **namespace** — `@nudo:import * as ns from "…"` expands to `ns.exportName` refs in `@nudo:contract`

### Example

```javascript
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract x positive
 */
function inc(x) {
  return x + 1;
}
```

---

## @nudo:env — Runtime Environment

Declare which runtime environment APIs are available in the file. This is a **file-level** directive using triple-slash comments at the top of the file. Nudo provides built-in type definitions for common environments so you don't need to write manual mocks for standard APIs.

### Syntax

```text
/// @nudo:env name1, name2, ...
```

- **names** — Comma-separated environment names. Built-in environments: `es`, `web`, `node`.
- `web` and `node` automatically include `es`.
- Instead of a built-in name, you can point at a TypeScript file: `/// @nudo:env ./nudo-env.ts`. The file must export a `defineEnv()` function returning `{ globals, modules? }` type definitions (the same shape Nudo's built-in environments use).

### Supported Environments

| Name | Provides |
|------|----------|
| `es` | `JSON`, `Math`, `Number`, `Array`, `console`, `Promise`, `Date`, error constructors, etc. |
| `web` | `fetch`, `Request`, `Response`, `URL`, `localStorage`, `document`, `navigator`, `crypto`, `performance`, timers, etc. |
| `node` | `process`, `Buffer`, `__dirname`, `__filename`, timers, and modules: `fs`, `path`, `os`, `crypto`, `url`, `child_process`, `util` |

### Examples

```javascript
/// @nudo:env web

/**
 * @nudo:case "test" (number())
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

```javascript
/// @nudo:env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @nudo:case "test" (string())
 */
function loadConfig(dir) {
  const content = readFileSync(join(dir, "config.json"), "utf-8");
  return JSON.parse(content);
}
```

### Project-Level Configuration

You can also set environments in `package.json` so every file in the project uses them:

```json
{
  "nudo": {
    "env": ["node"]
  }
}
```

File-level `@nudo:env` directives are merged with project-level settings (union of all environment names).

---

## @nudo:mock-module — Module-Level Mock

Replace or partially replace an imported module with a custom mock file. This is a **file-level** directive using triple-slash comments.

### Syntax

**Full replacement:**

```text
/// @nudo:mock-module "original-module" from "./mock-file.js"
```

**Partial replacement (only specified exports):**

```text
/// @nudo:mock-module "original-module" { export1, export2 } from "./mock-file.js"
```

- **original-module** — The module specifier to intercept (e.g. `"lodash"`, `"node:fs"`).
- **exports** (optional) — Specific named exports to replace. Unspecified exports fall through to the original module.
- **mock-file** — Path to the file providing mock implementations.

### Examples

```javascript
/// @nudo:mock-module "axios" from "./mocks/axios.js"

import axios from "axios";

/**
 * @nudo:case "test" ()
 */
async function getUsers() {
  const res = await axios.get("/api/users");
  return res.data;
}
```

```javascript
/// @nudo:mock-module "lodash" { debounce } from "./mocks/lodash-debounce.js"

import { debounce, throttle } from "lodash";
// debounce comes from the mock; throttle resolves normally
```

Module mocks are declared per file with `@nudo:mock-module` — there is no project-level mock configuration.

---

## @nudo:as — Type Assertion

Override the type of the next statement's value. Similar to TypeScript's `as` keyword, but placed as a line comment above the statement. Applied on the eval path to `VariableDeclaration` initializers and `ReturnStatement` values of the covered statement.

### Syntax

```text
// @nudo:as typeValueExpr
```

### Examples

```javascript
// @nudo:as shape({ port: number(), host: string() })
const config = JSON.parse(content);
// config is now { port: number, host: string } instead of unknown
```

```javascript
// @nudo:as array(shape({ id: number(), name: string() }))
return JSON.parse(response);
```

---

## @nudo:replace — Sub-Expression Type Replacement

Replace a specific sub-expression's type within the next statement. The target expression is matched by source text against AST nodes, so it won't match partial identifiers or string contents.

### Syntax

```text
// @nudo:replace targetExpr typeValueExpr
```

- **targetExpr** — The source text of the expression to replace (e.g. `a`, `res.data`, `JSON.parse(input)`).
- **typeValueExpr** — The type value to use instead.

### Examples

```javascript
// @nudo:replace a number()
const x = a + b;
// only `a` is replaced; `b` evaluates normally
```

```javascript
// @nudo:replace res.data array(shape({ id: number() }))
const items = res.data;
```

```javascript
// @nudo:replace JSON.parse(input) shape({ name: string() })
const data = JSON.parse(input);
```

Multiple replacements can be stacked:

```javascript
// @nudo:replace a number()
// @nudo:replace b string()
const result = a + b;
```

**Note:** Each `@nudo:replace` only affects the immediately following statement.

---

## Summary Table

| Directive | Syntax | Purpose |
|-----------|--------|---------|
| `@nudo:case` | `"name" (args...)` or `"name" (args) => type` | Debug / `nudo test` witnesses (not the contract product) |
| `@nudo:mock` | `name = expr` or `name from "path"` | Mock external dependencies |
| `@nudo:pure` | (no args) | Mark function pure — evaluator memoizes call results by args |
| `@nudo:skip` | `[=> returnsExpr]` / `[(returnsExpr)]` | Skip evaluation, use existing type info |
| `@nudo:sample` | `N` | Reserved no-op (parsed, not consumed) |
| `@nudo:contract` | `param constraint` / `return constraint` | In-source contract (main path is the `*.nudo.js` sidecar auto-binding) |
| `@nudo:assume` | `<name> <= <name>` (or `>=`) | Declare a cross-variable user lemma over params or top-level locals (axiom, never verified) — proofs relying on it are audit-tagged `nudo:assume-relied` |
| `@nudo:invariant` | `<name><path> <rel> <number>` (e.g. `dp[*][*] >= 0`) | Declare a loop-carried bound over params or top-level locals, drilling by path (axiom, never verified) — proofs relying on it are audit-tagged `nudo:invariant-relied` |
| `@nudo:throws` | `Error, TypeError` or `*` | Declare intentional throws — discharges L2 `nudo:entry-may-throw` for the declared kinds |
| `@nudo:import` | `{ name } from "spec"` (file-level `///`) | Import `*.nudo.js` constraint templates for `@nudo:contract` |
| `@nudo:env` | `name1, name2` (file-level `///`) | Declare runtime environment APIs |
| `@nudo:mock-module` | `"module" from "path"` (file-level `///`) | Replace imported modules with mocks |
| `@nudo:as` | `typeValueExpr` (line comment `//`) | Override next statement's value type |
| `@nudo:replace` | `targetExpr typeValueExpr` (line comment `//`) | Replace sub-expression type in next statement |

## Next

- [Abs](./abs.md) — type expressions used in directives
- [Mocking](./mocking.md) — `@nudo:mock` and `@nudo:mock-module`
- [Contracts](../guides/contract.md) — `*.nudo.js` sidecars and `@nudo:contract`
- [CLI Usage](../guides/cli.md) — `check` / `test` / `contract` / `export` / `health`
