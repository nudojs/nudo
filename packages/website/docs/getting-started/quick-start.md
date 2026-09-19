---
sidebar_position: 2
description: "Infer your first types in minutes: write plain JavaScript with call sites and run npx nudojs infer. Contracts live in *.nudo.js sidecars."
---

# Quick Start

This guide walks through inferring types from a JavaScript file. Nudo is Abs-native: production analysis executes **observed call sites** under abstract interpretation. Contracts come from `*.nudo.js` sidecars and `@nudo:refine` / `@nudo:interface`. `@nudo:case` is a debug / `nudo test` sub-layer — not the contract product.

## 1. Create a JavaScript file

Create `math.js` with a function and call sites (no directives required):

```javascript
export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);
```

Call sites are the evidence Nudo executes. Optional contracts and debug witnesses are separate surfaces — see below.

## 2. Run inference

From the project directory:

```bash
npx nudojs infer math.js
```

## 3. Output

```text
=== subtract ===

call@L6: (5, 3) => 2
call@L7: (1, 10) => -9

Observed: 2 | -9
```

Each `call@L…` line is one observed call-site fact (line of the call). When a function has more than one observation, `Observed:` prints the join of the results, simplified by absorption — a literal whose base type is already in the union is absorbed (e.g. `2 | -9 | number` collapses to `number`); pure-literal unions keep every literal.

## Options

- **`--dts`** — Generate a `.d.ts` declaration file next to the source:

  ```bash
  npx nudojs infer math.js --dts
  ```

  After the standard output above, the CLI prints:

  ```text
  Generated: math.d.ts
  ```

  The generated `math.d.ts` contains a single widened signature per function, with concrete observations preserved in the JSDoc:

  ```typescript
  /**
   * Case: call@L6 (5, 3) => 2
   * Case: call@L7 (1, 10) => -9
   * @param a - number
   * @param b - number
   * @returns number
   */
  export declare function subtract(a: number, b: number): number;
  ```

- **`--loc`** — Show source locations in the output:

  ```bash
  npx nudojs infer math.js --loc
  ```

  ```text
  === subtract (math.js:1:0) ===

  call@L6: (5, 3) => 2
  call@L7: (1, 10) => -9

  Observed: 2 | -9
  ```

## Watch mode

To re-run inference when files change:

```bash
npx nudojs watch .
```

Use `--dts` to generate `.d.ts` files on each change:

```bash
npx nudojs watch . --dts
```

Watch recursively scans every `.js`, `.mjs`, and `.ts` file under the directory (excluding `node_modules`) — including files without directives.

## Functions without call sites

A function that no analyzed code calls still gets an `entry@L` observation so its signature is emitted, with parameters defaulting to `unknown`:

```text
=== addPrefix ===

entry@L1: (unknown, unknown) => unknown
# no call sites found; parameters default to unknown
```

To upgrade directive-free code to real call shapes, harvest cases from your tests with `--callsites` — see the [Call-Site Discovery guide](../guides/callsite-discovery.md).

## Debug witnesses (`@nudo:case`)

`@nudo:case` is **debug / `nudo test` only** — scenario witnesses you execute by hand or assert in CI. It is not the interface product. Args are concrete values or constraint builders (`number()`, `lit(42)`, `shape({...})`, `union(...)`, `array(...)`):

```javascript
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (number(), number())
 */
function subtract(a, b) {
  return a - b;
}
```

```text
=== subtract ===

debug "positive numbers": (5, 3) => 2
debug "negative result": (1, 10) => -9
debug "symbolic": (number, number) => number

Observed: number
```

Named witnesses print as `debug "name": (…) => …`. A symbolic witness contributes a base type (`number`), which absorbs the literal results in `Observed:`.

## What happened?

1. **Parse** — Nudo parsed the file and found the `subtract` function (and any call sites / directives).
2. **Execute** — For each observation, it ran the function body under abstract interpretation: operands like `a - b` were evaluated with Abs values.
3. **Join** — Multiple observations are joined into `Observed:`, simplified by absorption.

For deeper detail on Abs, directives, and abstract interpretation, see [Core Concepts](../concepts/type-values.md).

## Refinement contracts (no type syntax)

Beyond inference, declare **refinements** that enter Abs and participate in algebra. No `interface` / `type` — contracts live in `*.nudo.js` templates.

Create `shapes.nudo.js`:

```javascript
import { number, string, shape } from "@nudojs/core";

export const positive = number().gt(0);
export const user = shape({
  id: number().gt(0),
  name: string(),
});
```

Create `app.js`:

```javascript
/// @nudo:import { positive, user } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;
}

/**
 * @nudo:refine u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}

inc(1);                              // ok
// inc(0);                          // error: 0 ⊭ x > 0
register({ id: 1, name: "ada" });    // ok
// register({ id: -1, name: "a" }); // error: u.id ⊭ > 0
```

Gate with:

```bash
npx nudojs check app.js
```

Reports use `actual ⊭ expected`. Refinements also flow into inference: `inc` with `@nudo:refine x positive` infers `number = (x + 1) where (x + 1) > 1`.

See [nudo check](../guides/check.md) and [Directives](../concepts/directives.md#nudorefine--refinement-contract).

## Existing JavaScript packages

If you already have logic without annotations, do not start from directives — draft contracts from the code first, then tighten:

- Guide: [Migrating existing JS](../guides/migrating-js.md)
- Sample: [`docs/examples/interface-draft/`](https://github.com/nudojs/nudo/tree/main/docs/examples/interface-draft)
- Repo demo: `pnpm run migrate-demo`
