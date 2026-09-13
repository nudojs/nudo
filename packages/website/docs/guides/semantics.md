---
sidebar_position: 9
description: Learn the JavaScript semantics Nudo's evaluator models precisely today — string methods, for-of, break, Object.keys, recursion — and the constructs that still degrade to unknown.
---

# Language Semantics

Nudo infers types by *executing* your code with symbolic values, so the quality of inference is exactly the quality of the evaluator's JavaScript semantics. This guide lists the language behaviors the evaluator models precisely on the call-site path — every output block below is a real `nudo infer` run of the code above it — followed by the constructs that still degrade to `unknown` and should be verified before you rely on them. Precise semantics are also what make [call-site discovery](./callsite-discovery.md) effective: harvested call shapes only pay off if the evaluator can actually follow them.

## Modeled Precisely

### String Methods on Literals

String methods on literal receivers fold at evaluation time.

```js
function upper() { return "hello".toUpperCase(); }
upper();                              // → "HELLO"

function slen() { return "hello".length; }
slen();                               // → 5

function sli() { return "hello".slice(1, 3); }
sli();                                // → "el"
```

```text
=== upper ===

Case "call@L2": () => "HELLO"
```

`toUpperCase`, `toLowerCase`, `slice`, and `.length` produce exact literals. `split` and `indexOf` are not modeled yet and yield `unknown`.

### Loops with Concrete Bounds

A `for` loop with a concrete bound evaluates to its exact result.

```js
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + i;
  }
  return sum;
}
sumTo(5);
```

```text
=== sumTo ===

Case "call@L8": (5) => 10
```

`for...of` over a concrete array evaluates the same way:

```js
function sumArr(arr) {
  let s = 0;
  for (const x of arr) {
    s = s + x;
  }
  return s;
}
sumArr([1, 2, 3]);                    // → 6
```

### `break` Keeps the Exiting Value

Loop jumps are signals: the value bound in the exiting iteration is preserved.

```js
function findBig() {
  let found;
  for (const x of [1, 2, 3, 4]) {
    if (x > 2) {
      found = x;
      break;
    }
  }
  return found;
}
findBig();
```

```text
=== findBig ===

Case "call@L11": () => 3
```

The result is the literal `3` — the value bound when the loop broke.

### `Object.keys` on a Concrete Shape

`Object.keys` on a concrete object returns the exact key tuple.

```js
function keysOf() { return Object.keys({ port: 3000, host: "x" }); }
keysOf();
```

```text
=== keysOf ===

Case "call@L2": () => ["port", "host"]
```

### Recursion Unrolls per Call Site

A recursive function is evaluated per observed call: each top-level call is fully unrolled and reported as its own `call@` case with the exact result.

```js
function walk(n) {
  if (n <= 0) return 0;
  return n + walk(n - 1);
}

walk(0);
walk(1);
walk(2);
```

```text
=== walk ===

Case "call@L6": (0) => 0
Case "call@L7": (1) => 1
Case "call@L8": (2) => 3

Combined: 0 | 1 | 3
```

More calls than the precise-case cap aggregate into a `call@symbolic` case with widened arguments instead.

### Narrowing Guards

`===` comparisons, `typeof`, `Array.isArray`, and `switch` narrow per concrete call site — see [Control Flow Narrowing](./control-flow-narrowing.md) for the verified patterns.

## Not Modeled Yet

These constructs currently evaluate to `unknown` (often with a `nudo:unknown-recv` or `nudo:builtin-unknown` diagnostic). Prefer the modeled alternatives listed beside each one.

| Construct | Behavior today | Modeled alternative |
|---|---|---|
| `this` in method calls | `circle.area()` with `return this.radius` is not collected as a call site (member callees produce no `call@` case) and `this.radius` evaluates to `unknown` (`nudo:unknown-recv`) — on both the call-site and `@nudo:case` paths | plain parameters: `function area(circle) { return circle.radius * circle.radius; }` |
| `==` / `!=` literal folding | `1 == "1"` → `unknown` | `===` comparisons on literals |
| Primitive autoboxing | `"nudo".constructor` → `unknown` | `.length`, string methods above |
| `Object.prototype` methods | `({}).hasOwnProperty("key")` → `unknown` | `Object.keys(...)` / shape checks |
| `Symbol.iterator in x` | → `unknown` | `Array.isArray(x)` |
| `for...of` over `Set` / `Map` | elements → `unknown` | arrays / `.map` callbacks |
| Promise executor | `new Promise((r) => r("done"))` → `Promise<unknown>` | `@nudo:mock` + `async` functions |
| Per-iteration `let` closures | `fns[i]()` → `unknown` | direct iteration results |
| `arguments` | → `unknown` (`nudo:builtin-unknown`) | named parameters |
| `JSON.parse` | `JSON.parse('{"port": 3000}')` → `unknown` | object literals |
| `String.fromCharCode` | → `unknown` | string literals |
| Exponentiation `**` | → `unknown` | `x * x` |
| `Math.*` in `@nudo:case` evaluation | `Math.sqrt(9)` → `unknown` | call sites (`sqrtOf(9)` → `3`) |

## Summary

| Capability | Example | Result |
|---|---|---|
| String methods | `"hello".toUpperCase()` | `"HELLO"` |
| Concrete-bound loops | `sumTo(5)` | `10` |
| `break` | loop exit value | `3` |
| `Object.keys` | concrete shape | `["port", "host"]` |
| Recursion | `walk(2)` | `3` |
| Narrowing | `typeof` / `===` / `Array.isArray` / `switch` | per-call-site precision |
