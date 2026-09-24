---
description: "Reference every nudo CLI command — check, test, contract, export, health, migrate — with arguments, options, output formats, and exit codes."
---

# CLI Reference

The `nudo` CLI runs type inference on `.js`, `.mjs`, and `.ts` files. Install it globally or run via `npx` — see [Installation](../getting-started/installation.md).

```bash
npx nudojs check ./src/utils.js
# or, after global install:
nudo check ./src/utils.js
```

This page is the **canonical flag / option / exit-code specification**. Tutorial-style walkthroughs live in [CLI Usage](../guides/cli.md).

---

## Commands

| Command | Purpose |
|---------|---------|
| [`nudo check`](#nudo-check) | Gate contracts + entry throws; print signatures on success and failure (CI gate) |
| [`nudo test`](#nudo-test) | Report every inferred case; assert declared `@nudo:case` expectations |
| [`nudo contract`](#nudo-contract) | Print / draft / emit effective interfaces — `[handwritten]` / `[generated]` / `[implicit]` layers |
| [`nudo export`](#nudo-export) | Project Abs into `dts` / `guard` / `schema` / `standard` artifacts |
| [`nudo health`](#nudo-health) | Health-check files: analysis errors, call-site solidification drift |
| [`nudo migrate`](#nudo-migrate) | One-way retire-tsc door: `status` / `strip` / `verify` / `retire` |

There is **no** observation verb. Observation is `check` signatures, `test` case reports, and IDE hover.

**Day 0:** `check` / `test`. **Day 1:** `contract` + `check`. **Ecosystem:** `export`. **Leaving tsc:** `migrate`.

---

### nudo check

Gate contracts (L1) and entry throws (L2). Prints signatures even when the run succeeds.

```bash
nudo check <paths...> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<paths...>` | One or more `.js`, `.mjs`, or `.ts` files or directories (scanned recursively; `.d.ts` excluded). TypeScript annotations are stripped; analysis uses JS semantics. `--json` requires a single file. |

**Options:**

| Option | Description |
|--------|-------------|
| `--watch` / `-w` | Re-run on file changes (flag, not a verb) |
| `--json` | Structured diagnostics + signatures (single file; cannot combine with `--abs`) |
| `--verbose` | Extra diagnosis detail |
| `--abs` | Per-function algebra face (shape + conf); `--generalize` adds the symbolic term/pred α |
| `--fn <name>` | With `--abs`: restrict to one function |
| `--assume <pred…>` | With `--abs`: assume constraints, e.g. `x>0 y>=1` |
| `--generalize` | With `--abs`: polymorphic signatures via symbolic execution |
| `--from <paths…>` | Usage-site files (tests/apps); their call records join the analysis |
| `--ignore-throws <names>` | Comma-separated L2 throw types to ignore (e.g. `TypeError,RangeError`). Does not swallow L1 contract violations. |
| `--entry-throws error\|warning\|off` | Severity for L2 entry may-throw (default `error`) |
| `--what-if <binding...>` | AI3: assume `name:type` bindings and report `--target` (same semantics as LSP `nudo.whatIf`) |
| `--target <name>` | With `--what-if`: binding whose inferred type to print |

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
nudo check  user.js
FAILED
  1 error · 0 warning · 0 info · 2 fn

signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => number

issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
```

> `L1` in the issue header is the **line number** (the function is declared on line 1 here) — the layer is L2.

- Unconstrained entry parameters print as **`any`**, never `unknown`.
- True `unknown` means inference failed (engine debt) and is annotated with conf.
- The throws domain is always shown when present.
- Success still prints `signatures` — `check` is not silent.

**Obligation layers:**

| Layer | Source | Behavior |
|-------|--------|----------|
| L1 explicit | `*.nudo.js` / `@nudo:refine` (alias `@nudo:interface`) | Violation → error |
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
nudo test <paths...> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--watch` / `-w` | Re-run on file changes |
| `--from <paths…>` | Usage-site files whose calls become `call@L` cases |
| `--freeze[=mode]` | Write synthesized cases back as `@nudo:case` directives. Mode: `update` re-synchronizes previously generated directives; no value = add mode, keeps existing directives |
| `--json` | Structured case report (single file; cannot combine with `--abs` or `--freeze`) |
| `--abs` | Print Abs algebra for cases |
| `--dry-run` | With `--freeze`: print a unified diff instead of writing |
| `--exit-on-diff` | With `--freeze --dry-run`: exit `1` when the diff is non-empty |

**Output format:**

```text
=== getName ===
  call@L42  ({ name: "Ada" }) => "Ada"
  debug "empty"  ({}) => undefined

assertions
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 1 synthetic case(s) printed above)
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

A failing declared assertion (`nudo:case-expected`) renders as:

```text
=== double ===
  debug "bad"  (2) => 4

assertions
  ✗ 0 passed · 1 failed · 0 unchecked
  [FAIL] double  case "bad"
         expected: 5
         actual:   4
```

**Example:**

```bash
nudo test math.js
```

```text
=== subtract ===
  call@L5  (5, 3) => 2
  call@L6  (1, 10) => -9

assertions
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 2 synthetic case(s) printed above)
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

```bash
nudo contract <paths...> [--from <paths...>]
nudo contract --emit <paths...> [--fn <name>] [--all] [--dry-run] [--exit-on-diff] [--from <paths...>]
nudo contract --draft <paths...> [--write] [--json] [--fn <name>] [--dry-run] [--from <paths...>]
```

**Layers:**

- `[handwritten]` — source `@nudo:refine` / sidecar binding (product term: **contract**)
- `[generated]` — persisted `@generated` sidecar segment
- `[implicit]` — call-site inference

**Options:**

| Option | Description |
|--------|-------------|
| `--emit` | Persist inferred domains as sidecar `@generated` segments |
| `--draft` | Generate a reviewable contract draft from existing code (code-first / migration) |
| `--write` | With `--draft`: write `*.nudo.draft.js` to disk |
| `--fn <name>` | Restrict to one function (**repeatable**; may name a downstream derivation target when a handwritten root exists) |
| `--all` | Emit all eligible functions |
| `--dry-run` | Print a unified diff instead of writing |
| `--exit-on-diff` | With `--emit --dry-run`: exit `1` when the diff is non-empty |
| `--from <paths…>` | Usage-site evidence for domain projection |
| `--json` | With `--draft`: `{ draftSource, diff, entries[] }` for agent review (AI4) |

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

```bash
nudo export <path> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--format` | `dts` (default) \| `guard` \| `schema` \| `standard` \| `all` |
| `--dialect` | Schema dialect; currently `zod`. Valid with `schema` / `all` |
| `--out <dir>` | Write artifacts under this directory instead of stdout |

**Formats:**

| Format | Artifact |
|--------|----------|
| `dts` | TypeScript declarations — one widened signature per function; case precision preserved in JSDoc |
| `guard` | Runtime type-guards (prefer lossless Abs path when available) |
| `schema` | Schema source for `--dialect` (default zod) → `*.nudo.schema.<dialect>.ts` |
| `standard` | Standard Schema v1 modules (`~standard`, vendor `nudo`) → `<fn>.nudo.standard.ts` |
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
  · 1 function(s)
  ✗ drift: 3 witness directive(s) changed (+2 new, -1 removed) — refresh: nudo test src/lib.js --from tests/ --freeze=update

Summary: 1 file(s) · 1 case drift · 0 contract drift · 0 error(s) · 0 uncovered function(s)
Result: FAIL (drift or errors found)
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | No drift, no analysis errors |
| `1` | Drift or analysis errors (uncovered functions are informational only) |

---

### nudo migrate

One-way door off TypeScript: audit → strip annotations → gate with `nudo check` → retire `tsc`. Coexistence is a migration tactic; the exit is `retire`.

```bash
nudo migrate <status|strip|verify|retire> [paths...] [options]
```

| Action | Purpose |
|--------|---------|
| `status <pkg-or-dir>` | Audit `.ts`/`.tsx` counts, `tsconfig`, `typescript` dep, `tsc` scripts, **workflow tsc lines**, and **blockers** |
| `strip <paths...>` | `.ts` → `.js` (type annotations stripped; runtime stays). Dry-run by default |
| `verify <paths...>` | Run `nudo check` on the JS surface — must pass before retire |
| `retire <pkg-or-dir>` | Drop `typescript` dep, rewrite `tsc` scripts → `nudo check`, rewrite `.github/workflows` tsc lines, write `.nudo/migrate-retired.json` |
| `retire --all` | Every workspace package that still has `tsc` / `typescript` (monorepo batch) |

**Options:**

| Option | Description |
|--------|-------------|
| `strip --write` | Write stripped `.js` next to the source (default is dry-run print) |
| `strip --no-draft` | Skip best-effort sidecar draft (draft is on with `--write`) |
| `strip --backup` | Rename original `.ts` to `.ts.bak` after write |
| `verify --with-tsc` | Also run `tsc --noEmit` baseline on `.ts` inputs (migration dual-run only) |
| `retire --dry-run` | Print the rewrite plan without touching `package.json` / workflows |
| `retire --all` | Batch every workspace package that still carries tsc/typescript |
| `retire --no-workflows` | Leave `.github/workflows` untouched |
| `--json` | Machine-readable output |

Convert annotations into reviewable contracts with [`contract --from-dts`](#nudo-contract) (`@nudo:draft` is **not** enforced until accepted into `*.nudo.js`).

Samples: [`docs/examples/migrate/`](https://github.com/nudojs/nudo/tree/main/docs/examples/migrate) · [`docs/examples/retire-real/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-real). Walkthrough: [Migrate from TypeScript](../guides/migrating-from-typescript.md).

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Action completed (including dry-runs) |
| `1` | Usage / IO errors; `verify` fails when `nudo check` fails |

---

## JSON output

`check --json` and `test --json` are the machine-readable faces.

- **check --json** — signatures (including `any` entry params and throws), diagnostics with codes such as `nudo:entry-may-throw`, summary counts, **`budget`** (call/fork usage + `truncated`), and per-issue **`actions[]`** (structured next steps: `draft` / `relax` / `callsite` / `assume` / `mock` / … with optional executable `command`).
- **test --json** — per-function cases (`entry@` / `call@` / directive), an `assertions` summary (`passed`/`failed`/`unchecked`), diagnostics, and optional Abs intension blocks. Declared assertion failures still exit 1.
- **check --json** — single file only (directory targets error with `--json requires a single file, not multiple targets`); `test --json` errors with `--json requires a single file`. Multi-file adds `kind:"multi"` + aggregate `budgetTruncated`.

---

## Exit codes summary

| Command | Exit `1` |
|---------|----------|
| `check` | Any error-level diagnostic (L1 or non-ignored L2) |
| `test` | Any **declared** assertion failure |
| `contract` / `export` (read-only) | Usage / IO errors |
| `contract --emit --exit-on-diff` | Would write and a diff exists |
| `health` | Drift or analysis errors |
| `migrate verify` | `nudo check` fails on the target |
| `migrate` (other) | Usage / IO errors |

