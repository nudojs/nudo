---
sidebar_position: 4
description: Browse practical Nudo inference examples grouped by theme — functions and objects, strings, loops and ranges, unions, validation, and runtime environments.
---

# Examples

This guide shows practical examples of Nudo type inference, grouped by theme. Each example includes the input code with directives and the inferred types.

Every output block below is a real `nudo infer` run of the code above it. Output blocks show the **case headers and `Combined:` lines** — the per-call-site ground truth. The `intension:` / `abs:` lines of a full run re-evaluate the function with `unknown` parameters (a generalized signature), which for multi-branch functions shows only the fallback path; read the case headers and `Combined:` for branch-by-branch precision. Functions here use call sites (`call@L…`) when the call-site path is the precise one, and `@nudo:case` directives when they are.

> The repo's CI-verified example suite lives in [`docs/examples/`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md): every command and promised exit code there is checked by `pnpm run verify:examples`, with per-example output pins mirroring the documented output lines. This guide browses the same engine by theme; the repo suite is the ground-truth gate.

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

Shape merging through spread is the workhorse for config objects — right-side slots override same-named left-side slots, the remaining slots union, and each call site keeps its literals:

```js
function mixin(base, ext) {
  return { ...base, ...ext };
}
mixin({ host: "localhost", port: 8080 }, { port: 3000, debug: true });
mixin({ id: 1 }, { name: "ada" });
```

```text
=== mixin ===

Case "call@L4": ({ host: "localhost", port: 8080 }, { port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }
Case "call@L5": ({ id: 1 }, { name: "ada" }) => { id: 1, name: "ada" }

Combined: { host: "localhost", port: 3000, debug: true } | { id: 1, name: "ada" }
```

Index projection with a literal key resolves the exact slot — and stays precise for objects playing an "env" role:

```js
function pick(obj, key) {
  return obj[key];
}
pick({ a: 1, b: "x" }, "a");
const env = { PATH: "/usr/bin", HOME: "/root" };
pick(env, "PATH");
```

```text
=== pick ===

Case "call@L4": ({ a: 1, b: "x" }, "a") => 1
Case "call@L6": ({ PATH: "/usr/bin", HOME: "/root" }, "PATH") => "/usr/bin"

Combined: 1 | "/usr/bin"
```

A symbolic (`T.string`) key cannot select a slot and degrades to `unknown` — repo example (CI-pinned): [`docs/examples/algebra/e-index-proj.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/e-index-proj.js). Spread meet is pinned in [`docs/examples/algebra/d-mixin-meet.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/d-mixin-meet.js); the `--dts` projection (one widened signature, literal-union return) is pinned by the `a-spread-optional.js --dts` row of the [examples matrix](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md) — the generated `a-spread-optional.d.ts` is the ground-truth output.

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

Nudo tracks element types through `map`. The concrete input `[1, 2, 3]` is evaluated element by element to `[2, 4, 6]`, while the symbolic input `T.array(T.number)` yields `number[]`. Repo example (CI-pinned): [`docs/examples/algebra/b-hof-map.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/b-hof-map.js).

`reduce` is just as precise — a literal array folds element by element through the accumulator, and a symbolic array applies the callback once (`init + element` → `number`):

```javascript
/**
 * @nudo:case "literal" ([1, 2, 3, 4, 5])
 * @nudo:case "symbolic" (T.array(T.number))
 */
function sum(numbers) {
  return numbers.reduce((acc, n) => acc + n, 0);
}
```

```text
=== sum ===

Case "literal": ([1, 2, 3, 4, 5]) => 15
Case "symbolic": (number[]) => number

Combined: number
```

Array-method support is not uniform — check this boundary before relying on a method. `some` / `every` fold to `boolean` on both the call-site and `@nudo:case` paths. `forEach` callback side effects land in the internal Abs on both paths (`abs: 15 #exact`), but the **case header** (extensional projection) differs: under an `@nudo:case` directive it reports the final `15`, while the call-site path reports the pre-loop `0`:

```js
function forEachSum(arr) {
  let s = 0;
  arr.forEach((x) => { s = s + x; });
  return s;
}
forEachSum([1, 2, 3, 4, 5]);    // → 0 case header on the call-site path (abs: 15 #exact)

function someBig(arr) {
  return arr.some((x) => x > 3);
}
someBig([1, 2, 3, 4, 5]);       // → boolean
```

The directive path is the one whose case header reflects the `forEach` write-back — the repo example pins `@nudo:case "forEach"` → `15 #exact`. For call sites that need a precise reported value, use `map` / `reduce` (and `filter → map → reduce` chains, which keep literal precision per level). Repo examples (CI-pinned): [`docs/examples/algebra/c-reduce-sum.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/c-reduce-sum.js), [`docs/examples/algebra/h-array-boundary.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/h-array-boundary.js).

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

Case "user": (1) => promise<{ id: 1, name: "Alice" }>
```

With the mock in place, Nudo infers that `fetchUser` returns `promise<{ id: 1, name: "Alice" }>` without real network calls. Two rules for inline mocks: the expression **must fit on one line** (multi-line expressions are truncated and reported as `nudo:mock-invalid`), and `T.*` constructors are **not available inside the mock body** — write plain JavaScript values and closures. The `stub().resolves(...)` helper is only equivalent for plain data: it keeps literal slots (`stub().resolves({ ok: true, id: 1 })` → `promise<{ ok: true, id: 1 }>`), but closure slots in the resolved value are **not bridged** — `json` arrives body-less (`json: () => ?`), so `res.json()` evaluates to `unknown` and this example degrades to `promise<unknown>`. When the mock result gets called, use the arrow-function form above. Repo example (CI-pinned): [`docs/examples/algebra/f-async-eff.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/f-async-eff.js) — `@nudo:mock` is required there, not optional: without it, the B path executes the real `fetch` and crashes with `ERR_INVALID_URL`.

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

Nudo models control flow: the `valid` case returns `5`, the `negative` case throws `RangeError` and never returns — its result is `never` with the thrown value tracked alongside. The combined value type is `5`. A statically decided throw like this one emits no extra diagnostic — `never throws RangeError` is the whole story. A **conditional** throw (the throwing branch guarded by an unknown condition, as in example 15) additionally reports `nudo-may-throw` for that case.

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

The literal prefix and the concrete call argument fold into the exact URL. Prefix/suffix/membership checks fold on literal receivers at the call site too:

```javascript
function checkUrl(url) {
  return url.startsWith("https://");
}
checkUrl("https://api.example.com/users");
```

**Inferred output:**

```text
=== checkUrl ===

Case "call@L4": ("https://api.example.com/users") => true
```

`startsWith`, `endsWith`, and `includes` fold to a definite boolean on literal receivers — on the call-site path and under an `@nudo:case` directive alike. Not every method keeps full precision though — `"hello".indexOf("l")` yields the `number` primitive without the literal index (see example 7).

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

`toUpperCase`, `slice`, `.length`, and `split` (literal receiver and separator) fold to precise results at the call site. TypeScript can only infer `string`, `number`, or `string[]` for these operations. `indexOf` still yields the `number` primitive without the literal index, so check with `nudo infer` before relying on a specific method.

---

### Primitive Conversions & Parsing

The global coercion constructors and numeric parsers fold literals to exact results, on the call-site and directive paths alike:

```javascript
function strOf(x) { return String(x); }
strOf(5);                            // → "5"

function boolOf(x) { return Boolean(x); }
boolOf("hi");                        // → true

function numOf(x) { return Number(x); }
numOf("42");                         // → 42

function intOf(s) { return parseInt(s); }
intOf("42px");                       // → 42

function floatOf(s) { return parseFloat(s); }
floatOf("3.14");                     // → 3.14
```

**Inferred output:**

```text
=== strOf ===

Case "call@L2": (5) => "5"
```

`String`, `Number`, and `Boolean` fold number/string/boolean literals to the exact coerced literal; `parseInt` / `parseFloat` fold string/number literals to the exact numeric prefix/parse. Symbolic arguments widen to the target primitive. Repo example (CI-pinned): [`docs/examples/algebra/l-primitive-conversion.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/l-primitive-conversion.js).

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

With concrete input `5`, Nudo evaluates the loop and produces the exact result `10`. With an abstract bound (`T.number`), the guard `i < n` is never definitely false, so the loop runs to its bounded-iteration cap (8) — the accumulator sums `0…7` and the case reports `28 #exact`. The cap is a termination guard for abstract conditions, not a fixed-point join.

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

`pickAdult(25)` takes the `age >= 18` branch and returns `25`; `pickAdult(12)` falls through to `-1`. The combined type keeps both literal results. (For an abstract `T.number` argument the guard cannot fork, and the two branches join — `age | -1` absorbs into `number`, so the case reports `number`.) Repo example (CI-pinned): [`docs/examples/algebra/g-narrow-subtract.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/g-narrow-subtract.js).

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

Case "call@L4": ({ user: { profile: { name: "Alice", settings: { theme: "dark" } } } }) => "dark"
Case "call@L5": ({ user: { profile: { name: "Bob" } } }) => "light"

Combined: unknown
```

When the full path exists, the chain resolves to the literal `"dark"`; when the chain short-circuits, the `?? "light"` fallback folds to the literal `"light"`. Each call site reports its exact literal. `Combined:` still degrades to `unknown` — the aggregate is derived from the symbolic re-run, which can't follow the deep `?.` chain. A shallow `??` on a known property is precise:

```javascript
function getPort(config) {
  const port = config.port ?? 3000;
  return port;
}
getPort({ port: 8080 });   // → number
```

The case headers now fold the fallback to its literal (`"dark"` / `"light"`), but `Combined:` still reports `unknown` because the combined value is computed from the symbolic re-run (`intension`), which can't follow the deep `?.` chain. Verify your own chains with `nudo infer`.

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
Case "call@L9": ({ name: "Charlie" }) => { error: string, valid: false } | { valid: true, name: "Charlie", age: number, email: unknown }

Combined: { valid: true, name: "Alice", age: 25, email: "alice@example.com" } | { valid: false, error: "Invalid age" } | { error: string, valid: false } | { valid: true, name: "Charlie", age: number, email: unknown }
```

The conversions are evaluated precisely: `Number("25")` folds to `25` and the valid path wins; `Number("abc")` folds to `NaN`, so the `isNaN` guard returns the `"Invalid age"` error. A missing property is a known limitation: on the `missing` input, `data.age` is `unknown`, so `Number(data.age)` widens to `number` and `isNaN(number)` is indefinite — the `"Invalid age"` error branch and the fallthrough both stay reachable. `data.email` also resolves to `unknown` (not `undefined`), so `!data.email` is not a definite `true` and `"Missing email"` is never reported. The result is the union of the error branch and the fallthrough.

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

Case "get user": (1) => never throws Error
Case "symbolic": (number) => never throws Error

Combined: never

Diagnostics:

  [warning] env.js:7:0 Function "fetchUser" case "get user" may throw: Error. Consider adding a try-catch block or using @nudo:refine return <constraint> (nudo-may-throw)
```

`fetch` is bound from the environment as `promise<Response>` — `res.ok` (`boolean`) and `res.status` (`number`) resolve, so the `!res.ok` throw branch is reachable and both cases report `never throws Error` with a `nudo-may-throw` warning. The body shape stays shallow though: `res.json()` returns `promise<unknown>`, so a precise response shape still requires an `@nudo:mock fetch = ...` override (example 4 infers `promise<{ id: 1, name: "Alice" }>`).

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

Case "test": (string) => null
```

`existsSync(filePath)` on a symbolic path is indefinite, so both branches stay reachable — the case header reports the early `return null` (`null`), while the internal Abs result is `unknown` (`JSON.parse` folds to `unknown`). `@nudo:env node` types `readFileSync`, `existsSync`, and `join`, so no mocks are needed.

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

Case "hash": ("hello world") => string | Buffer { … }
```

`node:crypto` is modeled: `createHash` returns a Hash object (`update` / `digest`), and `digest("hex")` folds to `string | Buffer` (the `Buffer` arm carries its method shape). No `nudo:unknown-recv` diagnostics here.

---

## Directives Used in This Guide

| Directive    | Used in | Purpose |
|--------------|---------|---------|
| `@nudo:case` | 1, 3, 4, 5, 6, 10, 14, 15, 16 | Provide concrete or symbolic input samples |
| `@nudo:mock` | 4 | Replace globals with a single-line plain-JS mock |
| `@nudo:env`  | 15, 16 | Load built-in environment typings (web / node) |

The full directive set — `@nudo:refine` contracts, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, `@nudo:mock-module`, and more — is documented in [Directives](../concepts/directives.md).

For more on type values and abstract interpretation, see [Type Values](../concepts/type-values.md) and [Abstract Interpretation](../concepts/abstract-interpretation.md).
