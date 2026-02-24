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

## Summary Table

| Directive | Syntax | Purpose |
|-----------|--------|---------|
| `@nudo:case` | `"name" (args...)` or `"name" (args) => type` | Provide named execution cases |
| `@nudo:mock` | `name = expr` or `name from "path"` | Mock external dependencies |
| `@nudo:pure` | (no args) | Mark function as pure for memoization |
| `@nudo:skip` | `[returnsExpr]` | Skip evaluation, use existing type info |
| `@nudo:sample` | `N` | Control loop sampling before fixed-point |
| `@nudo:returns` | `(typeValueExpr)` | Assert expected return type |
