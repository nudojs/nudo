---
sidebar_position: 5
description: See how Nudo narrows types through branches — truthiness, discriminated unions, `in` checks, switch, and `Array.isArray()` — plus the evaluation-time semantics of `?.` and `??`.
---

# Control Flow Narrowing

Nudo tracks how types change as code flows through branches, guards, and operators. When you test a value with a condition, Nudo narrows the type in the branch where the condition is true and keeps the complement in the false branch. The sections below cover every branch-narrowing pattern Nudo supports; the closing section covers `?.` and `??`, which are evaluation-time behaviors rather than narrowing.

Narrowing is observed through case inputs: give the function a union via `@nudo:case` and run `nudo infer`. Each `Case ... => ...` line in the output reports the result type for that input -- branches eliminated by narrowing never contribute to the result union. Every output block below is a real `nudo infer` run of the code above it.

## Truthiness Narrowing

When a value appears in a boolean context (e.g., `if (x)`), Nudo removes types that are falsy -- `null`, `undefined`, `false`, `""`, and `0` -- from the true branch. The false branch retains those falsy types and removes the truthy ones.

```js
/**
 * @nudo:case "nullable name" (T.union(T.string, T.null, T.undefined))
 */
function greet(name) {
  if (name) {
    // name narrowed to string (null and undefined removed)
    return name.toUpperCase();
  }
  // name is null | undefined here
  return "unknown";
}
```

```text
=== greet ===

Case "nullable name": (string | null | undefined) => string | "unknown"
```

The true branch yields `string` (from `name.toUpperCase()`), the false branch contributes the literal `"unknown"`, and the result keeps both members. The clean run is itself evidence of narrowing -- without the guard, the same call reports `Method 'toUpperCase' does not exist on type 'string | null | undefined' (nudo:no-method)`.

## Discriminated Union Narrowing

When you compare a property against a string literal (e.g., `obj.kind === "circle"`), Nudo filters the union to keep only the members whose discriminating property matches. The false branch keeps the remaining members.

```js
/**
 * @nudo:case "shape" (T.union(T.object({ kind: T.literal("circle"), radius: T.number }), T.object({ kind: T.literal("square"), side: T.number })))
 */
function area(shape) {
  if (shape.kind === "circle") {
    // shape narrowed to { kind: "circle", radius: number }
    return shape.radius * 3.14159;
  }
  // shape narrowed to { kind: "square", side: number }
  return shape.side * shape.side;
}
```

```text
=== area ===

Case "shape": ({ kind: "circle", radius: number } | { kind: "square", side: number }) => number
```

Inside the `if`, `shape.radius` type-checks because the union has been filtered down to the circle member; after it, `shape.side` type-checks against the square member. Both branches return `number`, so the result is `number`.

## `in` Operator Narrowing

Using `"key" in obj` in a condition narrows the object type to include only members that have that property. The false branch excludes those members.

```js
/**
 * @nudo:case "value" (T.union(T.object({ toJSON: () => "serialized" }), T.number))
 */
function serialize(value) {
  if ("toJSON" in value) {
    // value narrowed to { toJSON: () => "serialized" }
    return value.toJSON();
  }
  // value narrowed to number
  return String(value);
}
```

```text
=== serialize ===

Case "value": ({ toJSON: () => ... } | number) => "serialized" | string
```

The true branch calls the `toJSON` method on the narrowed object member and yields `"serialized"`; the false branch receives `number` and `String(value)` yields `string`. The result union keeps both.

## Switch Statement Narrowing

Nudo narrows the discriminant per `case` clause. Each case branch gets the type that matches that literal value. A `default` branch captures all remaining types.

```js
/**
 * @nudo:case "status" (T.union(T.literal("active"), T.literal("paused"), T.literal("stopped")))
 */
function describe(status) {
  switch (status) {
    case "active":
      // status: "active"
      return "Running";
    case "paused":
      // status: "paused"
      return "On hold";
    case "stopped":
      // status: "stopped"
      return "Shut down";
    default:
      return "Unknown";
  }
}
```

```text
=== describe ===

Case "status": ("active" | "paused" | "stopped") => "Running" | "On hold" | "Shut down" | "Unknown"
```

Each branch contributes its own return literal to the result. You can watch the discriminant itself narrow by returning it from every branch:

```js
/**
 * @nudo:case "status" (T.union(T.literal("active"), T.literal("paused"), T.literal("stopped")))
 */
function label(status) {
  switch (status) {
    case "active":
      return status; // "active"
    case "paused":
      return status; // "paused"
    case "stopped":
      return status; // "stopped"
    default:
      // the union is exhausted -- status is never here
      return status;
  }
}
```

```text
=== label ===

Case "status": ("active" | "paused" | "stopped") => "active" | "paused" | "stopped"
```

The three case branches return their own narrowed literal, and the `default` branch adds nothing: the union was already exhausted, so `status` there is `never`.

## `Array.isArray()` Narrowing

Calling `Array.isArray(value)` in a condition splits the type into array and non-array branches.

```js
/**
 * @nudo:case "input" (T.union(T.array(T.number), T.string))
 */
function flatten(input) {
  if (Array.isArray(input)) {
    // input narrowed to number[]
    return input[0];
  }
  // input narrowed to string
  return input;
}
```

```text
=== flatten ===

Case "input": (number[] | string) => number | string
```

In the true branch `input` is `number[]`, so `input[0]` yields `number`; in the false branch `input` is `string`.

## Safe Access and Defaulting (`?.` and `??`)

Optional chaining and nullish coalescing are not branch narrowing — they are handled during expression evaluation, without the `narrow()` machinery that powers the patterns above. `?.` short-circuits to `undefined` when the receiver is a *concrete* `null`/`undefined`; `??` subtracts `null` and `undefined` from its left operand's type and falls back to the right side when nothing remains.

### Optional Chaining (`?.`)

When the receiver of `x?.prop` evaluates to `null` or `undefined`, the chain short-circuits and the result is `undefined`. When the receiver is non-nullish, the chain resolves the property like a plain access. Driving this with two cases shows both paths:

```js
/**
 * @nudo:case "object present" (T.object({ length: T.number }))
 * @nudo:case "null" (T.null)
 */
function getLength(maybeBox) {
  return maybeBox?.length ?? 0;
}
```

```text
=== getLength ===

Case "object present": ({ length: number }) => number
Case "null": (null) => 0

Combined: number
```

With the object present, `maybeBox?.length` resolves to `number` and the `?? 0` fallback never fires. With `null`, the chain short-circuits to `undefined`, so `?? 0` produces the literal `0`. The `Combined:` line unions all case results and then simplifies by absorption — the literal `0` is absorbed by the base type `number` from the other case.

Note that `?.` short-circuits on a *concrete* nullish receiver. It does not by itself narrow a union-typed receiver: on an input of `T.union(T.object({ length: T.number }), T.null)`, the access `maybeBox?.length` still reports `Property 'length' does not exist on type '{ length: number } | null' (nudo:no-method)` -- use a truthiness guard first, then access.

### Nullish Coalescing (`??`)

The nullish coalescing operator removes `null` and `undefined` from the left operand's type. The result is the non-nullable left type or the right operand's type.

```js
/**
 * @nudo:case "config object" (T.object({ port: T.union(T.number, T.null, T.undefined) }))
 */
function getPort(config) {
  const port = config.port ?? 3000;
  return port;
}
```

```text
=== getPort ===

Case "config object": ({ port: number | null | undefined }) => number
```

`config.port` arrives as `number | null | undefined`, but the `?? 3000` fallback absorbs the nullish members, so `port` is `number`.

## Summary

| Pattern | Condition | True Branch | False Branch |
|---|---|---|---|
| Truthiness | `if (x)` | Excludes `null`, `undefined`, `false`, `""`, `0` | Keeps falsy types |
| Discriminated Union | `x.kind === "lit"` | Keeps matching union member | Keeps remaining members |
| `in` Operator | `"key" in x` | Keeps types with that property | Keeps types without it |
| Switch | `switch (x) { case ... }` | Narrows per case literal | Default gets remainder (`never` if exhausted) |
| `Array.isArray()` | `Array.isArray(x)` | Array types only | Non-array types only |

`?.` and `??` are absent from this table on purpose: they are evaluation-time short-circuiting and defaulting (see *Safe Access and Defaulting* above), not branch narrowing.
