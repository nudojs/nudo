---
sidebar_position: 3
description: "Syntax reference for all @nudo: directives — case, mock, pure, skip, sample, refine, import, env, mock-module, as, replace — with constraints and examples."
---

# Directives

Directives are structured comments that control how Nudo analyzes your code. They use the `@nudo:` namespace to avoid conflicts with JSDoc and other tools. Place directives in block comments immediately above the function they apply to.

The **interface product** (refinement contracts) lives primarily in sidecar files — `*.nudo.js` modules auto-bound to same-name exports of your source file — with `@nudo:refine` / `@nudo:interface` as the compatible in-source form. See [@nudo:refine](#nudorefine--refinement-contract) and the [`nudo interface`](../guides/cli.md#nudo-interface) command.

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

Both forms are parsed identically — in particular, the single-line rule for mock expressions applies to both (see [@nudo:mock](#nudo--mock-external-dependencies)). Prefer the block form when a `//`-prefixed directive could read as commented-out code.

---

## @nudo:case — Named Execution Cases

Cases are **debug witnesses**: concrete or symbolic inputs Nudo executes the function with. They are not the interface product — refinement contracts live in `*.nudo.js` sidecars (see [@nudo:refine](#nudorefine--refinement-contract)). `@nudo:case` remains fully supported for scenario testing, `nudo test` assertions, and LSP scenario switching.

Provide named execution cases. Each case defines inputs (concrete or symbolic) for Nudo to run the function with.

### Syntax

```text
@nudo:case "name" (arg1, arg2, ...)
@nudo:case "name" (arg1, arg2) => expectedType
```

- **name** — A string identifier for the case (e.g. `"positive numbers"`).
- **args** — Comma-separated arguments: concrete values (`5`, `"hello"`) or type expressions (`T.number`, `T.union(T.string, T.number)`).
- **expected** (optional) — After `=>`, a type value expression for the expected return type (used for validation).

### Examples

```javascript
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function subtract(a, b) {
  return a - b;
}
```

```javascript
/**
 * @nudo:case "strings" (T.string)
 * @nudo:case "numbers" (T.number)
 * @nudo:case "array" (T.array(T.number))
 */
function process(x) {
  if (typeof x === "string") return x.length;
  if (typeof x === "number") return x * 2;
  return x.length;
}
```

With expected return type:

```javascript
/**
 * @nudo:case "basic" (T.string) => T.number
 * @nudo:case "empty" ("") => T.literal(0)
 */
function len(s) {
  return s.length;
}
```

---

## @nudo:mock — Mock External Dependencies

Replace external dependencies with mocks during evaluation. Use this for `fetch`, file system APIs, or other code Nudo cannot execute directly.

### Syntax

Five forms are supported. **Every inline expression must fit on a single line** — see the warnings below.

**1. Single-line arrow function.** The body is plain JavaScript; the parameters receive type values:

```text
@nudo:mock name = (arg) => body
```

**2. Mock helpers** — `stub()`, `spy()`, `mock()`, chainable with `.returns(...)`, `.resolves(...)`, `.rejects(...)`, `.withArgs(...)`, `.callsFake(...)`:

```text
@nudo:mock name = stub().returns(value)
```

**3. Sinon-style equivalents** — `sinon.stub()` / `sinon.spy()` with the same chains:

```text
@nudo:mock name = sinon.stub().returns(value)
```

**4. Type value expression:**

```text
@nudo:mock name = T.number
```

**5. From module** — the module must define a binding with the same name as the mock:

```text
@nudo:mock name from "path"
```

- **name** — The identifier to mock (e.g. `fetch`, `fs`).
- **path** — Path to a module that provides the mock.

**Warning: the expression must be a single line.** The parser only reads up to the end of the line, so a multi-line expression is truncated at its first line and reported as `nudo:mock-invalid`. The following does **not** work:

```text
@nudo:mock fetch = (url) => T.promise(T.object({
  ok: T.boolean,
  json: T.fn({ params: [], returns: T.object({ ... }) })
}))
```

The real diagnostics for the truncated line:

```text
[warning] example.js:0:0 Mock expression "(url) => T.promise(T.object({" could not be parsed as a known pattern (nudo:mock-invalid)
[warning] example.js:10:9 Cannot resolve 'json' on unknown value (nudo:unknown-recv)
```

**Warning: no `T.*` inside an arrow-function body.** `T` exists only in directive expressions (case arguments, `= T.string`, ...). Inside a mock body write plain JavaScript — plain objects and closures — or use `stub().returns(...)` / `stub().resolves(...)` helpers instead.

**Warning: an unmocked global is executed for real on the B path.** For B-hosted files (the default for sources without top-level `this.`), the transpiled code calls the actual Node runtime global when no mock binds the name. A built-in like `fetch` therefore receives an abstract value as its URL and crashes the run (`ERR_INVALID_URL`, exit `1`) instead of evaluating to `unknown`. Mock any global your analyzed code calls: `@nudo:mock fetch = (url) => ({ ok: true, json: () => ({ ... }) })`.

### Examples

Mock `fetch` with an arrow function. The body is plain JavaScript on one line:

```javascript
/**
 * @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1, name: "Alice" }) })
 * @nudo:case "user" (1)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

**Inferred output:**

```text
=== fetchUser ===

Case "user": (1) => Promise<{ id: 1, name: "Alice" }>
```

A mock helper for resolved promises — `stub().resolves(value)` makes every call return `Promise<value>`:

```javascript
/**
 * @nudo:mock fetch = stub().resolves({ ok: true, json: () => ({ id: 1, name: "Alice" }) })
 * @nudo:case "user" (1)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

**Not the same result here:** the resolved object's closure slots are not bridged — `json` arrives body-less (`json: () => ?`), so `res.json()` evaluates to `unknown` and this example infers `Promise<unknown>` (abs `promise<unknown> #partial`), not the arrow mock's `Promise<{ id: 1, name: "Alice" }>`. `resolves` keeps full precision for plain data (`stub().resolves({ ok: true, id: 1 })` → `Promise<{ ok: true, id: 1 }>`); when the mock result gets called, use the arrow-function form. A synchronous helper:

```javascript
/**
 * @nudo:mock getPort = stub().returns(8080)
 * @nudo:case "default" ()
 */
function readPort() {
  return getPort();
}
```

**Inferred output:**

```text
=== readPort ===

Case "default": () => 8080
```

A type value expression binds the name to a type value directly:

```javascript
/**
 * @nudo:mock retries = T.number
 * @nudo:case "plan" ()
 */
function plan() {
  return retries + 1;
}
```

**Inferred output:**

```text
=== plan ===

Case "plan": () => number
```

From a module — the module must define a binding with the mocked name:

```javascript
/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (T.string)
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
```

```javascript
// mocks/fs.js
const fs = { readFileSync: (path, encoding) => "{ \"port\": 3000 }" };
```

**Inferred output:**

```text
=== readConfig ===

Case "read": (string) => "{ \"port\": 3000 }"
```

**Current limitation:** `from` mocks are not seeded into the B path — and since production analysis is Abs-native (the TypeValue evaluation path no longer exists), the mock is currently dropped everywhere: the name evaluates as an unknown global (`nudo:builtin-unknown`) or, for real Node globals, the bare call is reached directly. The single-line arrow-function form above works; prefer it until `from` is seeded into the B path.

---

## @nudo:pure — Mark Pure Functions

Mark a function as pure so the engine can memoize results. Same type-value inputs produce the same output, so repeated calls can reuse cached results.

### Syntax

```text
@nudo:pure
```

### Example

```javascript
/**
 * @nudo:pure
 * @nudo:case "add" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}
```

---

## @nudo:skip — Skip Evaluation

Skip abstract interpretation. The engine does not evaluate the function body. Without a return type expression, the function is reported as `Skipped (no return type declared)`; add a type value expression after the directive to declare one.

### Syntax

```text
@nudo:skip
@nudo:skip returnsExpr
```

- **returnsExpr** (optional) — A type value expression used as the return type.

### Examples

```javascript
/**
 * @nudo:skip
 */
function heavyComputation(data) {
  // Complex algorithm Nudo should not evaluate
  return processData(data);
}
```

**Inferred output:**

```text
=== heavyComputation ===

Skipped (no return type declared)
```

```javascript
/**
 * @nudo:skip T.number
 */
function unannotatedHeavy(x) {
  // Explicit return type via the directive
  return expensiveOp(x);
}
```

**Inferred output:**

```text
=== unannotatedHeavy ===

Skipped (declared): number
```

---

## @nudo:sample — Loop Sampling

Control how many loop iterations the engine evaluates before switching to fixed-point analysis. Use this to trade off precision and performance for loops over type-value arrays.

### Syntax

```text
@nudo:sample N
```

- **N** — A positive integer: number of concrete iterations to run before generalizing.

### Example

```javascript
/**
 * @nudo:sample 10
 * @nudo:case "reduce" (T.array(T.number))
 */
function sum(arr) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i];
  }
  return total;
}
```

---

## @nudo:refine — Refinement Contract {#nudorefine--refinement-contract}

Attach a refinement contract to a parameter or the return value. The constraint enters Abs as a Pred and **participates in algebra** (`x>0` ⇒ `x+1>1`) — it is not just a call-site gate.

`@nudo:interface` is an **exact alias** of `@nudo:refine` (both parse to the same in-source refinement); the product name in CLI / LSP / diagnostics is **interface**.

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
$ nudo interface calc.js
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
| `.min(n)` `.max(n)` | string length bounds (`length(s)` pred) | `string().min(1)` |
| `.shift(n)` | translate every constant bound by `+n` | `positive.shift(1)` |
| `and(...cs)` | scalar conjunction (top-level function, not a chained method) | `and(positive, number().lt(10))` |
| `partial(c)` / `pick(c, keys)` / `omit(c, keys)` | shape utilities | `partial(user)` |

`shift` is legal only on numeric scalar chains (every bound's right side is a literal); anything else throws. `partial`/`pick`/`omit` accept `shape(...)` constraints.

**Auto-binding rules:**

- Binds only **same-name local named exports** of the source file (`export function` / `export const`). Re-exports, `export default`, and CJS are out of scope.
- Sidecars under `node_modules/` are never auto-loaded.
- Same-parameter annotations from source and sidecar are **conjoined**; a contradictory conjunction (e.g. `x > 0` ∧ `x < 0`) reports `nudo:interface-conflict`.
- A sidecar binding wins over nothing else — merge order is: handwritten (source annotation ∪ sidecar binding) > generated segment > implicit inference. The layer is shown by `nudo interface` (`[handwritten]` / `[generated]` / `[implicit]`).

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
- **namespace** — parsed; template expansion via `ns.foo` is not yet supported

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
 * @nudo:case "test" (T.number)
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
 * @nudo:case "test" (T.string)
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

### Project-Level Configuration

```json
{
  "nudo": {
    "mocks": {
      "axios": "./nudo-mocks/axios.js"
    }
  }
}
```

File-level `@nudo:mock-module` directives override project-level mocks for the same module.

---

## @nudo:as — Type Assertion

Override the type of the next statement's value. Similar to TypeScript's `as` keyword, but placed as a line comment above the statement. Affects `VariableDeclaration`, `ReturnStatement`, and `ExpressionStatement`.

### Syntax

```text
// @nudo:as typeValueExpr
```

### Examples

```javascript
// @nudo:as T.object({ port: T.number, host: T.string })
const config = JSON.parse(content);
// config is now { port: number, host: string } instead of unknown
```

```javascript
// @nudo:as T.array(T.object({ id: T.number, name: T.string }))
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
// @nudo:replace a T.number
const x = a + b;
// only `a` is replaced; `b` evaluates normally
```

```javascript
// @nudo:replace res.data T.array(T.object({ id: T.number }))
const items = res.data;
```

```javascript
// @nudo:replace JSON.parse(input) T.object({ name: T.string })
const data = JSON.parse(input);
```

Multiple replacements can be stacked:

```javascript
// @nudo:replace a T.number
// @nudo:replace b T.string
const result = a + b;
```

**Note:** Each `@nudo:replace` only affects the immediately following statement.

---

## Summary Table

| Directive | Syntax | Purpose |
|-----------|--------|---------|
| `@nudo:case` | `"name" (args...)` or `"name" (args) => type` | Provide named execution cases |
| `@nudo:mock` | `name = expr` or `name from "path"` | Mock external dependencies |
| `@nudo:pure` | (no args) | Mark function as pure for memoization |
| `@nudo:skip` | `[returnsExpr]` | Skip evaluation, use existing type info |
| `@nudo:sample` | `N` | Control loop sampling before fixed-point |
| `@nudo:refine` / `@nudo:interface` | `param constraint` / `return constraint` | In-source refinement contract (alias pair; main path is the `*.nudo.js` sidecar auto-binding) |
| `@nudo:import` | `{ name } from "spec"` (file-level `///`) | Import `*.nudo.js` constraint templates for `@nudo:refine` |
| `@nudo:env` | `name1, name2` (file-level `///`) | Declare runtime environment APIs |
| `@nudo:mock-module` | `"module" from "path"` (file-level `///`) | Replace imported modules with mocks |
| `@nudo:as` | `typeValueExpr` (line comment `//`) | Override next statement's value type |
| `@nudo:replace` | `targetExpr typeValueExpr` (line comment `//`) | Replace sub-expression type in next statement |
