---
sidebar_position: 1
---

# CLI Usage

The `nudo` CLI is the primary way to run type inference on JavaScript files. Install it globally or via `npx`:

```bash
npm install -g @nudojs/cli
# or
pnpm add -g @nudojs/cli
```

## `nudo infer`

Infer types from a single JavaScript file. Functions with `@nudo:case` directives use them; every other function is still analyzed (whole-program inference) — observed calls become synthesized `call@L` cases, and functions with no call evidence get an `entry@L` case whose parameters default to `unknown`.

```bash
nudo infer <file>
```

`<file>` must be a single `.js` file — passing a directory fails with `EISDIR`. Use [`nudo watch`](#nudo-watch) for directories or a shell loop for many files.

### Options

| Option | Description |
|--------|-------------|
| `--dts` | Generate a `.d.ts` declaration file next to the source file |
| `--loc` | Show source locations (file:line:column) in the output |
| `--json` | Output results as structured JSON (see the [JSON example](/docs/api/cli-reference#nudo-infer)) |
| `--callsites <paths...>` | Mine usage sites (tests, examples, apps) for real argument shapes and synthesize cases from them — see [Call-Site Discovery](/docs/guides/callsite-discovery) |

### Examples

Given `math.js`:

```js
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (T.number, T.number)
 */
export function subtract(a, b) {
  return a - b;
}
```

Basic inference:

```bash
nudo infer math.js
```

Output:

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: 2 | -9 | number
```

The combined type keeps literal members (`2 | -9 | number`), so callers see exactly which concrete results the cases produced.

Generate TypeScript declaration file:

```bash
nudo infer math.js --dts
```

This creates `math.d.ts` alongside your source file with inferred function signatures.

Show source locations:

```bash
nudo infer src/math.js --loc
```

Output includes location information:

```
=== subtract (src/math.js:6:0) ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: 2 | -9 | number
```

### Functions without directives

Functions without `@nudo:case` directives are still inferred from how they are used. With no recorded call, parameters default to `unknown` and the case is named `entry@<line>`:

```js
// src/plain.js
export function add(a, b) {
  return a + b;
}
```

```bash
nudo infer src/plain.js
```

```
=== add ===

Case "entry@L1": (unknown, unknown) => number | string
# no call sites found; parameters default to unknown
```

When the analyzed file calls an imported function, each observed call becomes a synthesized `call@<line>` case with the real argument shapes:

```js
// src/main.js
import { add } from "./plain.js";

console.log(add(2, 3));
console.log(add("2", "3"));
```

```bash
nudo infer src/main.js
```

```
--- src/plain.js (imported) ---

=== add ===

Case "call@L3": (2, 3) => 5
Case "call@L4": ("2", "3") => "23"

Combined: 5 | "23"
```

To harvest argument shapes from separate usage-site files (tests, examples, apps), pass them with `--callsites` — see [Call-Site Discovery](/docs/guides/callsite-discovery).

---

## `nudo check`

Check a single JavaScript file for type errors and print one line per diagnostic, in the form `[severity] path:line:column message (error-code)`. `check` exits with code `1` when any error-level diagnostic is found — warnings alone keep the exit code at `0` — which makes it suitable for CI.

```bash
nudo check <file>
```

### Example

```bash
nudo check src/broken.js
```

```
[warning] src/broken.js:2:9 Cannot resolve 'name' on unknown value (nudo:unknown-recv)
[warning] src/broken.js:2:9 Cannot resolve 'toUpperCase' on unknown value (nudo:unknown-recv)
```

A file with no diagnostics prints:

```
No issues found.
```

A failed `@nudo:returns` assertion is error-level and makes `check` exit with `1`:

```bash
nudo check src/assert.js
```

```
[error] src/assert.js:5:0 @nudo:returns assertion failed for case "sample": expected string, got 10. Update the @nudo:returns directive to match the inferred type, or fix the function implementation (nudo-assertion-failed)
```

---

## `nudo harvest`

Convert installed `@types/<pkg>` TypeScript declarations into a Nudo env file — TypeScript source that rebuilds those types with `T.*` constructors. The `@types` package must be installed first.

```bash
nudo harvest <pkg> [--out <file>]
```

### Options

| Option | Description |
|--------|-------------|
| `--out <file>` | Output `.ts` env file (default: `./nudo-harvest-<pkg>.ts`) |

### Example

```bash
pnpm add -D @types/node
nudo harvest node
```

Output:

```
Harvested @types/node → nudo-harvest-node.ts
  files:    80
  symbols:  1671
  skipped:  148

Usage — add this directive at the top of your JS file:
  /// @nudo:env nudo-harvest-node.ts
```

The generated file starts with `// Auto-generated by nudo harvest — DO NOT EDIT` and exports a `defineEnv()` function built from `T.fnSig(...)`, `T.union(...)`, `T.instanceOf(...)` constructors. Reference it from the files that need those ambient types:

```js
/// @nudo:env nudo-harvest-node.ts
```

---

## `nudo watch`

Watch a file or directory for changes and re-run inference on change.

```bash
nudo watch <path>
```

### Options

| Option | Description |
|--------|-------------|
| `--dts` | Generate `.d.ts` files on each run |

### Examples

Watch current directory:

```bash
nudo watch .
```

Watch a specific file:

```bash
nudo watch src/math.js
```

Watch with `.d.ts` generation:

```bash
nudo watch . --dts
```

### Watch Mode Behavior

- **Whole-program scanning**: When watching a directory, Nudo recursively scans **all** `.js` files, excluding `node_modules`. Files without Nudo directives are analyzed too — types for their functions are derived from call sites across the watched files.
- **File watching**: When watching a single file, Nudo watches the file's directory and re-analyzes on changes to tracked files.
- **Debouncing**: File changes are debounced (200ms) to avoid redundant runs on rapid edits.
- **Incremental re-analysis**: On each change, only the changed files and their dependents are re-analyzed (`Incremental: re-analyzed N, skipped M (…ms)`), and results are reprinted with source locations.

---

## Practical Workflow

1. **Develop with watch mode**: Run `nudo watch . --dts` in a terminal while editing. Each save triggers re-inference and `.d.ts` generation.

2. **CI / pre-commit**: `nudo check` exits with code `1` on error-level diagnostics, so it can gate CI. `infer` takes a single file — loop over your sources:

   ```bash
   find src -name "*.js" -not -path "*/node_modules/*" -print0 |
     xargs -0 -n1 nudo check
   ```

3. **Generate declarations**: Use `nudo infer main.js --dts` to produce `.d.ts` for consumers expecting TypeScript definitions.

4. **Reuse ambient types**: Run `nudo harvest <pkg>` once per `@types` package and reference the generated env file with `/// @nudo:env ./nudo-harvest-<pkg>.ts` in the files that need it.
