---
sidebar_position: 2
description: "Infer your first types in minutes: add @nudo:case directives to a JavaScript file and run npx nudo infer."
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
npx nudo infer math.js
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
  npx nudo infer math.js --dts
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
  npx nudo infer math.js --loc
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
npx nudo watch .
```

Use `--dts` to generate `.d.ts` files on each change:

```bash
npx nudo watch . --dts
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
npx nudo infer utils.js
```

```text
=== formatPrice ===

Case "call@L5": (1999) => `$${string}`
```

The case is named `call@L5` after the line of the call — `console.log(formatPrice(1999))` sits on line 5 of `utils.js`. A function that no analyzed code calls still gets an `entry@L` case so its signature is emitted, with parameters defaulting to `unknown`:

```text
=== addPrefix ===

Case "entry@L1": (unknown, unknown) => `${unknown}: ${unknown}`
# no call sites found; parameters default to unknown
```

To upgrade directive-free code to real call shapes, harvest cases from your tests with `--callsites` — see the [Call-Site Discovery guide](../guides/callsite-discovery.md).

## What happened?

1. **Parse** — Nudo parsed the file and found the `subtract` function with `@nudo:case` directives.
2. **Execute** — For each case, it ran the function body using abstract interpretation: operands like `a - b` were evaluated with type values instead of concrete numbers.
3. **Combine** — With multiple cases, Nudo merged the inferred return types into a union, then simplified it by absorption: the literals `2` and `-9` are absorbed by the `number` contributed by the symbolic case, yielding `number`. Pure-literal unions without a base-type member keep every literal.

For deeper detail on type values, directives, and abstract interpretation, see [Core Concepts](../concepts/type-values.md).
