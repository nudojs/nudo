---
sidebar_position: 4
description: "Reference every nudo CLI command — check, test, contract, export, health, env harvest — with arguments, options, output formats, and exit codes."
---

# CLI Reference

The `nudo` CLI runs type inference on `.js`, `.mjs`, and `.ts` files. Install globally or run via `npx`:

```bash
pnpm add -g @nudojs/cli
# or
npx @nudojs/cli check ./src/utils.js
```

---

## Commands

| Command | Purpose |
|---------|---------|
| [`nudo check`](#nudo-check) | Gate contracts + entry throws; print signatures on success and failure (CI gate) |
| [`nudo test`](#nudo-test) | Report every inferred case; assert declared `@nudo:case` expectations |
| [`nudo contract`](#nudo-contract) | Print / draft / emit effective interfaces — `[handwritten]` / `[generated]` / `[implicit]` layers |
| [`nudo export`](#nudo-export) | Project Abs into `dts` / `guard` / `zod` artifacts |
| [`nudo health`](#nudo-health) | Health-check files: analysis errors, call-site solidification drift |
| [`nudo env harvest`](#nudo-env-harvest) | Convert `@types/<pkg>` declarations into a Nudo env file |

There is **no** observation verb (`infer` / `show` / `types`). Observation is `check` signatures, `test` case reports, and IDE hover.

**Day 0:** `check` / `test`. **Day 1:** `contract` + `check`. **Ecosystem:** `export`.

---

### nudo check

Gate contracts (L1) and entry throws (L2). Prints signatures even when the run succeeds.

```bash
nudo check <path> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<path>` | A `.js`, `.mjs`, or `.ts` file or a directory (scanned recursively; `.d.ts` excluded). TypeScript annotations are stripped; analysis uses JS semantics. |

**Options:**

| Option | Description |
|--------|-------------|
| `--watch` / `-w` | Re-run on file changes (flag, not a verb) |
| `--json` | Structured diagnostics + signatures |
| `--verbose` | Extra diagnosis detail |
| `--abs` | Print the Abs algebra face (term / pred / conf) |
| `--from <paths…>` | Usage-site files (tests/apps); their call records join the analysis — formerly `--callsites` |
| `--ignore-throws <names>` | Comma-separated L2 throw types to ignore (e.g. `TypeError,RangeError`). Does not swallow L1 contract violations. |
| `--entry-throws error\|warning\|off` | Severity for L2 entry may-throw (default `error`) |

**Configuration (`package.json`):**

```json
{
  "nudo": {
    "check": {
      "ignoreThrows": ["TypeError"],
      "entryThrows": "error"
    }
  }
}
```

**Output format:**

```text
signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => any
issues
  [error] getName (export): may throw TypeError  (nudo:entry-may-throw)
```

- Unconstrained entry parameters print as **`any`**, never `unknown`.
- True `unknown` means inference failed (engine debt) and is annotated with conf.
- The throws domain is always shown when present.
- Success still prints `signatures` — `check` is not silent.

**Obligation layers:**

| Layer | Source | Behavior |
|-------|--------|----------|
| L1 explicit | `*.nudo.js` / `@nudo:refine` / `@nudo:interface` | Violation → error |
| L2 default JS contract | Runtime boundary on **entry/export** functions | Undigested may-throw → error (`nudo:entry-may-throw`); filter with `--ignore-throws` |

L2 does **not** gate internal helpers. `try`/`catch` and refine can clear L2.

**Example:**

```bash
nudo check user.js
```

```bash
nudo check src/lib.js --ignore-throws TypeError --from tests/
```

```bash
# --json is single-file only; directory targets use the human report face
nudo check src/lib.js --json
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | No error-level diagnostics |
| `1` | Any error-level diagnostic (L1 or non-ignored L2). `--abs` still gates. |

---

### nudo test

Report every inferred case (including synthetic `call@` / `entry@`) and run declared assertions.

```bash
nudo test <path> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--watch` / `-w` | Re-run on file changes |
| `--from <paths…>` | Usage-site files whose calls become `call@L` cases — formerly `--callsites` |
| `--freeze[=update]` | Write synthesized cases back as `@nudo:case` directives (formerly `infer --emit-cases`). `=update` re-synchronizes previously generated directives. |
| `--json` | Structured case report |
| `--abs` | Print Abs algebra for cases |
| `--dry-run` | With `--freeze`: print a unified diff instead of writing |
| `--exit-on-diff` | With `--dry-run`: exit `1` when the diff is non-empty |

**Output format:**

```text
=== getName ===
  call@L42  ({ name: "Ada" }) => "Ada"
  debug "empty"  ({}) => undefined
assertions
  — 0 passed · 0 failed · 2 unchecked (no declared @nudo:case expectations)
```

When no usage-site call is found for an entry export:

```text
=== getName ===
  entry@L6  (any) => any   throws TypeError
```

- Synthetic `call@` / `entry@` cases **print by default** — this is call-site observation.
- When usage-site `call@` cases exist, the analyzer does **not** also synthesize `entry@` for that function.
- Only `@nudo:case` with `=> expected` enter pass/fail.
- Failures of declared assertions set exit `1`; synthetic cases do not.
- `test --json` includes an `assertions` summary (`passed` / `failed` / `unchecked`) and still exits 1 on declared assertion failure.

**Example:**

```bash
nudo test math.js
```

```text
=== subtract ===
  call@L6  (5, 3) => 2
  call@L7  (1, 10) => -9
assertions
  — 0 passed · 0 failed · 2 unchecked (no declared @nudo:case expectations)
```

```bash
nudo test lib.js --from test.js --freeze=update
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | All declared assertions passed (or none declared) |
| `1` | Any declared assertion failed |

---

### nudo contract

Print, draft, or emit each function's effective interface with its source layer.

Replaces `nudo interface` / `nudo refine` (deprecated).

```bash
nudo contract <paths...> [--from <paths...>]
nudo contract --emit <paths...> [--fn <name>] [--all] [--dry-run] [--exit-on-diff] [--from <paths...>]
nudo contract --draft <paths...> [--write] [--fn <name>] [--dry-run] [--from <paths...>]
```

**Layers:**

- `[handwritten]` — source `@nudo:refine` / `@nudo:interface` ∪ sidecar binding
- `[generated]` — persisted `@generated` sidecar segment
- `[implicit]` — call-site inference

**Options:**

| Option | Description |
|--------|-------------|
| `--emit` | Persist inferred domains as sidecar `@generated` segments |
| `--draft` | Generate a reviewable contract draft from existing code (code-first / migration) |
| `--write` | With `--draft`: write `*.nudo.draft.js` to disk |
| `--fn <name>` | Restrict to one function (may name a downstream derivation target when a handwritten root exists) |
| `--all` | Emit all eligible functions |
| `--dry-run` | Print a unified diff instead of writing |
| `--exit-on-diff` | With `--emit --dry-run`: exit `1` when the diff is non-empty |
| `--from <paths…>` | Usage-site evidence for domain projection |

**Examples:**

```bash
nudo contract calc.js
nudo contract --draft double.js --write
nudo contract --emit lib.js --fn add2
```

Generated sidecar comment form:

```js
// @generated by nudo — do not edit; regenerate with `nudo contract --emit`
```

Handwritten bindings always win; emit refuses to overwrite them (`nudo:interface-name-clash`). Re-running emit with unchanged evidence is a no-op.

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Usage / IO error; or `--exit-on-diff` with a non-empty would-be write |

---

### nudo export

Project Abs into ecosystem artifacts. The **only** CLI path for `.d.ts`, guards, and schema projections.

Replaces `nudo generate` / `nudo emit` / `nudo guard` and `infer --dts` (deprecated).

```bash
nudo export <path> [--format dts|guard|schema|standard|zod|all] [--dialect zod] [--out dir]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--format` | `dts` (default) \| `guard` \| `schema` \| `standard` \| `zod` (deprecated alias) \| `all` |
| `--dialect` | Schema dialect; currently `zod`. Valid with `schema` / `all` / `zod` |
| `--out <dir>` | Write artifacts under this directory instead of stdout |

**Formats:**

| Format | Artifact |
|--------|----------|
| `dts` | TypeScript declarations — one widened signature per function; case precision preserved in JSDoc |
| `guard` | Runtime type-guards (prefer lossless Abs path when available) |
| `schema` | Schema source for `--dialect` (default zod) → `*.nudo.schema.<dialect>.ts` |
| `standard` | Standard Schema v1 modules (`~standard`, vendor `nudo`) → `<fn>.nudo.standard.ts` |
| `zod` | Deprecated alias of `schema --dialect zod` |
| `all` | dts + guard + schema + standard |

Schema projections carry Abs pred fidelity when expressible (`gt/ge/lt/le`, `int`, string length); symbolic preds are reported as `dropped preds` comments. `standard` enforces the same refinements at runtime via `validate` and remains a one-way projection — `nudo check` is still the CI gate.

`.d.ts` / schema projections are one-way, lossy views of Abs. Export does not take `--watch`.

**Examples:**

```bash
nudo export src/user.js --format schema --dialect zod
nudo export src/user.js --format standard --out dist
nudo export src/user.js --format dts --out dist/types
nudo export src/api.js --format all --out dist
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Usage / IO errors |

---

### nudo health

Health-check source files: analysis errors and call-site solidification drift.

Replaces `nudo doctor` (deprecated).

```bash
nudo health [paths...] [--watch] [--from <paths...>] [--json]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--watch` | Re-run on file changes |
| `--from <paths…>` | Usage-site files; health re-runs the same re-solidify chain as `test --freeze=update` and reports drift when generated `call@` directives would change |
| `--json` | Structured health report |

**Example:**

```bash
nudo health src/ --from tests/
```

```text
src/lib.js
  ✓ analysis ok
  ✗ drift: 5 directive(s) changed (+3 new, -2 removed)
    refresh with: nudo test lib.js --from test.js --freeze=update
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | No drift, no analysis errors |
| `1` | Drift or analysis errors (uncovered functions are informational only) |

---

### nudo env harvest

Convert `@types/<pkg>` declarations into a Nudo env module.

Replaces top-level `nudo harvest` (deprecated).

```bash
nudo env harvest <pkg> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--out <dir>` | Output directory for generated env files |
| `--auto` | Report analysis-path auto-harvest status |

**Example:**

```bash
nudo env harvest node
```

```ts
/// @nudo:env ./nudo-harvest-node.ts
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Env file written / status reported |
| `1` | `@types/<pkg>` not installed, or no `.d.ts` files found |

---

## JSON output

`check --json` and `test --json` are the machine-readable faces.

- **check --json** — signatures (including `any` entry params and throws), diagnostics with codes such as `nudo:entry-may-throw`, and summary counts.
- **test --json** — per-function cases (`entry@` / `call@` / directive), an `assertions` summary (`passed`/`failed`/`unchecked`), diagnostics, and optional Abs intension blocks. Declared assertion failures still exit 1.
- **check --json** — single file only (`--json requires a single file` on directory targets).

There is no `infer --json` as a primary command; consumers that still receive it during the deprecation window should migrate to `check --json` or `test --json`.

---

## Exit codes summary

| Command | Exit `1` |
|---------|----------|
| `check` | Any error-level diagnostic (L1 or non-ignored L2) |
| `test` | Any **declared** assertion failure |
| `contract` / `export` (read-only) | Usage / IO errors |
| `contract --emit --exit-on-diff` | Would write and a diff exists |
| `health` | Drift or analysis errors |
| `env harvest` | Missing `@types` package or no declarations |

---

## Deprecated commands

These verbs print stderr deprecation warnings and map to the new surface. They are removed in the next major — not permanent aliases.

| Deprecated | Replacement |
|------------|-------------|
| `nudo infer <path>` | `nudo check` (signatures/gate) + `nudo test` (cases); dts → `nudo export --format dts` |
| `nudo types <path>` | `nudo check --abs` |
| `nudo interface` / `nudo refine` | `nudo contract` |
| `nudo generate` / `nudo emit` / `nudo guard` | `nudo export --format …` |
| `nudo doctor` | `nudo health` |
| `nudo watch` | `nudo check --watch` / `nudo test --watch` |
| `nudo harvest <pkg>` | `nudo env harvest <pkg>` |
| `--callsites` | `--from` |
| `--emit-cases[=update]` | `nudo test --freeze[=update]` |
| `infer --dts` | `nudo export --format dts` |

See the [CLI guide — Migration](../guides/cli.md#migration--deprecated-verbs).
