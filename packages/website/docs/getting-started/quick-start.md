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

Combined: number
```

Nudo executed the function three times — twice with concrete inputs, once with symbolic `T.number` for both arguments. It inferred that `subtract` always returns a number and combined the results.

## Options

- **`--dts`** — Generate a `.d.ts` declaration file next to the source:

  ```bash
  npx nudo infer math.js --dts
  ```

- **`--loc`** — Show source locations in the output:

  ```bash
  npx nudo infer math.js --loc
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

## What happened?

1. **Parse** — Nudo parsed the file and found the `subtract` function with `@nudo:case` directives.
2. **Execute** — For each case, it ran the function body using abstract interpretation: operands like `a - b` were evaluated with type values instead of concrete numbers.
3. **Combine** — With multiple cases, Nudo merged the inferred return types into a union (or a single type when they match).

For deeper detail on type values, directives, and abstract interpretation, see [Core Concepts](/docs/concepts/type-values).
