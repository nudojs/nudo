---
sidebar_position: 4
description: Browse practical Nudo inference examples grouped by theme — functions and objects, strings, loops and ranges, unions, validation, and runtime environments.
---

# Examples

This guide shows practical examples of Nudo type inference, grouped by theme. Each example includes the input code with directives and the inferred types.

Every output block below is a real `nudo infer` run of the code above it. Output blocks show the **case headers and `Combined:` lines** — the per-call-site ground truth. The `intension:` / `abs:` lines of a full run re-evaluate the function with `unknown` parameters (a generalized signature), which for multi-branch functions shows only the fallback path; read the case headers and `Combined:` for branch-by-branch precision. Functions here use call sites (`call@L…`) when the call-site path is the precise one, and `@nudo:case` directives when they are.

---

## Basic Inference

### 1. Basic Function with Literal and Symbolic Cases

A function with multiple cases: concrete values and symbolic type values. Nudo combines the results.

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

**Inferred output:**

```text
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

Concrete cases keep their literal results (`2`, `-9`), and the symbolic case `(T.number, T.number)` produces `number`. The combined type is the union of all case results, simplified by absorption — the literals are absorbed by the base type `number`, yielding `number`.

---

### 2. Object Manipulation with Type Narrowing

Property access. Nudo infers types through object shapes, and string concatenation keeps literal structure.

```javascript
function greet(user) {
  return user.name + " is " + user.age;
}
greet({ name: "Alice", age: 30 });
```

**Inferred output:**

```text
=== greet ===

Case "call@L4": ({ name: "Alice", age: 30 }) => "Alice is 30"
```

Nudo evaluates the call with the concrete shape: `user.name` and `user.age` resolve to their literal values, and `+` concatenation produces the exact result `"Alice is 30"` — not a flattened `string`.

Currently parameter destructuring does not unpack the argument shape — `function greet({ name, age })` with the same body and call returns `number | string` (the destructured fields arrive as `unknown`, so `+` widens to its plain-JS result), so property access is the reliable way to get shape-based precision.

---

### 3. Array Processing with map/filter

Arrays and higher-order functions. Nudo tracks element types through `map` and `filter`.

```javascript
/**
 * @nudo:case "concrete" ([1, 2, 3])
 * @nudo:case "symbolic" (T.array(T.number))
 */
function doubleAll(arr) {
  return arr.map((x) => x * 2);
}
```

**Inferred output:**

```text
=== doubleAll ===

Case "concrete": ([1, 2, 3]) => [2, 4, 6]
Case "symbolic": (number[]) => number[]

Combined: [2, 4, 6] | number[]
```

Nudo tracks element types through `map`. The concrete input `[1, 2, 3]` is evaluated element by element to `[2, 4, 6]`, while the symbolic input `T.array(T.number)` yields `number[]`.

---

## Async Calls and Errors

### 4. Async Function with Mocked fetch

Async functions and external APIs. Use `@nudo:mock` to replace `fetch` (or other globals) with a mock whose body is plain JavaScript, written on a single line.

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

With the mock in place, Nudo infers that `fetchUser` returns `Promise<{ id: 1, name: "Alice" }>` without real network calls. Two rules for inline mocks: the expression **must fit on one line** (multi-line expressions are truncated and reported as `nudo:mock-invalid`), and `T.*` constructors are **not available inside the mock body** — write plain JavaScript values and closures. The `stub().resolves(...)` helper is only equivalent for plain data: it keeps literal slots (`stub().resolves({ ok: true, id: 1 })` → `Promise<{ ok: true, id: 1 }>`), but closure slots in the resolved value are **not bridged** — `json` arrives body-less (`json: () => ?`), so `res.json()` evaluates to `unknown` and this example degrades to `Promise<unknown>`. When the mock result gets called, use the arrow-function form above.

---

### 5. Error Handling with Throws Tracking

Functions that throw. Nudo tracks both the normal return type and the thrown type.

```javascript
/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function half(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x / 2;
}
```

**Inferred output:**

```text
=== half ===

Case "valid": (10) => 5
Case "negative": (-1) => never throws RangeError

Combined: 5
```

Nudo models control flow: the `valid` case returns `5`, the `negative` case throws `RangeError` and never returns — its result is `never` with the thrown value tracked alongside. The combined value type is `5`. The diagnostic for the active case also reports `nudo-may-throw` when a case can throw.

---

## Strings and Templates

### 6. Template Strings — Nudo vs TypeScript

Nudo preserves string structure through concatenation, enabling precise inference that TypeScript cannot achieve.

```javascript
/**
 * @nudo:case "symbolic" (T.string)
 */
function makeApiUrl(path) {
  return "https://api.example.com" + path;
}
```

**Nudo infers:** `` `https://api.example.com${string}` ``

**TypeScript infers:** `string` (loses the known prefix)

This means Nudo can reason about the result:

```javascript
function buildApiUrl(host, path) {
  return "https://" + host + path;
}
buildApiUrl("api.example.com", "/users");   // → "https://api.example.com/users"
```

The literal prefix and the concrete call argument fold into the exact URL. Method calls on the resulting template type (for example `url.startsWith("https://")`) currently evaluate to `unknown`, so prefer concatenation structure over method reasoning.

---

### 7. Precise String Methods

Nudo evaluates some string methods on literals at compile time, producing exact results.

```javascript
function stringDemo() {
  const upper = "hello".toUpperCase();    // → "HELLO" (TS: string)
  const sliced = "hello".slice(1, 3);     // → "el" (TS: string)
  const len = "hello".length;             // → 5 (TS: number)
  return { upper, sliced, len };
}
stringDemo();
```

**Inferred output:**

```text
=== stringDemo ===

Case "call@L7": () => { upper: "HELLO", sliced: "el", len: 5 }
```

`toUpperCase`, `slice`, and `.length` fold to precise literals at the call site. TypeScript can only infer `string` or `number` for these operations. Not every method is modeled yet — `"a,b,c".split(",")` and `"hello".indexOf("l")` currently evaluate to `unknown`, so check with `nudo infer` before relying on a specific method.

---

## Loops and Ranges

### 8. Loop Evaluation

Nudo can evaluate loops with concrete bounds, computing exact results at type level — something TypeScript cannot do at all.

```javascript
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + i;
  }
  return sum;
}
sumTo(5);
```

**Inferred output:**

```text
=== sumTo ===

Case "call@L8": (5) => 10
```

With concrete input `5`, Nudo evaluates the loop and produces the exact result `10`. With an abstract bound (`T.number`), the loop guard cannot be decided, so the result widens to `number | string` — the plain JS semantics of `+` with an unknown accumulator.

---

### 9. Range Narrowing

A comparison guard narrows the input per call site: each concrete call evaluates only the branch that matches its argument.

```javascript
function pickAdult(age) {
  if (age >= 18) return age;
  return -1;
}
pickAdult(25);
pickAdult(12);
```

**Inferred output:**

```text
=== pickAdult ===

Case "call@L5": (25) => 25
Case "call@L6": (12) => -1

Combined: 25 | -1
```

`pickAdult(25)` takes the `age >= 18` branch and returns `25`; `pickAdult(12)` falls through to `-1`. The combined type keeps both literal results. (For an abstract `T.number` argument the guard cannot fork, and only the fallback `-1` is reported.)

---

## Unions and Safe Access

### 10. Discriminated Union State Machine

A state machine where each state has a different shape. Nudo narrows the union based on the discriminant field `status`.

```javascript
/**
 * @nudo:case "idle" ({ status: "idle" })
 * @nudo:case "loading" ({ status: "loading", requestId: "abc" })
 * @nudo:case "success" ({ status: "success", data: { name: "test" } })
 * @nudo:case "error" ({ status: "error", message: "fail" })
 */
function handleState(state) {
  switch (state.status) {
    case "idle": return "Waiting...";
    case "loading": return `Loading ${state.requestId}...`;
    case "success": return state.data.name;
    case "error": return state.message;
  }
}
```

**Inferred output:**

```text
=== handleState ===

Case "idle": ({ status: "idle" }) => "Waiting..."
Case "loading": ({ status: "loading", requestId: "abc" }) => "Loading abc..."
Case "success": ({ status: "success", data: { name: "test" } }) => "test"
Case "error": ({ status: "error", message: "fail" }) => "fail"

Combined: "Waiting..." | "Loading abc..." | "test" | "fail"
```

Nudo narrows `state` inside each `case` branch based on the discriminant. In the `"loading"` case, `state.requestId` is available as `"abc"` (literal) and the template is fully evaluated to `"Loading abc..."`; in the `"success"` case, `state.data.name` resolves to `"test"`. The combined type keeps every literal result.

---

### 11. Optional Chaining with Nullish Coalescing

Optional chains and nullish coalescing are evaluation-time operators. Their current precision is limited, so it pays to know exactly what they produce.

```javascript
function getTheme(config) {
  return config.user?.profile?.settings?.theme ?? "light";
}
getTheme({ user: { profile: { name: "Alice", settings: { theme: "dark" } } } });
getTheme({ user: { profile: { name: "Bob" } } });
```

**Inferred output:**

```text
=== getTheme ===

Case "call@L4": ({ user: { profile: { name: "Alice", settings: { theme: "dark" } } } }) => string
Case "call@L5": ({ user: { profile: { name: "Bob" } } }) => unknown
```

When the full path exists, the chain resolves and `?? "light"` yields `string`; when the chain short-circuits, the result degrades to `unknown`. A shallow `??` on a known property is more precise:

```javascript
function getPort(config) {
  const port = config.port ?? 3000;
  return port;
}
getPort({ port: 8080 });   // → number
```

Deep `?.` chains currently do not preserve the fallback literal — verify your own chains with `nudo infer`.

---

### 12. API Response Validation

Handling API responses with different status codes. Nudo narrows the response shape based on the status check at each call site.

```javascript
function parseResponse(response) {
  if (response.status === 200) {
    return { success: true, user: response.data };
  }
  return { success: false, error: response.error };
}
parseResponse({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } });
parseResponse({ status: 404, error: "Not found" });
```

**Inferred output:**

```text
=== parseResponse ===

Case "call@L7": ({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } }) => { success: true, user: { id: 1, name: "Alice", email: "alice@example.com" } }
Case "call@L8": ({ status: 404, error: "Not found" }) => { success: false, error: "Not found" }

Combined: { success: true, user: { id: 1, name: "Alice", email: "alice@example.com" } } | { success: false, error: "Not found" }
```

The `status === 200` check narrows per call: the success call takes the `if` branch with `response.data` fully available; the 404 call falls through to the error branch. The combined type is the union of both concrete shapes.

---

## Validation Functions

### 13. Form Data Processing

Sequential validation checks with multiple `return` branches. Nudo evaluates the conversions precisely at each call site and reports the branch that matches the concrete input.

```javascript
function validateForm(data) {
  const age = Number(data.age);
  if (isNaN(age)) return { valid: false, error: "Invalid age" };
  if (!data.email) return { valid: false, error: "Missing email" };
  return { valid: true, name: data.name, age, email: data.email };
}
validateForm({ name: "Alice", age: "25", email: "alice@example.com" });
validateForm({ name: "Bob", age: "abc", email: "bob@example.com" });
validateForm({ name: "Charlie" });
```

**Inferred output:**

```text
=== validateForm ===

Case "call@L7": ({ name: "Alice", age: "25", email: "alice@example.com" }) => { valid: true, name: "Alice", age: 25, email: "alice@example.com" }
Case "call@L8": ({ name: "Bob", age: "abc", email: "bob@example.com" }) => { valid: false, error: "Invalid age" }
Case "call@L9": ({ name: "Charlie" }) => { valid: true, name: "Charlie", age: number, email: unknown }

Combined: { valid: true, name: "Alice", age: 25, email: "alice@example.com" } | { valid: false, error: "Invalid age" } | { valid: true, name: "Charlie", age: number, email: unknown }
```

The conversions are evaluated precisely: `Number("25")` folds to `25` and the valid path wins; `Number("abc")` folds to `NaN`, so the `isNaN` guard returns the `"Invalid age"` error. A missing property is a known limitation: `data.email` on the `missing` input resolves to `unknown` (not `undefined`), so `!data.email` is not a definite `true` and the fallthrough branch is reported instead of `"Missing email"`.

---

### 14. Type Guard Function

A function whose return type acts as a type guard. Nudo infers the boolean result for each input case.

```javascript
/**
 * @nudo:case "string" ("hello")
 * @nudo:case "number" (42)
 * @nudo:case "object" ({ type: "user", name: "Alice" })
 */
function isString(value) {
  return typeof value === "string";
}
```

**Inferred output:**

```text
=== isString ===

Case "string": ("hello") => true
Case "number": (42) => false
Case "object": ({ type: "user", name: "Alice" }) => false

Combined: true | false
```

Nudo evaluates `typeof` on each literal input at the type level. `"hello"` has `typeof "string"`, so the comparison yields `true`. Numbers and objects yield `false`. The combined type is the union `true | false`.

---

## Runtime Environments

### 15. Web Environment — fetch, localStorage, URL

Use `@nudo:env web` to load built-in type definitions for Web globals. For network code the environment types currently stay shallow, so a precise response shape still requires an `@nudo:mock` override.

```javascript
/// @nudo:env web

/**
 * @nudo:case "get user" (1)
 * @nudo:case "symbolic" (T.number)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
```

**Inferred output:**

```text
=== fetchUser ===

Case "get user": (1) => never throws unknown
Case "symbolic": (number) => never throws unknown

Combined: never

Diagnostics:

  [warning] env.js:7:0 Cannot resolve 'ok' on unknown value (nudo:unknown-recv)
  [warning] env.js:7:0 Cannot resolve 'status' on unknown value (nudo:unknown-recv)
  [warning] env.js:7:0 Function "fetchUser" case "get user" may throw: unknown. Consider adding a try-catch block or using @nudo:refine return <constraint> (nudo-may-throw)
```

`fetch` is bound from the environment, but its response type is `unknown` — member access reports `nudo:unknown-recv`, and both cases end in `never throws unknown`. For precise response shapes use an `@nudo:mock fetch = ...` override **without** `@nudo:env web` (example 4 infers `Promise<{ id: 1, name: "Alice" }>`); combining the two currently degrades the mock to `unknown`.

Non-network globals behave the same way:

```javascript
/// @nudo:env web

function savePreference(key, value) {
  localStorage.setItem(key, value);
  return localStorage.getItem(key);
}
savePreference("theme", "dark");
```

**Inferred output:** `unknown` — `localStorage` is present as a typed global, but its methods currently return `unknown` rather than `string | null`.

---

### 16. Node.js Environment — fs, path, crypto

Use `@nudo:env node` to get built-in type definitions for Node.js globals and modules.

```javascript
/// @nudo:env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * @nudo:case "test" (T.string)
 */
function loadConfig(dir) {
  const filePath = join(dir, "config.json");
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}
```

**Inferred output:**

```text
=== loadConfig ===

Case "test": (string) => unknown
```

`JSON.parse` returns `unknown` (the early `return null` collapses into it). `@nudo:env node` types `readFileSync`, `existsSync`, and `join`, so no mocks are needed.

```javascript
/// @nudo:env node

import { createHash } from "node:crypto";

/**
 * @nudo:case "hash" ("hello world")
 */
function hashContent(data) {
  const hash = createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}
```

**Inferred output:**

```text
=== hashContent ===

Case "hash": ("hello world") => unknown

Diagnostics:

  [warning] env.js:10:2 Cannot resolve 'update' on unknown value (nudo:unknown-recv)
  [warning] env.js:11:9 Cannot resolve 'digest' on unknown value (nudo:unknown-recv)
```

`node:crypto` is not modeled yet: `createHash` resolves to `unknown`, and method calls report `nudo:unknown-recv`. The simple fs/path example above is the reliable part of the node environment.

---

## Summary of Directives Used

| Directive       | Purpose                                      |
|-----------------|----------------------------------------------|
| `@nudo:case`    | Provide concrete or symbolic input samples   |
| `@nudo:mock`    | Replace globals/modules with type-value mocks|
| `@nudo:pure`    | Mark pure functions for caching              |
| `@nudo:skip`    | Skip evaluation; use declared return type    |
| `@nudo:sample`  | Control loop sampling count                  |
| `@nudo:refine`  | Refinement contract (param / return)         |
| `@nudo:env`     | Declare runtime environment (web, node, es)  |
| `@nudo:mock-module` | Replace imported modules with mock files |

For more on type values (`T.number`, `T.object`, etc.) and abstract interpretation, see [Type Values](../concepts/type-values.md) and [Abstract Interpretation](../concepts/abstract-interpretation.md).
