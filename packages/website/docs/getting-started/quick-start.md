---
sidebar_position: 2
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

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: 2 | -9 | number
```

Nudo executed the function three times — twice with concrete inputs, once with symbolic `T.number` for both arguments. `Combined` is the union of all case results: the concrete cases contribute their literal results (`2`, `-9`), and the symbolic case contributes `number`.

## Options

- **`--dts`** — Generate a `.d.ts` declaration file next to the source:

  ```bash
  npx nudo infer math.js --dts
  ```

  After the standard output above, the CLI prints:

  ```text
  Generated: math.d.ts
  ```

  The generated `math.d.ts` contains one declaration per case:

  ```typescript
  export declare function subtract(arg0: 5, arg1: 3): 2;
  export declare function subtract(arg0: 1, arg1: 10): -9;
  export declare function subtract(arg0: number, arg1: number): number;
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

  Combined: 2 | -9 | number
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

Watch recursively scans every `.js` file under the directory (excluding `node_modules`) — including files without directives.

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

To upgrade directive-free code to real call shapes, harvest cases from your tests with `--callsites` — see the [Call-Site Discovery guide](/docs/guides/callsite-discovery).

## What happened?

1. **Parse** — Nudo parsed the file and found the `subtract` function with `@nudo:case` directives.
2. **Execute** — For each case, it ran the function body using abstract interpretation: operands like `a - b` were evaluated with type values instead of concrete numbers.
3. **Combine** — With multiple cases, Nudo merged the inferred return types into a union: `2 | -9 | number`. Literal results from concrete cases are kept as-is and unioned with the symbolic case's `number`.

For deeper detail on type values, directives, and abstract interpretation, see [Core Concepts](/docs/concepts/type-values).
