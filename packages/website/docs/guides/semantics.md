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

`toUpperCase`, `toLowerCase`, `slice`, `.length`, and `split` (literal receiver and separator) produce exact results — `"a,b,c".split(",")` folds to `["a", "b", "c"]` at the call site, and a comma-free receiver like `"abc".split("b")` folds to `["a", "c"]` under an `@nudo:case` directive. The directive path cannot express a comma-containing receiver: the directive parser splits case arguments on commas, so `@nudo:case "split" ("a,b,c")` arrives as three `unknown` parameters rather than one string. Prefix/suffix/membership checks — `startsWith`, `endsWith`, `includes` — fold to a definite boolean on literal receivers. `indexOf` yields the `number` primitive without the literal index.

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

### Math Methods

`Math` methods on literal numeric arguments fold at evaluation time — on both the call-site and `@nudo:case` paths.

```js
function root(n) { return Math.sqrt(n); }
root(9);
```

```text
=== root ===

Case "call@L2": (9) => 3
```

`sqrt`, `pow`, `abs`, `floor`, `ceil`, `round`, `sign`, `min`, and `max` all fold to their exact numeric result on literal arguments; symbolic arguments widen to `number`.

### Primitive Conversions & Parsing

The global coercion constructors and numeric parsers fold literals to exact results at the call site and under `@nudo:case` alike:

```js
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

```text
=== strOf ===

Case "call@L2": (5) => "5"
```

`String(x)`, `Number(x)`, and `Boolean(x)` fold number/string/boolean literals to the exact coerced literal; `parseInt(s)` / `parseFloat(s)` fold string/number literals to the exact numeric prefix/parse. Symbolic arguments widen to the target primitive (`string` / `number` / `boolean`). Repo example (CI-pinned): [`docs/examples/algebra/l-primitive-conversion.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/l-primitive-conversion.js).

### Method Calls and `this`

Method calls made inside an analyzed function bind `this` to the receiver — on both the call-site and `@nudo:case` paths.

```js
class Circle {
  constructor(r) { this.radius = r; }
  area() { return this.radius * this.radius; }
}

function compute(r) {
  const circle = new Circle(r);
  return circle.area();
}
compute(5);
```

```text
=== compute ===

Case "call@L11": (5) => 25
```

The directive path is equally precise when the argument is a literal (`@nudo:case "member" (5)` → `(5) => 25`); with an empty argument list (`()`) the parameter is `unknown`, so the result degrades to `unknown #partial`. The remaining gap is call-site *collection*, not evaluation: a bare top-level member call (`circle.area()` as a statement) produces no `call@` case — member callees are not collected as call sites. Wrap the member call in a function to see it.

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
| `==` / `!=` literal folding | `1 == "1"` → `unknown` | `===` comparisons on literals |
| Primitive autoboxing | `"nudo".constructor` → `unknown` | `.length`, string methods above |
| `Object.prototype` methods | `({}).hasOwnProperty("key")` → `unknown` | `Object.keys(...)` / shape checks |
| `Symbol.iterator in x` | → `unknown` | `Array.isArray(x)` |
| `for...of` over `Set` / `Map` | elements → `unknown` | arrays / `.map` callbacks |
| Promise executor | `new Promise((r) => r("done"))` → `Promise<unknown>` | `@nudo:mock` + `async` functions |
| `try`/`catch` parameter | `catch (err)` → `err` is `unknown` (`nudo:builtin-unknown`) | deterministic `return` in `try` (no throw point) folds to exact |
| Per-iteration `let` closures | `fns[i]()` → `unknown` | direct iteration results |
| `arguments` | → `unknown` (`nudo:builtin-unknown`) | named parameters |
| `JSON.parse` | `JSON.parse('{"port": 3000}')` → `unknown` | object literals |
| `String.fromCharCode` | → `unknown` | string literals |
| Exponentiation `**` | → `unknown` | `x * x` |

## Summary

| Capability | Example | Result |
|---|---|---|
| String methods | `"hello".toUpperCase()` | `"HELLO"` |
| Concrete-bound loops | `sumTo(5)` | `10` |
| `break` | loop exit value | `3` |
| `Object.keys` | concrete shape | `["port", "host"]` |
| Recursion | `walk(2)` | `3` |
| Narrowing | `typeof` / `===` / `Array.isArray` / `switch` | per-call-site precision |
