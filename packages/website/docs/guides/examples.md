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
