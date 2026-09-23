---
description: "Syntax reference for all @nudo: directives — case, mock, pure, skip, sample, refine, import, env, mock-module, as, replace — with constraints and examples."
---

# Directives

Directives are structured comments that control how Nudo analyzes your code. They use the `@nudo:` namespace to avoid conflicts with JSDoc and other tools. Place directives in block comments immediately above the function they apply to.

The **contract product** (refinement obligations) lives primarily in sidecar files — `*.nudo.js` modules auto-bound to same-name exports of your source file — with `@nudo:refine` as the in-source form (`@nudo:interface` is an exact alias). See [@nudo:refine](#nudorefine--refinement-contract) and the [`nudo contract`](../guides/contract.md) command.

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

## @nudo:case — Debug Witnesses

Cases are **debug witnesses**: concrete inputs Nudo executes the function with for scenario runs. They are **not** the contract product — obligations live in `*.nudo.js` sidecars / `@nudo:refine` (see [@nudo:refine](#nudorefine--refinement-contract)). `@nudo:case` remains supported for optional `nudo test` assertions and LSP scenario switching. Cases use concrete arguments or constraint builders.

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

Replace external dependencies with mocks during evaluation — `fetch`, file system APIs, or other code Nudo cannot execute directly. Full syntax (five forms), the single-line rule, B-path caveats, and worked examples: [Mocking External Dependencies](./mocking.md).

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
@nudo:skip returnsExpr
```

- **returnsExpr** (optional) — A constraint-builder / concrete expression used as the return type.

### Scope

- **No body evaluation.** The declared type (or `any`) becomes the signature return; entry may-throw (L2) is not evaluated for a skipped body.
- **Parameter obligations stay.** `@nudo:refine` preconditions still gate call sites, and the parameter display still comes from the handwritten contract — `nudo check` reports `needsPositive(x: number) => any` for a skipped `needsPositive` with `@nudo:refine x positive`.
- **Return contracts still checked.** `@nudo:skip lit(0)` under `@nudo:refine return positive` reports `nudo:constraint-violated`.

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
 * @nudo:skip number()
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

## @nudo:refine — Refinement Contract {#nudorefine--refinement-contract}

Attach a refinement contract to a parameter or the return value. The constraint enters Abs as a Pred and **participates in algebra** (`x>0` ⇒ `x+1>1`) — it is not just a call-site gate.

`@nudo:interface` is an **exact alias** of `@nudo:refine` (both parse to the same in-source refinement). The **product name** is **contract** (sidecar `*.nudo.js` / `@nudo:refine`); some diagnostic codes still carry the historical `interface` token (`nudo:interface-param-mismatch`, …).

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

`shift` is legal only on numeric scalar chains (every bound's right side is a literal); anything else throws. `partial`/`pick`/`omit` accept `shape(...)` constraints.

**Auto-binding rules:**

- Binds only **same-name local named exports** of the source file (`export function` / `export const`). Re-exports, `export default`, and CJS are out of scope.
- Sidecars under `node_modules/` are never auto-loaded.
- Same-parameter annotations from source and sidecar are **conjoined**; a contradictory conjunction (e.g. `x > 0` ∧ `x < 0`) reports `nudo:interface-conflict`.
- A sidecar binding wins over nothing else — merge order is: handwritten (source annotation ∪ sidecar binding) > generated segment > implicit inference. The layer is shown by `nudo contract` (`[handwritten]` / `[generated]` / `[implicit]`).

### In-source form

```text
@nudo:refine <param> <constraint>
@nudo:refine return <constraint>
@nudo:interface <param> <constraint>   // alias
```

- **param** — Parameter name, or the literal `return` for the postcondition
- **constraint** — Name exported from a `*.nudo.js` module, imported via `/// @nudo:import`

### Examples

```javascript
/// @nudo:import { positive, delay } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;
}

/**
 * @nudo:refine ms delay
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
 * @nudo:refine u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}
```

---

## @nudo:import — Constraint Templates

Import constraint templates from a `*.nudo.js` module for use with `@nudo:refine`. This is a **file-level** directive using triple-slash comments.

### Syntax

```text
/// @nudo:import { name1, name2 } from "./shapes.nudo.js"
/// @nudo:import * as ns from "./shapes.nudo.js"
```

- **named** — bind exported template names used by `@nudo:refine`
- **namespace** — `@nudo:import * as ns from "…"` expands to `ns.exportName` refs in `@nudo:refine`

### Example

```javascript
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
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

Override the type of the next statement's value. Similar to TypeScript's `as` keyword, but placed as a line comment above the statement. Applied on the B path to `VariableDeclaration` initializers and `ReturnStatement` values of the covered statement.

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
| `@nudo:skip` | `[returnsExpr]` | Skip evaluation, use existing type info |
| `@nudo:sample` | `N` | Reserved no-op (parsed, not consumed) |
| `@nudo:refine` / `@nudo:interface` | `param constraint` / `return constraint` | In-source refinement contract (alias pair; main path is the `*.nudo.js` sidecar auto-binding) |
| `@nudo:import` | `{ name } from "spec"` (file-level `///`) | Import `*.nudo.js` constraint templates for `@nudo:refine` |
| `@nudo:env` | `name1, name2` (file-level `///`) | Declare runtime environment APIs |
| `@nudo:mock-module` | `"module" from "path"` (file-level `///`) | Replace imported modules with mocks |
| `@nudo:as` | `typeValueExpr` (line comment `//`) | Override next statement's value type |
| `@nudo:replace` | `targetExpr typeValueExpr` (line comment `//`) | Replace sub-expression type in next statement |
