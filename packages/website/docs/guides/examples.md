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

Combined: number
```

The symbolic case `(T.number, T.number)` produces `number`. With one case, that is the result; with multiple matching cases, Nudo reports the combined type.

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

Case "concrete": ({ name: "Alice", age: 30 }) => string
Case "symbolic": ({ name: string, age: number }) => string

Combined: string
```

Nudo narrows `name` and `age` from the object shape in each case, so the return type is inferred as `string`.

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

Case "concrete": ([1, 2, 3]) => number[]
Case "symbolic": (number[]) => number[]

Combined: number[]
```

Input `number[]` yields output `number[]`. Use `T.array(T.number)` for symbolic array inputs.

---

## 4. Async Function with Mocked fetch

Async functions and external APIs. Use `@nudo:mock` to replace `fetch` (or other globals) with a type-value mock.

```javascript
/**
 * @nudo:mock fetch = (url) => T.promise(T.object({
 *   ok: T.boolean,
 *   json: T.fn({ params: [], returns: T.promise(T.object({ id: T.number, name: T.string })) })
 * }))
 * @nudo:case "test" ("https://api.example.com/user")
 */
async function fetchUser(url) {
  const res = await fetch(url);
  const data = await res.json();
  return data;
}
```

**Inferred output:**

With the mock in place, Nudo infers that `fetchUser` returns `Promise<{ id: number; name: string }>`.

`@nudo:mock` replaces `fetch` during abstract interpretation so Nudo can model the response shape without real network calls.

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
Case "negative": (-1) => never throws RangeError

Combined: number
```

Nudo models control flow: the `valid` case returns `number`, the `negative` case throws `RangeError` and never returns. The combined value type is `number`; Nudo also tracks that the function may throw.

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

Combined: number
```

With concrete input `5`, Nudo evaluates the loop and produces the exact result `10`. With abstract input `T.number`, it widens to `number` after fixed-point iteration.

---

## 9. User-Defined Refined Types

Users can create custom type constraints with `T.refine`, attaching domain-specific operation rules.

```javascript
const Odd = T.refine(T.number, {
  name: "odd",
  check: (v) => Number.isInteger(v) && v % 2 !== 0,
  ops: {
    "%"(self, other) {
      if (other.kind === "literal" && other.value === 2) return T.literal(1);
      return undefined;
    },
  },
});

/**
 * @nudo:case "test" (Odd)
 */
function checkOdd(x) {
  return x % 2;  // → 1 (custom op rule)
}
```

The `Odd` type knows that `odd % 2` is always `1`. Operations without custom rules (like `+`) fall back to `T.number`'s default behavior.

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

For more on type values (`T.number`, `T.object`, etc.) and abstract interpretation, see [Type Values](/docs/concepts/type-values) and [Abstract Interpretation](/docs/concepts/abstract-interpretation).
