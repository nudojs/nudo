---
sidebar_position: 1
description: "Drive Nudo from the terminal: infer types from files or directories, persist call-site cases as directives, and gate CI on drift."
---

# CLI Usage

The `nudo` CLI is the primary way to run type inference on `.js`, `.mjs`, and `.ts` files. Install it globally or via `npx`:

```bash
npm install -g @nudojs/cli
# or
pnpm add -g @nudojs/cli
```

## `nudo infer`

Infer types from a single file — or from every inference target under a directory. Functions with `@nudo:case` directives use them; every other function is still analyzed (whole-program inference) — observed calls become synthesized `call@L` cases, and functions with no call evidence get an `entry@L` case whose parameters default to `unknown`.

```bash
nudo infer <file-or-directory>
```

The target may be a `.js`, `.mjs`, or `.ts` file (TypeScript type annotations are stripped at the parser layer; the file is inferred with JS semantics) or a directory — directories are scanned recursively for inference targets (`.js`/`.mjs`/`.ts`, excluding `.d.ts`), and each file is analyzed in its own run. `--json` requires a single-file target.

Given `lib/`:

```js
// lib/slug.js
export function slugify(title) {
  return title.toLowerCase().replace(/ /g, "-");
}
console.log(slugify("Hello World"));
```

```ts
// lib/note.ts
export function note(text) {
  return "note: " + text;
}
```

```bash
nudo infer lib/
```

Output — one section per function, files in scan order:

```text
=== note ===

Case "entry@L1": (unknown) => `note: ${unknown}`
# no call sites found; parameters default to unknown

=== slugify ===

Case "call@L4": ("Hello World") => string
```

### Options

| Option | Description |
|--------|-------------|
| `--dts` | Generate a `.d.ts` declaration file next to the source file |
| `--loc` | Show source locations (file:line:column) in the output |
| `--json` | Output results as structured JSON — requires a single file (see the [JSON example](../api/cli-reference.md#nudo-infer)) |
| `--callsites <paths...>` | Mine usage sites (tests, examples, apps) for real argument shapes and synthesize cases from them — see [Call-Site Discovery](./callsite-discovery.md) |
| `--emit-cases [mode]` | Write the synthesized cases back into the source file as `@nudo:case` directives — see [Persisting cases as directives](#persisting-cases-as-directives) |
| `--dry-run` | With `--emit-cases`: print a unified diff instead of writing to disk |
| `--exit-on-diff` | With `--dry-run`: exit with code `1` when the diff is non-empty |

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

```text
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

The combined type is simplified by absorption: since the symbolic case already contributes `number`, the literal results `2 | -9` are absorbed into it. Pure-literal unions without a base-type member keep every literal.

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

```text
=== subtract (src/math.js:6:0) ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
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

```text
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

```text
--- src/plain.js (imported) ---

=== add ===

Case "call@L3": (2, 3) => 5
Case "call@L4": ("2", "3") => "23"

Combined: 5 | "23"
```

To harvest argument shapes from separate usage-site files (tests, examples, apps), pass them with `--callsites` — see [Call-Site Discovery](./callsite-discovery.md).

### Persisting cases as directives

Synthesized `call@L` cases live only inside the analysis run — run `nudo infer lib.js` again without `--callsites` and they are gone. `--emit-cases` freezes them into the source file as real `@nudo:case` directives, which makes the file self-contained: later runs (and other tools — `check`, `watch`, `.d.ts` generation) see the same shapes without re-evaluating the usage sites, and the harvested shapes become reviewable, version-controlled input just like hand-written directives.

#### Bootstrap: harvest once, write back

Given a library and a test that exercises it:

```js
// lib.js
function add(a, b) { return a + b; }
function greet(name) { return "hi " + name; }
console.log(add(1, 2));
add("x", "y");
module.exports = { add, greet };
```

```js
// test.js
const { greet } = require("./lib.js");
greet("ada");
greet("bob");
```

Run inference with the usage site and write the synthesized cases back:

```bash
nudo infer lib.js --callsites test.js --emit-cases
```

```text
=== add ===

Case "call@L3": (1, 2) => 3
Case "call@L4": ("x", "y") => "xy"

Combined: 3 | "xy"

=== greet ===

Case "call@L2": ("ada") => "hi ada"
Case "call@L3": ("bob") => "hi bob"

Combined: "hi ada" | "hi bob"

Emitted cases → lib.js (4 directive(s) across 2 function(s))
  add: call@L3, call@L4
  greet: call@L2, call@L3

```

`lib.js` now carries the directives (inserted into a JSDoc block above each function declaration):

```js
/**
 * @nudo:case "call@L3" (1, 2)
 * @nudo:case "call@L4" ("x", "y")
 */
function add(a, b) { return a + b; }
/**
 * @nudo:case "call@L2" ("ada")
 * @nudo:case "call@L3" ("bob")
 */
function greet(name) { return "hi " + name; }
console.log(add(1, 2));
add("x", "y");
module.exports = { add, greet };
```

Running the same command again is idempotent — the summary at the end becomes:

```text
No changes.
  add: already-generated
  greet: already-generated
```

#### Drift detection: `update` mode

Usage sites evolve, and directives frozen from them can go stale. `=update` re-synchronizes previously generated directives: it strips all `call@` directives from the source, re-analyzes the stripped source, and writes the refreshed set back — so additions, changes, *and* deletions at the usage sites are reflected. Say the test drifted to a single different call:

```js
// test.js — usage drifted
const { greet } = require("./lib.js");
greet(42);
```

Combine `update` with `--dry-run` and `--exit-on-diff` to turn this into a CI gate:

```bash
nudo infer lib.js --callsites test.js --emit-cases=update --dry-run --exit-on-diff
```

```text
=== add ===

Case "call@L3": (1, 2) => 3
Case "call@L4": ("x", "y") => "xy"

Combined: 3 | "xy"

=== greet ===

Case "call@L2": (42) => "hi 42"

Would emit cases → lib.js (dry run)
  add: call@L3, call@L4
  greet: call@L2

--- a/lib.js
+++ b/lib.js
@@ -4,8 +4,7 @@
  */
 function add(a, b) { return a + b; }
 /**
- * @nudo:case "call@L2" ("ada")
- * @nudo:case "call@L3" ("bob")
+ * @nudo:case "call@L2" (42)
  */
 function greet(name) { return "hi " + name; }
 console.log(add(1, 2));

```

The diff is non-empty, so the command exits with code `1`. Drop `--dry-run` (and `--exit-on-diff`) to apply it:

```bash
nudo infer lib.js --callsites test.js --emit-cases=update
```

```text
=== add ===

Case "call@L3": (1, 2) => 3
Case "call@L4": ("x", "y") => "xy"

Combined: 3 | "xy"

=== greet ===

Case "call@L2": (42) => "hi 42"

Emitted cases → lib.js (3 directive(s) across 2 function(s))
  add: call@L3, call@L4
  greet: call@L2

```

`update` is idempotent too — a second run prints `No changes.`

To check a whole project for stale directives without reading diffs, see [Health Checks and CI Drift Gating](#health-checks-and-ci-drift-gating) — `nudo doctor` reports drift across many files in one run.

#### What emission touches

Emission never touches hand-written work — it only manages its own `call@` directives: hand-written cases are never modified, functions that already carry generated directives are reported `already-generated` (in `add` mode) or fully re-synchronized (in `update` mode), entry-only functions are never written, and non-serializable cases are skipped. The complete merge-policy table is documented in [Call-Site Discovery — Merge policy](./callsite-discovery.md#merge-policy); the programmatic flow is documented under [service API — Case Emission](../api/service.md#case-emission).

---

## `nudo check`

Check a single file for type errors. `check` prints one line per diagnostic in the form `[severity] path:line:column message (error-code)` and exits with code `1` when any error-level diagnostic is found — warnings alone keep the exit code at `0`, which makes it suitable for CI.

```bash
nudo check src/broken.js
```

```text
[warning] src/broken.js:2:9 Cannot resolve 'name' on unknown value (nudo:unknown-recv)
[warning] src/broken.js:2:9 Cannot resolve 'toUpperCase' on unknown value (nudo:unknown-recv)
```

Hint lines, error-level assertions, and the exit-code rules are covered in the [`nudo check` reference](../api/cli-reference.md#nudo-check).

---

## `nudo harvest`

Convert installed `@types/<pkg>` TypeScript declarations into a Nudo env file — TypeScript source that rebuilds those types with `T.*` constructors. The `@types` package must be installed first:

```bash
pnpm add -D @types/node
nudo harvest node
```

Reference the generated `nudo-harvest-node.ts` from the files that need those ambient types:

```js
/// @nudo:env nudo-harvest-node.ts
```

Options (`--out`) and the output format are documented in the [`nudo harvest` reference](../api/cli-reference.md#nudo-harvest).

---

## `nudo watch`

Watch a file or directory and re-run inference on change:

```bash
nudo watch .            # current directory
nudo watch src/math.js  # a single file
nudo watch . --dts      # with .d.ts generation
```

Directories are scanned recursively for inference targets (`.js`/`.mjs`/`.ts`, excluding `node_modules`); changes are debounced (200ms), and each run re-analyzes only the changed files and their dependents. The full behavior is documented in the [`nudo watch` reference](../api/cli-reference.md#nudo-watch).

---

## Health Checks and CI Drift Gating

[`nudo doctor`](../api/cli-reference.md#nudo-doctor) re-checks a whole project in one command: analysis errors, and — with `--callsites` — whether the `call@` directives frozen by [`--emit-cases`](#persisting-cases-as-directives) still match what the usage sites would produce today. Drift or errors exit with code `1`, which makes `doctor` a CI gate for solidification drift.

The typical lifecycle:

1. **Solidify once** — bootstrap the directives from the usage sites (see [Persisting cases as directives](#persisting-cases-as-directives)):

   ```bash
   nudo infer lib.js --callsites test.js --emit-cases
   ```

2. **The usage sites evolve** — tests change their call shapes, and the frozen directives go stale.

3. **`doctor` reports the drift**:

   ```bash
   nudo doctor lib.js --callsites test.js
   ```

   ```text
   lib.js
     · 3 function(s), 1 entry-only
     ✗ drift: 5 directive(s) changed (+3 new, -2 removed) — refresh with: nudo infer lib.js --callsites test.js --emit-cases=update

   Summary: 1 file(s) · 1 drift · 0 error(s) · 0 uncovered function(s)
   Result: FAIL (drift or errors found)
   ```

4. **Refresh with the printed command** — copy it as-is:

   ```bash
   nudo infer lib.js --callsites test.js --emit-cases=update
   ```

5. **Re-check** — a second `doctor` run is green again: `Result: OK (uncovered function(s) are informational only)`.

In CI, check an entire source tree against the test suite in one line — any drift fails the build:

```bash
nudo doctor src/ --callsites tests/
```

Exit codes: drift or analysis errors → `1`; uncovered functions are informational only and never fail the run. See the [`nudo doctor` reference](../api/cli-reference.md#nudo-doctor) for all options and the `--json` output.

---

## Practical Workflow

1. **Develop with watch mode**: Run `nudo watch . --dts` in a terminal while editing. Each save triggers re-inference and `.d.ts` generation.

2. **CI / pre-commit**: `nudo check` exits with code `1` on error-level diagnostics, so it can gate CI. `check` takes a single file — loop over your sources:

   ```bash
   find src \( -name "*.js" -o -name "*.mjs" -o -name "*.ts" \) \
     -not -name "*.d.ts" -not -path "*/node_modules/*" -print0 |
     xargs -0 -n1 nudo check
   ```

3. **Generate declarations**: Use `nudo infer src/ --dts` (or a single file) to produce `.d.ts` for consumers expecting TypeScript definitions.

4. **Reuse ambient types**: Run `nudo harvest <pkg>` once per `@types` package and reference the generated env file with `/// @nudo:env ./nudo-harvest-<pkg>.ts` in the files that need it.
