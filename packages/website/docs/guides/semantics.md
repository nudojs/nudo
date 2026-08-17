---
sidebar_position: 9
---

# Language Semantics

Nudo infers types by *executing* your code with symbolic values, so the quality of inference is exactly the quality of the evaluator's JavaScript semantics. This guide lists the language behaviors Nudo models precisely — each one is a construct that previously degraded to `unknown` and now infers a concrete result. These capabilities are also what make [call-site discovery](/docs/guides/callsite-discovery) effective: harvested call shapes only pay off if the evaluator can actually follow them.

## `this` Binding

Method calls pass the receiver, so instance shapes flow into the body.

```js
function area() {
  return this.radius ** 2;
}

area.call({ radius: 3 });      // → 9
const circle = { radius: 5, area };
circle.area();                 // → 25
```

`obj.f()` binds `this` to the inferred type of `obj`; `f.call(thisArg)` and `f.apply(thisArg, args)` bind the explicit receiver the same way.

## Primitive Autoboxing and `Object.prototype`

Property access on a primitive goes through its wrapper, and every object carries the `Object.prototype` method table.

```js
"nudo".constructor;                 // → String constructor, not unknown
({}).hasOwnProperty("key");         // → boolean
config.hasOwnProperty("port");      // → resolves for any object shape
```

`hasOwnProperty`, `toString`, `valueOf` and friends resolve on arbitrary object shapes instead of widening the result to `unknown`.

## `Symbol.iterator in x`

The `in` operator decides iterability at the literal level, so it can drive narrowing.

```js
Symbol.iterator in [1, 2, 3];   // → true
Symbol.iterator in "nudo";      // → true
Symbol.iterator in 42;          // → false
```

Inside `if (Symbol.iterator in x)`, the true branch keeps only the iterable members of a union.

## `for...of` over `Set` and `Map`

Iterating built-in collections yields precisely typed elements — including destructured entries.

```js
const tags = new Set(["a", "b"]);
for (const t of tags) {
  t;                            // → "a" | "b"
}

const scores = new Map([["ok", 1], ["warn", 2]]);
for (const [status, code] of scores.entries()) {
  status;                       // → "ok" | "warn"
  code;                         // → 1 | 2
}
```

## Promise Resolution

The `new Promise` executor runs under evaluation, and resolve sites are also found by a static scan of nested closures — so a `resolve(value)` buried in a `setTimeout` callback still fixes the resolved type.

```js
const p = new Promise((resolve) => {
  setTimeout(() => resolve("done"), 10);
});
// p → Promise<"done">
```

Chaining `.finally(...)` takes a snapshot instead of poisoning the type: the promise stays `Promise<"done">` rather than widening to `unknown`.

## `break` and `continue`

Loop jumps are signals, not control-flow dead ends — the exiting iteration's state is preserved.

```js
let found;
for (const x of [1, 2, 3, 4]) {
  if (x > 2) {
    found = x;
    break;
  }
}
found;                          // → 3
```

`continue` cuts the current iteration path without polluting accumulators; `break` keeps the precise values from the iteration that exited.

## Per-Iteration `let` Bindings

Every round of a `for (let ...)` loop gets a fresh binding, and closures capture that round's copy — matching real JavaScript semantics.

```js
const fns = [];
for (let i = 0; i < 3; i++) {
  fns.push(() => i);
}

fns[0]();                       // → 0
fns[2]();                       // → 2
```

The engine does not collapse all closures to the final value of `i`.

## `arguments` as a Tuple

Inside a call, `arguments` is a tuple of the actual argument values.

```js
function logAll() {
  return arguments.length;
}

logAll("a", "b", "c");          // → 3
```

`arguments.length`, indexing (`arguments[0]`), and spread all see the concrete argument types of the recorded call.

## Literal Evaluation of Built-ins

Calls with literal arguments evaluate exactly instead of returning a generic type.

```js
JSON.parse('{"port": 3000}');       // → { port: 3000 }
String.fromCharCode(72, 105);       // → "Hi"
```

Parsed JSON keeps its structure with literal member types; character codes join into an exact string.

## Recursion Budget

Deep recursion truncates at a budget and falls back to the union of returns observed so far — a graceful degradation instead of `unknown`.

```js
function walk(n) {
  if (n <= 0) return 0;
  return n + walk(n - 1);
}

walk(5);                        // → 15 (fully evaluated)
walk(10_000);                   // → number (budget hit; union of observed returns)
```

## `Object.keys` Union Distribution

When the receiver is a union of object shapes, `Object.keys` distributes over each member and unions the key sets.

```js
function firstKey(shape) {
  // shape: { port: number } | { host: string }
  return Object.keys(shape)[0];
}
// → "port" | "host"
```

## Summary

| Capability | Example | Result |
|---|---|---|
| `this` binding | `circle.area()` | Receiver shape flows into the body |
| Autoboxing | `"nudo".constructor` | Wrapper brand, not `unknown` |
| Iterability check | `Symbol.iterator in x` | Literal `true` / `false` |
| Collection iteration | `for (const [k, v] of map.entries())` | Precise element types |
| Promise resolution | `new Promise((res) => setTimeout(() => res("done")))` | `Promise<"done">` |
| Loop jumps | `break` / `continue` | Exiting iteration state preserved |
| Per-iteration `let` | `fns[i]()` captures round's `i` | `0`, `2` — not final value |
| `arguments` | `arguments.length` | Tuple of actual args |
| Literal built-ins | `JSON.parse('{"port": 3000}')` | `{ port: 3000 }` |
| Recursion budget | `walk(10_000)` | Observed union, not `unknown` |
| `Object.keys` | Union receiver | Union of key literals |
