---
sidebar_position: 3
---

# Directives

Directives are structured comments that control how Nudo analyzes your code. They use the `@nudo:` namespace to avoid conflicts with JSDoc and other tools. Place directives in block comments immediately above the function they apply to.

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

---

## @nudo:case — Named Execution Cases

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

Replace external dependencies with type-value–aware mocks during evaluation. Use this for `fetch`, file system APIs, or other code Nudo cannot execute directly.

### Syntax

**Inline expression:**

```text
@nudo:mock name = expression
```

**From module:**

```text
@nudo:mock name from "path"
```

- **name** — The identifier to mock (e.g. `fetch`, `fs`).
- **expression** — A JavaScript expression that returns a type value or a function that accepts type values.
- **path** — Path to a module that provides the mock.

### Examples

```javascript
/**
 * @nudo:mock fetch = (url) => T.promise(T.object({
 *   ok: T.boolean,
 *   json: T.fn({ params: [], returns: T.object({ id: T.number, name: T.string }) })
 * }))
 * @nudo:case "user" (T.number)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

```javascript
/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (T.string)
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
```

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

Skip abstract interpretation. The engine does not evaluate the function body and instead uses existing type information (e.g. TypeScript/JSDoc annotations or `@nudo:returns`).

### Syntax

```text
@nudo:skip
@nudo:skip returnsExpr
```

- **returnsExpr** (optional) — A type value expression for the return type when no annotations are available.

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

```javascript
/**
 * @nudo:skip T.number
 */
function unannotatedHeavy(x) {
  // No TypeScript annotation; explicit return type
  return expensiveOp(x);
}
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

## @nudo:returns — Assert Expected Return Type

Assert that the inferred return type matches a given type or predicate. Useful for tests and documentation.

### Syntax

```text
@nudo:returns (typeValueExpr)
```

- **typeValueExpr** — A type value expression. The engine checks that the inferred return type equals or is a subtype of this type.

### Examples

```javascript
/**
 * @nudo:case "numbers" (T.number, T.number)
 * @nudo:returns (T.number)
 */
function add(a, b) {
  return a + b;
}
```

```javascript
/**
 * @nudo:case "union" (T.union(T.string, T.number))
 * @nudo:returns (T.union(T.number, T.string))
 */
function process(x) {
  if (typeof x === "string") return x.length;
  return x;
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
| `@nudo:returns` | `(typeValueExpr)` | Assert expected return type |
| `@nudo:env` | `name1, name2` (file-level `///`) | Declare runtime environment APIs |
| `@nudo:mock-module` | `"module" from "path"` (file-level `///`) | Replace imported modules with mocks |
| `@nudo:as` | `typeValueExpr` (line comment `//`) | Override next statement's value type |
| `@nudo:replace` | `targetExpr typeValueExpr` (line comment `//`) | Replace sub-expression type in next statement |
