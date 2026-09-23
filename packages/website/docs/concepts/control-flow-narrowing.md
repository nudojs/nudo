---
description: See how Nudo narrows types per call site — equality guards, discriminated object shapes, typeof, Array.isArray, switch, and literal truthiness — plus the current limits of unknown-condition branches, in, and ?./??.
---

# Control Flow Narrowing

Nudo narrows types when it can decide a condition for the **concrete argument of a call site**. Each `call@L… => …` line in the output reports the result of one call, evaluated with that call's exact argument — branches eliminated by narrowing never contribute to that case's result; the function's combined type is the union of all per-call results (visible in `nudo check` signatures and IDE hover).

Narrowing is precise on the **call-site path** (functions called at the top level, reported as `call@` cases) and on `@nudo:case` directives with **concrete** arguments. Symbolic arguments (`number()`, `union(...)`) cannot decide a condition, so their branches join instead of narrowing. Every output block below is excerpted from a real `nudo test` run of the code above it (`nudo test <file>` headers and the assertions summary are elided).

## Comparison Guards

A comparison against a literal narrows the argument per call: each concrete call takes only the branch that matches.

```js
function pickAdult(age) {
  if (age >= 18) return age;
  return -1;
}
pickAdult(25);
pickAdult(12);
```

```text
=== pickAdult ===

  call@L5  (25) => 25
  call@L6  (12) => -1

```

`pickAdult(25)` satisfies `age >= 18` and returns `25`; `pickAdult(12)` falls through to `-1`. The combined type keeps both literal results.

## Discriminated Object Shapes

When you compare a property against a string literal (`shape.kind === "circle"`), the branch for a matching call sees the object shape of that call's argument.

```js
function area(shape) {
  if (shape.kind === "circle") {
    return shape.radius * 3.14159;
  }
  return shape.side * shape.side;
}
area({ kind: "circle", radius: 2 });
area({ kind: "square", side: 3 });
```

```text
=== area ===

  call@L7  ({ kind: "circle", radius: 2 }) => 6.28318
  call@L8  ({ kind: "square", side: 3 }) => 9

```

The circle call takes the `if` branch and computes `6.28318`; the square call falls through to `side * side` and yields `9`.

## `typeof` and `Array.isArray()` Guards

Both guards fork per concrete call, and the narrowed value keeps its precise behavior in the matching branch.

```js
function len(x) {
  if (typeof x === "string") return x.length;
  if (Array.isArray(x)) return x.length;
  return -1;
}
len("abc");
len([1, 2]);
len(5);
```

```text
=== len ===

  call@L6  ("abc") => 3
  call@L7  ([1, 2]) => 2
  call@L8  (5) => -1

```

The string call reaches `x.length` on a narrowed string (`3`), the array call on a narrowed array (`2`), and the number call falls through both guards to `-1`. The narrowed branch keeps the value itself: indexing a narrowed array (`x[0]`) resolves to its element type — a literal for a literal array, the element type for an abstract array — just like `.length` does.

## Switch Statements

A `switch` on a discriminant narrows per `case` clause — including for `@nudo:case` directive inputs.

```js
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

```text
=== handleState ===

  debug "idle"  ({ status: "idle" }) => "Waiting..."
  debug "loading"  ({ status: "loading", requestId: "abc" }) => "Loading abc..."
  debug "success"  ({ status: "success", data: { name: "test" } }) => "test"
  debug "error"  ({ status: "error", message: "fail" }) => "fail"

```

Each clause receives its matching object shape, so `state.requestId` and `state.data.name` resolve inside their branches.

## Not Narrowed Yet

These patterns currently do **not** fork on the call-site path — each one degrades to a single branch or to `unknown` (inference failed / engine debt), so guard against them explicitly or verify with `nudo test` before relying on them:

| Pattern | Current behavior |
|---|---|
| Ternary with an `unknown` condition | `flag ? "a" : "b"` with a symbolic condition joins both branches (`string`). Definite conditions fork precisely on both paths — `pick(true)` → `"a"`, `x === 5 ? "five" : "other"` with `5` → `"five"` — so no `if`-guard workaround is needed anymore. |
| Symbolic inputs | `@nudo:case` with symbolic arguments (`number()`, `union(...)`) do not fork conditions — the branches join; concrete arguments narrow on both paths. |
| `in` operator | `if ("toJSON" in value)` narrows for object arguments, but method results widen (`string` instead of the closure's `"serialized"`); non-object arguments also report `nudo:no-method`. |
| `?.` / `??` | Folds on known receiver shapes — shallow (`config.port ?? 3000` → `number`) and deep (`a.b.c ?? 5` → `5`; `a?.b?.c` with `null` → `undefined`). On unconstrained (`any`) receivers the result stays `any` with `throws TypeError` — engine debt `unknown` does not apply here. |

## Optional chaining & nullish coalescing

Known-shape receivers fold at every depth; `any` receivers keep `any` semantics (plus the may-throw effect):

```js verify
function shallow(cfg) { return cfg.port ?? 3000; }
shallow({});

function deepchain(a) { return a.b.c ?? 5; }
deepchain({ b: {} });

function optchain(a) { return a?.b?.c; }
optchain(null);
```

```text
=== shallow ===

  call@L2  ({  }) => 3000

=== deepchain ===

  call@L5  ({ b: {  } }) => 5

=== optchain ===

  call@L8  (unknown) => undefined
```

## Summary

| Pattern | Narrows per call site | Example |
|---|---|---|
| Comparison guard | Yes | `if (age >= 18)` → `25` / `-1` |
| Discriminated object | Yes | `if (shape.kind === "circle")` → `6.28318` / `9` |
| `typeof` | Yes | `typeof x === "string"` → `3` |
| `Array.isArray()` | Yes | `Array.isArray(x)` → `2` |
| `switch` | Yes (including directive inputs) | per-clause literals |
| Truthiness | Yes (literal args) | `truthy(42)` → `"yes"`, `truthy(0)` → `"no"`; `undefined`/symbolic args join branches |
| Ternary conditions | Yes (definite conditions) | `pick(true)` → `"a"`; unknown condition joins branches |
| `in` | Partial | forks, member results widen |
| `?.` / `??` | Yes (known shapes) | shallow + deep `??` / `?.` fold; `any` receivers stay `any` + `throws TypeError` |
