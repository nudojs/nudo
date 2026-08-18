---
sidebar_position: 4
---

# CLI Reference

The `nudo` CLI runs type inference on JavaScript files. Install globally or run via `npx`:

```bash
pnpm add -g @nudojs/cli
# or
npx @nudojs/cli infer ./src/utils.js
```

---

## Commands

### nudo infer

Infer types from a single JavaScript file.

```bash
nudo infer <file> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<file>` | Path to a `.js` file (relative or absolute). Directories are rejected with an `EISDIR` error — use `nudo watch` for directories. |

**Options:**

| Option | Description |
|--------|-------------|
| `--dts` | Generate a `.d.ts` declaration file next to the source file |
| `--loc` | Show source locations (`file:line:column`) in the output |
| `--json` | Output results as structured JSON |
| `--callsites <paths...>` | Usage-site files or directories (tests/apps) to harvest real call shapes from; their calls to this file's exports become synthesized `call@L` cases — see [Call-Site Discovery](/docs/guides/callsite-discovery) |

**Output format:**

- One section per function (`=== name ===`); functions from imported modules are shown under a `--- path (imported) ---` header
- Each case: `Case "name": (arg1, arg2, ...) => result`
- Functions without `@nudo:case` directives still get cases: synthesized `call@L` cases from observed calls, or an `entry@L` case with `unknown` parameters plus a `# no call sites found` note when nothing calls them
- Optional `throws type` when the case may throw
- If multiple cases: combined type printed as `Combined: type` — literal members are preserved (e.g. `2 | -9 | number`)
- Diagnostics, if any, are printed in a trailing `Diagnostics:` section as `[severity] path:line:column message (code)`
- With `--dts`: writes `<basename>.d.ts` in the same directory and prints `Generated: <basename>.d.ts`

**Example:**

```bash
nudo infer math.js
```

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: 2 | -9 | number
```

```bash
nudo infer math.js --dts --loc
```

```
=== subtract (math.js:6:0) ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: 2 | -9 | number

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
      "loc": {
        "start": {
          "line": 6,
          "column": 0
        },
        "end": {
          "line": 8,
          "column": 1
        }
      },
      "cases": [
        {
          "name": "positive numbers",
          "args": [
            "5",
            "3"
          ],
          "result": "2",
          "throws": null,
          "source": null
        },
        {
          "name": "negative result",
          "args": [
            "1",
            "10"
          ],
          "result": "-9",
          "throws": null,
          "source": null
        },
        {
          "name": "symbolic",
          "args": [
            "number",
            "number"
          ],
          "result": "number",
          "throws": null,
          "source": null
        }
      ],
      "entryOnly": false
    }
  ],
  "diagnostics": []
}
```

Field notes:

- `source` — where the case came from: `null` for hand-written `@nudo:case` directives and `entry@L` fallbacks; `"callsite"` for cases synthesized from recorded call sites (`call@L…`).
- `entryOnly` — `true` when the function received no call-site records, so its signature comes from an `entry@L` fallback case with `unknown` parameters.
- `diagnostics` — the same diagnostics shown in the text output's `Diagnostics:` section (with `range`, `severity`, `message`, and `code`).

---

### nudo check

Check a single JavaScript file for type errors. Prints one line per diagnostic in the form `[severity] path:line:column message (code)` and exits with code `1` when any error-level diagnostic is found — warnings alone exit `0`.

```bash
nudo check <file>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<file>` | Path to a `.js` file (relative or absolute) |

**Example:**

```bash
nudo check src/broken.js
```

```
[warning] src/broken.js:2:9 Cannot resolve 'name' on unknown value (nudo:unknown-recv)
[warning] src/broken.js:2:9 Cannot resolve 'toUpperCase' on unknown value (nudo:unknown-recv)
```

- A file with no diagnostics prints `No issues found.` and exits `0`.
- When the origin of a bad value is known, a hint line follows: `→ value originates at line:column`.
- A failed `@nudo:returns` assertion is error-level, so `check` exits `1`:

```
[error] src/assert.js:5:0 @nudo:returns assertion failed for case "sample": expected string, got 10. Update the @nudo:returns directive to match the inferred type, or fix the function implementation (nudo-assertion-failed)
```

---

### nudo generate

Generate runtime validators from inferred types. Output is printed to stdout.

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
| `--output <dir>` | Declared but currently not implemented — output always goes to stdout, this option has no effect |

**Output formats:**

- **`zod`** — Zod schema strings (as comments) for each function case (input and output); input parameters are named `arg0`, `arg1`, …
- **`guard`** — zero-dependency runtime type guard functions, one per case, named `is<Function><Case>Output`
- **`dts`** — TypeScript declarations; parameters are named `arg0`, `arg1`, … (real parameter names are not preserved) and there is no JSDoc
- **`all`** — all of the above

**Example:**

```bash
nudo generate src/user.js --format zod
```

```
// === createUser Zod Schemas ===
// Case "input":
// Input: { arg0: z.object({ name: z.string(), age: z.number() }) }
// Output: z.object({ id: z.literal(123), name: z.string(), age: z.number() })
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

- **File:** watches the file's directory and re-analyzes tracked files on change
- **Directory:** recursively watches **all** `.js` files, excluding `node_modules` — files without Nudo directives are analyzed too (whole-program inference: call sites across watched files synthesize `call@L` cases; uncalled functions get `entry@L` cases)
- **Debouncing:** 200ms debounce to batch rapid edits
- **Incremental:** only changed files and their dependents are re-analyzed; each run prints `Incremental: re-analyzed N, skipped M (…ms)`
- Output is cleared and reprinted on each run

**Example:**

```bash
nudo watch .
nudo watch src/utils.js --dts
```

---

### nudo harvest

Convert installed `@types/<pkg>` `.d.ts` declarations into a Nudo env file — TypeScript source that rebuilds those types with `T.*` constructors, loaded via the `/// @nudo:env` directive. The `@types` package must be installed first.

```bash
nudo harvest <pkg> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<pkg>` | Package name under `@types` (e.g. `node`) |

**Options:**

| Option | Description |
|--------|-------------|
| `--out <file>` | Output `.ts` env file (default: `./nudo-harvest-<pkg>.ts`) |

**Example:**

```bash
pnpm add -D @types/node
nudo harvest node
```

```
Harvested @types/node → nudo-harvest-node.ts
  files:    80
  symbols:  1671
  skipped:  148

Usage — add this directive at the top of your JS file:
  /// @nudo:env nudo-harvest-node.ts
```

---

## File Patterns

- **Input:** `.js` files only (parsed via Babel)
- **Directives are optional:** files without any `@nudo:*` directive are analyzed too — their functions get types from observed call sites, with `entry@L` fallback cases (`unknown` parameters) when nothing calls them
- **Watch mode:** directories are scanned recursively for all `.js` files, excluding `node_modules`

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Fatal error — missing file, parse failure, or a directory passed to `infer` (`EISDIR`) |
| `1` | `nudo check` found at least one error-level diagnostic (warnings alone exit `0`) |

Note: diagnostics printed by `infer` — including `[error]`-severity ones such as a failed `@nudo:returns` assertion — do **not** change `infer`'s exit code; `infer` still exits `0`. Use `nudo check` to gate CI on diagnostics.
