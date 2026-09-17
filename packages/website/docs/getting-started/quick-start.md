---
sidebar_position: 2
description: "Infer your first types in minutes: add @nudo:case directives to a JavaScript file and run npx nudojs infer."
---

# Quick Start

This guide walks through inferring types from a JavaScript file using Nudo directives and the CLI.

## 1. Create a JavaScript file

Create `math.js` with a function and `@nudo:case` directives:

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

Each `@nudo:case` provides a named input for Nudo to execute with. You can use:

- **Concrete values** like `(5, 3)` or `("hello")`
- **Symbolic type values** like `(T.number, T.number)` or `T.union(T.string, T.number)`

## 2. Run inference

From the project directory:

```bash
npx nudojs infer math.js
```

## 3. Output

```text
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

Nudo executed the function three times — twice with concrete inputs, once with symbolic `T.number` for both arguments. `Combined` is the union of all case results, simplified by absorption: the symbolic case already contributes `number`, so the literal results `2` and `-9` are absorbed — `2 | -9 | number` collapses to `number`. Pure-literal unions without a base-type member keep every literal.

## Options

- **`--dts`** — Generate a `.d.ts` declaration file next to the source:

  ```bash
  npx nudojs infer math.js --dts
  ```

  After the standard output above, the CLI prints:

  ```text
  Generated: math.d.ts
  ```

  The generated `math.d.ts` contains a single widened signature per function, with the concrete cases preserved in the JSDoc:

  ```typescript
  /**
   * Case: positive numbers (5, 3) => 2
   * Case: negative result (1, 10) => -9
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
  === subtract (math.js:6:0) ===

  Case "positive numbers": (5, 3) => 2
  Case "negative result": (1, 10) => -9
  Case "symbolic": (number, number) => number

  Combined: number
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

## Functions without directives

Functions without `@nudo:case` directives are not skipped either. The CLI runs whole-program inference: a function that is called somewhere in the analyzed code gets a synthesized case from the call site, carrying the argument types actually observed there.

Create `utils.js` — no `@nudo:` directives anywhere:

```javascript
function formatPrice(cents) {
  return "$" + (cents / 100).toFixed(2);
}

console.log(formatPrice(1999));
```

```bash
npx nudojs infer utils.js
```

```text
=== formatPrice ===

Case "call@L5": (1999) => unknown
```

The case is named `call@L5` after the line of the call — `console.log(formatPrice(1999))` sits on line 5 of `utils.js`. The division `cents / 100` yields `number` and `toFixed` is not modeled yet, so the result is `unknown`. A function that no analyzed code calls still gets an `entry@L` case so its signature is emitted, with parameters defaulting to `unknown`:

```text
=== addPrefix ===

Case "entry@L1": (unknown, unknown) => unknown
# no call sites found; parameters default to unknown
```

To upgrade directive-free code to real call shapes, harvest cases from your tests with `--callsites` — see the [Call-Site Discovery guide](../guides/callsite-discovery.md).

## What happened?

1. **Parse** — Nudo parsed the file and found the `subtract` function with `@nudo:case` directives.
2. **Execute** — For each case, it ran the function body using abstract interpretation: operands like `a - b` were evaluated with type values instead of concrete numbers.
3. **Combine** — With multiple cases, Nudo merged the inferred return types into a union, then simplified it by absorption: the literals `2` and `-9` are absorbed by the `number` contributed by the symbolic case, yielding `number`. Pure-literal unions without a base-type member keep every literal.

For deeper detail on type values, directives, and abstract interpretation, see [Core Concepts](../concepts/type-values.md).

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
