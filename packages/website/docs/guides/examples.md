---
sidebar_position: 4
---

# Examples

This guide shows practical examples of Nudo type inference. Each example includes the input code with directives and the inferred types.

---

## 1. Basic Function with Literal and Symbolic Cases

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

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: 2 | -9 | number
```

Concrete cases keep their literal results (`2`, `-9`), and the symbolic case `(T.number, T.number)` produces `number`. The combined type is the union of all case results.

---

## 2. Object Manipulation with Type Narrowing

Destructuring and property access. Nudo infers types through object shapes.

```javascript
/**
 * @nudo:case "concrete" ({ name: "Alice", age: 30 })
 * @nudo:case "symbolic" (T.object({ name: T.string, age: T.number }))
 */
function greet({ name, age }) {
  return `Hello, ${name}! You are ${age} years old.`;
}
```

**Inferred output:**

```
=== greet ===

Case "concrete": ({ name: "Alice", age: 30 }) => "Hello, Alice! You are 30 years old."
Case "symbolic": ({ name: string, age: number }) => `Hello, ${string}! You are ${number} years old.`

Combined: "Hello, Alice! You are 30 years old." | `Hello, ${string}! You are ${number} years old.`
```

Nudo narrows `name` and `age` from the object shape in each case. Template results are not flattened to `string`: the concrete case yields the fully evaluated literal, and the symbolic case keeps a template type with the interpolated parameter types.

---

## 3. Array Processing with map/filter

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

```
=== doubleAll ===

Case "concrete": ([1, 2, 3]) => [2, 4, 6]
Case "symbolic": (number[]) => number[]

Combined: [2, 4, 6] | number[]
```

Nudo tracks element types through `map`. The concrete input `[1, 2, 3]` is evaluated element by element to `[2, 4, 6]`, while the symbolic input `T.array(T.number)` yields `number[]`.

---

## 4. Async Function with Mocked fetch

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

```
=== fetchUser ===

Case "user": (1) => Promise<{ id: 1, name: "Alice" }>
```

With the mock in place, Nudo infers that `fetchUser` returns `Promise<{ id: 1, name: "Alice" }>` without real network calls. Two rules for inline mocks: the expression **must fit on one line** (multi-line expressions are truncated and reported as `nudo:mock-invalid`), and `T.*` constructors are **not available inside the mock body** — write plain JavaScript values and closures. For a resolved promise, the helper form `@nudo:mock fetch = stub().resolves({ ok: true, json: () => ({ id: 1, name: "Alice" }) })` infers the same result.

---

## 5. Error Handling with Throws Tracking

Functions that throw. Nudo tracks both the normal return type and the thrown type.

```javascript
/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return Math.sqrt(x);
}
```

**Inferred output:**

```
=== safeSqrt ===

Case "valid": (10) => number
Case "negative": (-1) => never throws RangeError { message: "negative input" }

Combined: number

Diagnostics:

  [info] safeSqrt.js:6:13 Code after return/throw statement is unreachable (nudo-unreachable)
```

Nudo models control flow: the `valid` case returns `number`, the `negative` case throws `RangeError` and never returns — its result is `never` with the thrown value tracked alongside. The combined value type is `number`. When Nudo finds issues it appends a `Diagnostics:` section to the output; here an `[info]` note about the statement after the `throw`.

---

## 6. Template Strings — Nudo vs TypeScript

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
/**
 * @nudo:case "symbolic" (T.string)
 */
function isApiUrl(path) {
  const url = "https://api.example.com" + path;
  return url.startsWith("https://");  // → true (known from template prefix)
}
```

Nudo knows the result is always `true` because the template's prefix starts with `"https://"`. TypeScript would infer `boolean`.

---

## 7. Precise String Methods

Nudo evaluates string methods on literals at compile time, producing exact results.

```javascript
/**
 * @nudo:case "test" ()
 */
function stringDemo() {
  const upper = "hello".toUpperCase();    // → "HELLO" (TS: string)
  const parts = "a,b,c".split(",");       // → ["a", "b", "c"] (TS: string[])
  const idx = "hello".indexOf("l");       // → 2 (TS: number)
  const sliced = "hello".slice(1, 3);     // → "el" (TS: string)
  const len = "hello".length;             // → 5 (TS: number)
  return { upper, parts, idx, sliced, len };
}
```

Every result is a precise literal type. TypeScript can only infer `string`, `string[]`, or `number` for these operations.

---

## 8. Loop Evaluation

Nudo can evaluate loops with concrete bounds, computing exact results at type level — something TypeScript cannot do at all.

```javascript
/**
 * @nudo:case "concrete" (5)
 * @nudo:case "symbolic" (T.number)
 */
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + i;
  }
  return sum;
}
```

**Inferred output:**

```
=== sumTo ===

Case "concrete": (5) => 10
Case "symbolic": (number) => number

Combined: 10 | number
```

With concrete input `5`, Nudo evaluates the loop and produces the exact result `10`. With abstract input `T.number`, it widens to `number` after fixed-point iteration, and the combined type keeps both.

---

## 9. Refined Types — Range Narrowing

Refined types attach constraints to a base type. You get them built-in: comparison guards refine `number` into a range that keeps its constraint in the inferred output.

```javascript
/**
 * @nudo:case "symbolic" (T.number)
 */
function pickAdult(age) {
  if (age >= 18) return age;
  return -1;
}
```

**Inferred output:**

```
=== pickAdult ===

Case "symbolic": (number) => number (>= 18) | -1
```

Inside the `if (age >= 18)` branch, `age` is no longer plain `number` — it carries the `>= 18` constraint, and the inferred result shows `number (>= 18)`. Operations on a refined type without a matching rule fall back to its base type. Template strings (`` `https://api.example.com${string}` `` in example 6) are refined types too — they carry their known prefix and suffix as the constraint.

---

## 10. Discriminated Union State Machine

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

```
=== handleState ===

Case "idle": ({ status: "idle" }) => "Waiting..."
Case "loading": ({ status: "loading", requestId: "abc" }) => "Loading abc..."
Case "success": ({ status: "success", data: { name: "test" } }) => "test"
Case "error": ({ status: "error", message: "fail" }) => "fail"

Combined: "Waiting..." | "Loading abc..." | "test" | "fail"
```

Nudo narrows `state` inside each `case` branch based on the discriminant. In the `"loading"` case, `state.requestId` is available as `"abc"` (literal) and the template is fully evaluated to `"Loading abc..."`; in the `"success"` case, `state.data.name` resolves to `"test"`. The combined type keeps every literal result.

---

## 11. Optional Chaining with Nullish Coalescing

Safe property access through optional chaining and fallback with nullish coalescing. Nudo tracks which properties exist at each branch.

```javascript
/**
 * @nudo:case "full" ({ user: { profile: { name: "Alice", settings: { theme: "dark" } } } })
 * @nudo:case "partial" ({ user: { profile: { name: "Bob" } } })
 * @nudo:case "empty" ({})
 */
function getTheme(config) {
  return config.user?.profile?.settings?.theme ?? "light";
}
```

**Inferred output:**

```
=== getTheme ===

Case "full": ({ user: { profile: { name: "Alice", settings: { theme: "dark" } } } }) => "dark"
Case "partial": ({ user: { profile: { name: "Bob" } } }) => "light"
Case "empty": ({}) => "light"

Combined: "dark" | "light"
```

When the full path exists, Nudo returns the literal `"dark"`. When `settings` or `user` is missing, the `??` fallback produces `"light"`. The combined type is the union of the literal results.

---

## 12. API Response Validation

Handling API responses with different status codes. Nudo narrows the response shape based on the status check.

```javascript
/**
 * @nudo:case "success" ({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } })
 * @nudo:case "not-found" ({ status: 404, error: "Not found" })
 * @nudo:case "error" ({ status: 500, error: "Server error" })
 */
function parseResponse(response) {
  if (response.status === 200) {
    return { success: true, user: response.data };
  }
  return { success: false, error: response.error };
}
```

**Inferred output:**

```
=== parseResponse ===

Case "success": ({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } }) => { success: true, user: { id: 1, name: "Alice", email: "alice@example.com" } }
Case "not-found": ({ status: 404, error: "Not found" }) => { success: false, error: "Not found" }
Case "error": ({ status: 500, error: "Server error" }) => { success: false, error: "Server error" }

Combined: { success: true, user: { id: 1, name: "Alice", email: "alice@example.com" } } | { success: false, error: "Not found" } | { success: false, error: "Server error" }

Diagnostics:

  [info] parseResponse.js:10:2 Code after return/throw statement is unreachable (nudo-unreachable)
```

The `status === 200` check narrows the response: inside the `if` branch, `response.data` is available; outside it, `response.error` is known to exist. Each case returns a fully concrete object, and the combined type is the union of all three shapes.

---

## 13. Form Data Processing

Sequential validation checks with multiple `return` branches. Nudo evaluates the conversions precisely and reports each branch's result as a union.

```javascript
/**
 * @nudo:case "valid" ({ name: "Alice", age: "25", email: "alice@example.com" })
 * @nudo:case "invalid-age" ({ name: "Bob", age: "abc", email: "bob@example.com" })
 * @nudo:case "missing" ({ name: "Charlie" })
 */
function validateForm(data) {
  const age = Number(data.age);
  if (isNaN(age)) return { valid: false, error: "Invalid age" };
  if (!data.email) return { valid: false, error: "Missing email" };
  return { valid: true, name: data.name, age, email: data.email };
}
```

**Inferred output:**

```
=== validateForm ===

Case "valid": ({ name: "Alice", age: "25", email: "alice@example.com" }) => { valid: false, error: "Invalid age" } | { valid: true, name: "Alice", age: 25, email: "alice@example.com" }
Case "invalid-age": ({ name: "Bob", age: "abc", email: "bob@example.com" }) => { valid: false, error: "Invalid age" } | { valid: true, name: "Bob", age: NaN, email: "bob@example.com" }
Case "missing": ({ name: "Charlie" }) => { valid: false, error: "Invalid age" } | { valid: false, error: "Missing email" }

Combined: { valid: false, error: "Invalid age" } | { valid: true, name: "Alice", age: 25, email: "alice@example.com" } | { valid: false, error: "Invalid age" } | { valid: true, name: "Bob", age: NaN, email: "bob@example.com" } | { valid: false, error: "Invalid age" } | { valid: false, error: "Missing email" }

Diagnostics:

  [info] validateForm.js:9:19 Code after return/throw statement is unreachable (nudo-unreachable)
```

The `Number(...)` conversions are evaluated precisely — `Number("25")` produces the literal `25`, and `Number("abc")` produces `NaN`. Guards like `isNaN(age)` are not used to narrow control flow, so each case's result is the union of all `return` branches; you can still read the exact branch values from that union.

---

## 14. Type Guard Function

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

```
=== isString ===

Case "string": ("hello") => true
Case "number": (42) => false
Case "object": ({ type: "user", name: "Alice" }) => false

Combined: true | false
```

Nudo evaluates `typeof` on each literal input at the type level. `"hello"` has `typeof "string"`, so the comparison yields `true`. Numbers and objects yield `false`. The combined type is the union `true | false`.

---

## 15. Web Environment — fetch, localStorage, URL

Use `@nudo:env web` to get built-in type definitions for Web APIs. No manual mocking needed for standard browser globals.

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

```
=== fetchUser ===

Case "get user": (1) => Promise<unknown>
Case "symbolic": (number) => Promise<unknown>

Combined: Promise<unknown>
```

With the built-in web environment, no mock is needed: `fetch` is typed from the environment, and `res.json()` returns `Promise<unknown>`, so `fetchUser` infers `Promise<unknown>`. To get a precise response shape, combine `@nudo:env web` with an `@nudo:mock fetch = ...` override (example 4).

```javascript
/// @nudo:env web

/**
 * @nudo:case "save" ("theme", "dark")
 */
function savePreference(key, value) {
  localStorage.setItem(key, value);
  return localStorage.getItem(key);
}
```

**Inferred output:** `string | null` — Nudo knows `localStorage.getItem` returns `string | null`.

---

## 16. Node.js Environment — fs, path, crypto

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

```
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

**Inferred output:** `string | Buffer` — from the `digest` return type. The CLI output expands `Buffer` to its full method shape (`Buffer { toString: (_arg0: string) => string, … }`).

---

## Summary of Directives Used

| Directive       | Purpose                                      |
|-----------------|----------------------------------------------|
| `@nudo:case`    | Provide concrete or symbolic input samples   |
| `@nudo:mock`    | Replace globals/modules with type-value mocks|
| `@nudo:pure`    | Mark pure functions for caching              |
| `@nudo:skip`    | Skip evaluation; use declared return type    |
| `@nudo:sample`  | Control loop sampling count                  |
| `@nudo:returns` | Assert expected return type                  |
| `@nudo:env`     | Declare runtime environment (web, node, es)  |
| `@nudo:mock-module` | Replace imported modules with mock files |

For more on type values (`T.number`, `T.object`, etc.) and abstract interpretation, see [Type Values](/docs/concepts/type-values) and [Abstract Interpretation](/docs/concepts/abstract-interpretation).
