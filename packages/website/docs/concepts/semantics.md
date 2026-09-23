---
description: Learn the JavaScript semantics Nudo's evaluator models precisely today — string methods, for-of, break, Object.keys, recursion — and the constructs that still degrade to unknown.
---

# Language Semantics

Nudo infers types by *executing* your code with symbolic values, so the quality of inference is exactly the quality of the evaluator's JavaScript semantics. This guide lists the language behaviors the evaluator models precisely on the call-site path — every output block below is excerpted from a real `nudo test` run of the code above it (the `nudo test <file>` header and the assertions summary are elided) — followed by the constructs that still degrade to `unknown` (inference failed / engine debt, **not** the default for unconstrained entry params, which display as `any`) and should be verified before you rely on them. Precise semantics are also what make [call-site discovery](../guides/callsite-discovery.md) effective: harvested call shapes only pay off if the evaluator can actually follow them.

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

  call@L2  () => "HELLO"
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

  call@L8  (5) => 10
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

  call@L11  () => 3
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

  call@L2  () => ["port", "host"]
```

### Math Methods

`Math` methods on literal numeric arguments fold at evaluation time — on both the call-site and `@nudo:case` paths.

```js
function root(n) { return Math.sqrt(n); }
root(9);
```

```text
=== root ===

  call@L2  (9) => 3
```

`sqrt`, `pow`, `abs`, `floor`, `ceil`, `round`, `sign`, `min`, and `max` all fold to their exact numeric result on literal arguments; symbolic arguments widen to `number`.

### Collections (Set / Map iteration, Symbol.iterator)

`for...of` over a concrete `Set` / `Map` folds element-wise, and the `Symbol.iterator in x` protocol probe folds to a definite boolean on a known receiver:

```js verify
function firstSet() {
  const seen = new Set(["a", "b"]);
  for (const x of seen) return x;
}
firstSet();

function firstMap() {
  const m = new Map([["k", 1]]);
  for (const [k, v] of m) return v;
}
firstMap();

function hasIter(x) { return Symbol.iterator in x; }
hasIter([1]);
```

```text
=== firstSet ===

  call@L5  () => "a"

=== firstMap ===

  call@L11  () => 1

=== hasIter ===

  call@L14  ([1]) => boolean
```

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

  call@L2  (5) => "5"
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

  call@L11  (5) => 25
```

The directive path is equally precise when the argument is a literal (`@nudo:case "member" (5)` → `(5) => 25`); with an empty argument list (`()`) the parameter is `unknown`, so the result degrades to `unknown #partial`. Member calls (`circle.area()`, `obj.method()`) are collected as call sites (`Class.method` / bare `method`) and synthesize `call@` cases the same way named calls do.

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

  call@L6  (0) => 0
  call@L7  (1) => 1
  call@L8  (2) => 3

```

More calls than the precise-case cap aggregate into a `call@symbolic` case with widened arguments instead.

### Literal Equality, `JSON.parse`, Number Formatting, `**`

More literal folds the evaluator performs on the call-site path and under `@nudo:case`:

```js
function eqCheck() { return 1 == "1"; }
eqCheck();                            // → true

function jp() { return JSON.parse('{"port": 3000}'); }
jp();                                 // → { port: 3000 }

function fixed(cents) { return (cents / 100).toFixed(2); }
fixed(1050);                          // → "10.50"

function pow(x) { return x ** 2; }
pow(3);                               // → 9
```

- `==` / `!=` fold on literal operands (`1 == "1"` → `true`, `1 != "1"` → `false`).
- `JSON.parse` on a literal string folds to the parsed object shape.
- `toFixed` folds on literal receivers (`"10.50"`); symbolic receivers widen to `string`.
- `**` folds on literal operands (`3 ** 2` → `9`); symbolic operands widen to `number`.
- `try`/`catch` is **modeled**: `catch (err)` binds the thrown Abs, so `throw new Error("boom")` then `err.message` evaluates to `"boom"`.
- `String.fromCharCode(...)` folds literal code points via ToUint16 (`String.fromCharCode(65, 66)` → `"AB"`); symbolic arguments widen to `string`.
- `Object.prototype` methods are **modeled**: `hasOwnProperty` / `isPrototypeOf` / `propertyIsEnumerable` / `valueOf` / `toString` decide own slots / indices / `length` / holes on concrete shapes, tuples, arrays, and string boxing; `Object.prototype.hasOwnProperty.call(o, k)` has the same semantics; `Object.create(null)` has none of these methods (`TypeError`).
- `Symbol()` / `Symbol("desc")` produce non-concrete unique symbols: `typeof` is `"symbol"`, `.description` is a literal or `undefined`, two `Symbol()` values are not `===` while the same reference is; `String(sym)` yields `Symbol(desc)` and implicit `ToString` (`+` / template) throws `TypeError`.

### Narrowing Guards

`===` comparisons, `typeof`, `Array.isArray`, and `switch` narrow per concrete call site — see [Control Flow Narrowing](./control-flow-narrowing.md) for the verified patterns.

## Not Modeled Yet

These constructs currently evaluate to `unknown` (often with a `nudo:unknown-recv` or `nudo:builtin-unknown` diagnostic). Prefer the modeled alternatives listed beside each one.

| Construct | Behavior today | Modeled alternative |
|---|---|---|
| Primitive autoboxing | `"nudo".constructor` → `unknown` | `.length`, string methods above |
| Promise executor | `new Promise((r) => r("done"))` → `promise<unknown>` | `@nudo:mock` + `async` functions |
| Arrow `arguments` without a direct outer reference | → `unknown` (see `arguments` below) | named parameters |

### Modeled: `arguments` (strict/ESM)

`arguments` is a **modeled** array-like object (tuple projection) inside non-arrow functions:

| Pattern | Result |
|---|---|
| `arguments.length` | exact actual-argument count (defaults/rest do not inflate it) |
| `arguments[i]` | i-th actual argument; out-of-range → `undefined` |
| `typeof arguments` | `"object"` |
| `[...arguments]` / `Array.from(arguments, mapFn)` | expands the actual argument list |
| `Array.from(arguments).join(sep)` | expands; join folding stays abstract `string` (existing array-join model) |
| Write `arguments[i] = v` | does **not** write formal parameters |
| Write a formal parameter | does **not** write `arguments[i]` |
| Arrow `() => arguments…` | inherits the enclosing non-arrow `arguments` when that function also references `arguments` directly; otherwise honest `unknown` |
| Default params | `arguments.length` counts actual args only (`f()` + `f(a=1)` → `0`) |
| Rest params | `arguments.length` is the actual count; rest binding is unchanged |

Nudo analysis follows **ESM/strict** semantics: `arguments` and formal parameters are **independent** mappings. Sloppy-mode non-strict functions use a mapped `arguments` object (writes on either side are reflected on the other) — that is intentionally not modeled.

### Modeled: per-iteration `let` closures

`for (let i = …)` creates a **fresh binding per iteration**; closures capture that iteration's `i` (`fns.push(() => i)` then `fns[0]()` / `fns[1]()` / `fns[2]()` fold to `0` / `1` / `2`). `for (var i = …)` keeps a **shared** binding (all closures see the final value). `forEach((x) => …)` callback parameters are per-callback (unchanged). Abstract-bound loops still join conservatively at `$for` exits — no false-precise capture.

## Mock boundary (still recommended)

Env modules and the `@types` harvester cover a large slice of common Node/Web APIs. They do **not** remove the need for mocks everywhere. Categories that are still **recommended for handwritten mock** (or that remain honest `unknown` / `entry@` results) — aligned with the call-site ceiling in `docs/design/limitations.md` §2:

| Category | Why mock / why unknown | Workaround |
|---|---|---|
| Native bindings | `child_process.spawn`, native addons — env may hold a signature (ChildProcess pid/stdio/kill), not side effects | `@nudo:mock` or treat return as opaque |
| Dynamic `require` | Literal / constant-folded specs resolve; computed specs stay honest `unknown` + `nudo:builtin-unknown` | `@nudo:mock-module` / static import |
| Stream machine callbacks | Node Transform internals are driven by the runtime; no call-site record to harvest | Mock the stream factory; do not expect internal callbacks to infer |
| Dual-entry browser/node variants | Call-site records do not cross files (attribution is file-scoped) | Analyze the entry you ship; mock the other |
| No call-site functions | `entry@` fallback when tests never touch an internal helper | Add a call site, or accept `entry@` as the honest result |
| Promise executor internals | `new Promise((r) => r(...))` → `promise<unknown>` without mock | `@nudo:mock` + async wrappers |

Coverage baselines (`pnpm run coverage:env` → `docs/reports/env-coverage-baseline.md`) report **resolution rate**, not completeness. Do not read a high resolved ratio as a soundness guarantee — see the mock boundary in the [harvester API](../api/harvester.md#mock-boundary-honest) as well.

## Summary

| Capability | Example | Result |
|---|---|---|
| String methods | `"hello".toUpperCase()` | `"HELLO"` |
| Concrete-bound loops | `sumTo(5)` | `10` |
| `break` | loop exit value | `3` |
| `Object.keys` | concrete shape | `["port", "host"]` |
| Recursion | `walk(2)` | `3` |
| Literal folds | `1 == "1"` · `JSON.parse('{"port": 3000}')` · `3 ** 2` | `true` · `{ port: 3000 }` · `9` |
| Narrowing | `typeof` / `===` / `Array.isArray` / `switch` | per-call-site precision |
