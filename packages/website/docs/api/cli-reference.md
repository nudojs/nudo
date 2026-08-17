---
sidebar_position: 4
---

# CLI Reference

The `nudo` CLI runs type inference on JavaScript files that use `@nudo:*` directives. Install globally or run via `npx`:

```bash
pnpm add -g @nudojs/cli
# or
npx @nudojs/cli infer ./src/utils.js
```

---

## Commands

### nudo infer

Infer types from a JavaScript file.

```bash
nudo infer <file> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<file>` | Path to a `.js` file (relative or absolute) |

**Options:**

| Option | Description |
|--------|-------------|
| `--dts` | Generate a `.d.ts` declaration file next to the source file |
| `--loc` | Show source locations (`file:line:column`) in the output |
| `--json` | Output results as structured JSON |

**Output format:**

- One section per function with `@nudo:case` directives
- Each case: `Case "name": (arg1, arg2, ...) => result`
- Optional `throws type` when the case may throw
- If multiple cases: combined type printed as `Combined: type`
- With `--dts`: writes `<basename>.d.ts` in the same directory

**Example:**

```bash
nudo infer math.js
```

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

```bash
nudo infer math.js --dts --loc
```

```
=== subtract (math.js:12:1) ===

Case "positive numbers": (5, 3) => 2
...

Generated: math.d.ts
```

**JSON output (`--json`):**

```bash
nudo infer math.js --json
```

```json
{
  "functions": [
    {
      "name": "subtract",
      "loc": { "start": { "line": 5, "column": 0 }, "end": { "line": 7, "column": 1 } },
      "cases": [
        { "name": "positive numbers", "args": ["5", "3"], "result": "2", "throws": null },
        { "name": "symbolic", "args": ["number", "number"], "result": "number", "throws": null }
      ]
    }
  ],
  "diagnostics": []
}
```

---

### nudo generate

Generate runtime validators from inferred types.

```bash
nudo generate <file> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<file>` | Path to a `.js` file (relative or absolute) |

**Options:**

| Option | Description |
|--------|-------------|
| `--format <format>` | Output format: `zod`, `guard`, `dts`, `all` (default: `all`) |
| `--output <dir>` | Output directory (default: `.`) |

**Output formats:**

- **`zod`** — Zod schema strings for each function case (input and output)
- **`guard`** — Zero-dependency runtime type guard functions
- **`dts`** — TypeScript declaration file with real parameter names and JSDoc
- **`all`** — All of the above

**Example:**

```bash
nudo generate src/utils.js --format zod
```

```
// === parseUser Zod Schemas ===
// Case "string-input":
// Input: { arg0: z.string() }
// Output: z.object({ name: z.string(), age: z.number() })
```

---

### nudo watch

Watch a file or directory and re-run inference on changes.

```bash
nudo watch <path> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<path>` | File or directory to watch |

**Options:**

| Option | Description |
|--------|-------------|
| `--dts` | Generate `.d.ts` files on each run |

**Behavior:**

- **File:** watches the file and its directory
- **Directory:** recursively watches, excluding `node_modules`
- **File filtering:** only processes `.js` files that contain Nudo directives
- **Debouncing:** 200ms debounce to batch rapid edits
- Output is cleared and reprinted on each run

**Example:**

```bash
nudo watch .
nudo watch src/utils.js --dts
```

---

## File Patterns

- **Input:** `.js` files only (TypeScript/JSX via Babel parsing)
- **Nudo files:** files containing `@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, or `@nudo:returns`
- **Watch mode:** in directories, only Nudo files are analyzed

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| non-zero | Parse error, missing file, or other fatal error |

Note: Type inference errors (e.g. `@nudo:returns` failures) are printed to stderr but do not change the exit code.
