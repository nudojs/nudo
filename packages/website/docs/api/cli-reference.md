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

| Command | Purpose |
|---------|---------|
| [`nudo infer`](#nudo-infer) | Infer types from a single JavaScript file |
| [`nudo check`](#nudo-check) | Check a single file for type errors (error-level diagnostics exit `1`) |
| [`nudo doctor`](#nudo-doctor) | Health-check files: call-site solidification drift, analysis errors, uncovered functions |
| [`nudo generate`](#nudo-generate) | Generate runtime validators from inferred types |
| [`nudo watch`](#nudo-watch) | Watch a file or directory and re-run inference on changes |
| [`nudo harvest`](#nudo-harvest) | Convert `@types/<pkg>` declarations into a Nudo env file |

### nudo infer

Infer types from a single JavaScript file.

```bash
nudo infer <file> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<file>` | Path to a `.js`, `.mjs`, or `.ts` file (relative or absolute). Directories are also accepted — recursively scanned for inference targets (`.js`/`.mjs`/`.ts`, excluding `.d.ts`). TypeScript type annotations are stripped at the parser layer and the file is inferred with JS semantics. |

**Options:**

| Option | Description |
|--------|-------------|
| `--dts` | Generate a `.d.ts` declaration file next to the source file |
| `--loc` | Show source locations (`file:line:column`) in the output |
| `--json` | Output results as structured JSON |
| `--callsites <paths...>` | Usage-site files or directories (tests/apps) to harvest real call shapes from; their calls to this file's exports become synthesized `call@L` cases — see [Call-Site Discovery](/docs/guides/callsite-discovery) |
| `--emit-cases [mode]` | Write the synthesized call-site cases back into the analyzed file as `@nudo:case` directives (reserved `call@` name prefix). Omit the value for `add` (only fills in functions that have no case directives yet) or pass `=update` to re-synchronize previously generated directives — see [Persisting cases as directives](/docs/guides/cli#persisting-cases-as-directives) |
| `--dry-run` | With `--emit-cases`: print a unified diff instead of writing to disk |
| `--exit-on-diff` | With `--dry-run`: exit with code `1` when the diff is non-empty — a CI gate for usage-site drift |

**Output format:**

- One section per function (`=== name ===`); functions from imported modules are shown under a `--- path (imported) ---` header
- Each case: `Case "name": (arg1, arg2, ...) => result`
- Functions without `@nudo:case` directives still get cases: synthesized `call@L` cases from observed calls, or an `entry@L` case with `unknown` parameters plus a `# no call sites found` note when nothing calls them
- Optional `throws type` when the case may throw
- If multiple cases: combined type printed as `Combined: type`, simplified by absorption — a literal whose base type is already in the union is absorbed (e.g. `2 | -9 | number` collapses to `number`); pure-literal unions keep all members
- Diagnostics, if any, are printed in a trailing `Diagnostics:` section as `[severity] path:line:column message (code)`
- With `--dts`: writes `<basename>.d.ts` in the same directory and prints `Generated: <basename>.d.ts`
- With `--emit-cases`: a trailing emission summary — `Emitted cases → <file> (N directive(s) across M function(s))` after writing to disk, `Would emit cases → <file> (dry run)` followed by a unified diff with `--dry-run`, or `No changes.` when the source is already in sync — each followed by per-function lines: `fn: case names` for written functions, `fn: reason` for skipped ones (e.g. `already-generated`)

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
=== subtract (math.js:6:0) ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number

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

### nudo doctor

Health-check JavaScript files: call-site solidification drift (with `--callsites`), analysis errors, and functions without cases. Exits with code `1` when any file has drift or errors — uncovered functions are informational only and never change the exit code.

```bash
nudo doctor [paths...] [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[paths...]` | File(s) or directory(s) to check. Directories are scanned recursively for `.js` files (excluding `node_modules`); defaults to the current directory |

**Options:**

| Option | Description |
|--------|-------------|
| `--callsites <paths...>` | Usage-site files or directories (tests/apps). With it, doctor re-runs the same re-solidify chain as `infer --emit-cases=update` for every file and reports drift when the generated `call@` directives would change — see [Health Checks and CI Drift Gating](/docs/guides/cli#health-checks-and-ci-drift-gating) |
| `--json` | Output the report as structured JSON |

**What is checked:**

- **Drift** — with `--callsites`: the generated `call@` directives no longer match what the usage sites would produce today (same chain as `infer --emit-cases=update`, judged per file)
- **Errors** — analysis failures, including missing files and syntax errors
- **Entry-only count / uncovered functions** — informational: how many functions have no call evidence; `uncovered` (zero cases) is currently always empty in practice — every non-skipped function gets at least an `entry@L` fallback case — and never affects the exit code

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | No drift and no errors — uncovered functions alone still exit `0` |
| `1` | Any file has drift or an error |

**Examples:**

Healthy (exit code `0`):

```bash
nudo doctor lib.js --callsites test.js
```

```
lib.js
  · 3 function(s), 1 entry-only

Summary: 1 file(s) · 0 drift · 0 error(s) · 0 uncovered function(s)
Result: OK (uncovered function(s) are informational only)
```

Drift — the frozen `call@` directives are stale (exit code `1`); the refresh command is printed ready to copy:

```bash
nudo doctor lib.js --callsites test.js
```

```
lib.js
  · 3 function(s), 1 entry-only
  ✗ drift: 5 directive(s) changed (+3 new, -2 removed) — refresh with: nudo infer lib.js --callsites test.js --emit-cases=update

Summary: 1 file(s) · 1 drift · 0 error(s) · 0 uncovered function(s)
Result: FAIL (drift or errors found)
```

Analysis errors fail the run the same way (exit code `1`):

```
missing.js
  ✗ error: File not found: <path>
```

```
broken.js
  ✗ error: Unexpected token (1:18)
```

In CI, gate a whole source tree on drift in one command:

```bash
nudo doctor src/ --callsites tests/
```

**JSON output (`--json`):**

```json
{
  "ok": false,
  "files": [
    {
      "file": "lib.js",
      "functions": 3,
      "entryOnly": 1,
      "uncovered": [],
      "drift": {
        "added": 3,
        "removed": 2
      }
    }
  ],
  "summary": {
    "files": 1,
    "drift": 1,
    "errors": 0,
    "uncovered": 0
  }
}
```

Field notes:

- `ok` — matches the exit code: `false` exactly when any file drifted or errored.
- `files[]` — one entry per file: `file`, `functions`, `entryOnly`, `uncovered`; `drift: { added, removed }` appears only on drifting files, `error` only on failed ones.
- `summary` — totals: `files`, `drift`, `errors`, `uncovered`.

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
- **`dts`** — TypeScript declarations; one widened signature per function with real parameter names, with each case's precise result preserved in JSDoc (same output as `nudo infer --dts`)
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
| `1` | `nudo doctor` found drift or analysis errors — uncovered functions alone exit `0` |
| `1` | `--emit-cases` misuse — combined with `--json`, an invalid mode value, or `--exit-on-diff` without `--dry-run`; also `--exit-on-diff` when the `--dry-run` diff is non-empty |

Note: diagnostics printed by `infer` — including `[error]`-severity ones such as a failed `@nudo:returns` assertion — do **not** change `infer`'s exit code; `infer` still exits `0`. Use `nudo check` to gate CI on diagnostics.
