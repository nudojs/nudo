---
sidebar_position: 1
---

# CLI Usage

The `nudo` CLI is the primary way to run type inference on JavaScript files that use Nudo directives. Install it globally or via `npx`:

```bash
npm install -g @nudojs/cli
# or
pnpm add -g @nudojs/cli
```

## `nudo infer`

Infer types from a JavaScript file using `@nudo:*` directives.

```bash
nudo infer <file>
```

### Options

| Option | Description |
|--------|-------------|
| `--dts` | Generate a `.d.ts` declaration file next to the source file |
| `--loc` | Show source locations (file:line:column) in the output |

### Examples

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

Combined: number
```

Generate TypeScript declaration file:

```bash
nudo infer math.js --dts
```

This creates `math.d.ts` alongside your source file with inferred function signatures.

Show source locations:

```bash
nudo infer src/utils.js --loc
```

Output includes location information:

```
=== subtract (src/utils.js:15:1) ===

Case "positive numbers": (5, 3) => 2
...
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

- **File filtering**: Watch mode only processes `.js` files that contain at least one Nudo directive: `@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, or `@nudo:returns`.
- **Directory watching**: When watching a directory, Nudo recursively scans for matching files, excluding `node_modules`.
- **Debouncing**: File changes are debounced (200ms) to avoid redundant runs on rapid edits.

---

## Practical Workflow

1. **Develop with watch mode**: Run `nudo watch . --dts` in a terminal while editing. Each save triggers re-inference and `.d.ts` generation.

2. **CI / pre-commit**: Run `nudo infer src/**/*.js` to validate that inference succeeds across your codebase.

3. **Generate declarations**: Use `nudo infer main.js --dts` to produce `.d.ts` for consumers expecting TypeScript definitions.
