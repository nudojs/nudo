---
sidebar_position: 5
---

# Control Flow Narrowing

Nudo tracks how types change as code flows through branches, guards, and operators. When you test a value with a condition, Nudo narrows the type in the branch where the condition is true and keeps the complement in the false branch. This guide covers every narrowing pattern Nudo supports.

## Truthiness Narrowing

When a value appears in a boolean context (e.g., `if (x)`), Nudo removes types that are falsy -- `null`, `undefined`, `false`, `""`, and `0` -- from the true branch. The false branch retains those falsy types and removes the truthy ones.

```js
/**
 * @nudo:returns
 */
function greet(name) {
  if (name) {
    // name is string (null and undefined removed)
    return name.toUpperCase();
  }
  // name is null | undefined
  return "unknown";
}
```

```
nudo: true branch:  name: string
nudo: false branch: name: null | undefined
```

## Optional Chaining (`?.`)

When you use optional chaining (`?.`), Nudo knows the result is `undefined` if the object is `null` or `undefined`. The access itself narrows the object type to exclude nullish values on the non-short-circuit path.

```js
/**
 * @nudo:returns
 */
function getLength(maybeStr) {
  const len = maybeStr?.length;
  // len is number | undefined
  return len ?? 0;
}
```

```
nudo: maybeStr?.length -> number | undefined
```

## Nullish Coalescing (`??`)

The nullish coalescing operator removes `null` and `undefined` from the left operand's type. The result is the non-nullable left type or the right operand's type.

```js
/**
 * @nudo:returns
 */
function getPort(config) {
  const port = config.port ?? 3000;
  // port is number (null | undefined removed from config.port)
  return port;
}
```

```
nudo: config.port: number | null | undefined
nudo: config.port ?? 3000 -> number
```

## Discriminated Union Narrowing

When you compare a property against a string literal (e.g., `obj.kind === "circle"`), Nudo filters the union to keep only the members whose discriminating property matches. The false branch keeps the remaining members.

```js
/**
 * @nudo:returns
 */
function area(shape) {
  if (shape.kind === "circle") {
    // shape: { kind: "circle", radius: number }
    return Math.PI * shape.radius ** 2;
  }
  if (shape.kind === "square") {
    // shape: { kind: "square", side: number }
    return shape.side ** 2;
  }
  // shape: { kind: "triangle", base: number, height: number }
  return shape.base * shape.height / 2;
}
```

```
nudo: shape: { kind: "circle", radius: number } | { kind: "square", side: number } | { kind: "triangle", base: number, height: number }
nudo: after shape.kind === "circle":  { kind: "circle", radius: number }
nudo: after shape.kind === "square":  { kind: "square", side: number }
nudo: else branch:                    { kind: "triangle", base: number, height: number }
```

## `in` Operator Narrowing

Using `"key" in obj` in a condition narrows the object type to include only members that have that property. The false branch excludes those members.

```js
/**
 * @nudo:returns
 */
function serialize(value) {
  if ("toJSON" in value) {
    // value narrowed to types with a toJSON property
    return value.toJSON();
  }
  return String(value);
}
```

```
nudo: true branch:  value: { toJSON: () => any, ... }
nudo: false branch: value: string | number | boolean | ...
```

## Switch Statement Narrowing

Nudo narrows the discriminant per `case` clause. Each case branch gets the type that matches that literal value. A `default` branch captures all remaining types.

```js
/**
 * @nudo:returns
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
      // status: string (exhausted literal cases removed if union is complete)
      return "Unknown";
  }
}
```

```
nudo: case "active":  status: "active"
nudo: case "paused":  status: "paused"
nudo: case "stopped": status: "stopped"
nudo: default:        status: string
```

## `Array.isArray()` Narrowing

Calling `Array.isArray(value)` in a condition splits the type into array and non-array branches.

```js
/**
 * @nudo:returns
 */
function flatten(input) {
  if (Array.isArray(input)) {
    // input: array
    return input.flat();
  }
  // input: number | string | ...
  return [input];
}
```

```
nudo: true branch:  input: array
nudo: false branch: input: number | string | ...
```

## Summary

| Pattern | Condition | True Branch | False Branch |
|---|---|---|---|
| Truthiness | `if (x)` | Excludes `null`, `undefined`, `false`, `""`, `0` | Keeps falsy types |
| Optional Chaining | `x?.prop` | Result is `T \| undefined` | Object is `null \| undefined` |
| Nullish Coalescing | `x ?? fallback` | Result excludes `null \| undefined` | N/A (expression) |
| Discriminated Union | `x.kind === "lit"` | Keeps matching union member | Keeps remaining members |
| `in` Operator | `"key" in x` | Keeps types with that property | Keeps types without it |
| Switch | `switch (x) { case ... }` | Narrows per case literal | Default gets remainder |
| `Array.isArray()` | `Array.isArray(x)` | Array types only | Non-array types only |
