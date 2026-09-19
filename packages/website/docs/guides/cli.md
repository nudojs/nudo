---
sidebar_position: 1
description: "Drive Nudo from the terminal: check signatures, report cases, draft contracts, export projections — the six primary verbs."
---

# CLI Usage

The `nudo` CLI is the product surface for type inference on `.js`, `.mjs`, and `.ts` files. Install it globally or via `npx`:

```bash
npm install -g @nudojs/cli
# or
pnpm add -g @nudojs/cli
```

## Primary verbs

```text
nudo — JavaScript types, computed

  nudo check <path> [--watch|-w]   # gate contracts + entry throws; print signatures
  nudo test <path> [--watch|-w]    # report every inferred case; assert declared expectations
  nudo contract <path>             # draft / emit interfaces
  nudo export <path>               # project dts / guard / zod
  nudo health [paths]              # project health & drift
  nudo env harvest <pkg>           # harvest @types into an env
```

There is **no** observation verb: no `nudo infer`, no `nudo show`, no `nudo types` as a primary command, and no top-level `nudo watch`. Observation lives in the output of `check` / `test` and in IDE hover.

**Day 0:** `nudo check` (signatures) and `nudo test` (cases).  
**Day 1:** `nudo contract` + `nudo check`.  
**Ecosystem:** `nudo export`.

| Want to know | Run |
|--------------|-----|
| Entry signatures / any / unknown / throws | `nudo check <path>` (prints `signatures` even on success) |
| Per-call-site ground truth / narrowing | `nudo test <path>` (prints every case, including synthetic `call@` / `entry@`) |
| Usage-site argument shapes | `nudo check` / `test` / `contract` `--from <paths…>` |
| Algebra face term/pred/conf | `nudo check --abs` (or `test --abs`) |
| Machine-readable | `nudo check --json` / `nudo test --json` |
| Interactive | IDE hover / inlay |

---

## `nudo check`

Gate contracts and entry throws. On success **and** failure, `check` prints signatures — it is not silent.

```bash
nudo check <path> [--watch|-w] [--json] [--verbose] [--abs]
           [--from paths…] [--ignore-throws names] [--entry-throws error|warning|off]
```

Given `user.js`:

```js
export function getName(user) {
  return user.name;
}

export function subtract(a, b) {
  return a - b;
}
```

```bash
nudo check user.js
```

```text
signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => any
issues
  [error] getName (export): may throw TypeError  (nudo:entry-may-throw)
```

Unconstrained entry parameters display as **`any`**. `unknown` means inference failed (engine debt) — it is never the default for an unconstrained entry parameter.

### Obligation layers

| Layer | Source | `check` behavior |
|-------|--------|------------------|
| **L1 explicit** | `*.nudo.js` / `@nudo:refine` / `@nudo:interface`; call-site evidence can supply domain | Violation → **error** |
| **L2 default JS contract** | Runtime boundary semantics when nothing is narrowed | Undigested may-throw on **entry/export** functions → **error** (`nudo:entry-may-throw`) |

Without an explicit contract, the contract degrades to the JS runtime boundary: entry params are `any`, operations on `any`/nullish values may throw, and exported functions must not silently carry undeclared, uncaptured throws.

**L2 only gates entry/export functions.** Internal helpers may throw; `check` does not fail the run for internal may-throw. `try`/`catch` and refine can clear L2 on a path.

### Options

| Option | Description |
|--------|-------------|
| `--watch` / `-w` | Re-run on file changes (watch is a **flag**, not a verb) |
| `--json` | Machine-readable diagnostics + signatures |
| `--verbose` | Extra detail for diagnosis |
| `--abs` | Print the Abs algebra face (term / pred / conf) |
| `--from <paths…>` | Usage-site files (tests/apps) that inject call records — renamed from `--callsites` |
| `--ignore-throws <names>` | Comma-separated L2 throw types to ignore (e.g. `TypeError`); does **not** swallow L1 contract violations |
| `--entry-throws error\|warning\|off` | Severity for L2 entry may-throw (default `error`) |

`package.json` configuration:

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

Exit code `1` on any error-level diagnostic (L1 or non-ignored L2).

`nudo check` is the CI gate. Prefer it over legacy observation commands.

---

## `nudo test`

Report every inferred case and run declared `@nudo:case` assertions.

```bash
nudo test <path> [--watch|-w] [--from paths…] [--freeze[=update]] [--json] [--abs]
```

Given `math.js`:

```js
export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);
```

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

- Synthetic `call@` / `entry@` cases **print by default** — that is the call-site observation surface.
- When usage-site `call@` cases exist, the analyzer does **not** also synthesize `entry@` for that function.
- Only `@nudo:case` directives **with `=> expected`** enter pass/fail; failures affect the exit code.
- `--from <paths…>` harvest usage-site call shapes (formerly `--callsites`).
- `--freeze[=update]` solidifies synthesized cases as directives (formerly `infer --emit-cases`).
- `--json` / `--abs` mirror `check`; `test --json` also carries an `assertions` summary (`passed`/`failed`/`unchecked`) and still exits 1 when a declared assertion fails.

### Example with declared assertions

```js
/**
 * @nudo:case "double" (2) => 4
 */
export function double(x) {
  return x * 2;
}
```

```bash
nudo test file.js
```

```text
=== double ===
  debug "double"  (2) => 4
assertions
  ✓ 1 passed · 0 failed · 0 unchecked
  [ok]   double  case "double" → 4
assertions
  ✓ 1 passed · 0 failed · 1 unchecked
```

---

## `nudo contract`

Draft, print, or emit effective interfaces (handwritten / generated / implicit layers). Replaces the old `nudo interface` / `nudo refine` verbs.

```bash
nudo contract <path> [--emit] [--draft] [--write] [--fn name] [--all]
              [--dry-run] [--exit-on-diff] [--from paths…]
```

```bash
nudo contract src/lib.js                     # print effective interfaces
nudo contract --draft src/lib.js             # reviewable *.nudo.draft.js
nudo contract --draft --write src/lib.js     # write the draft
nudo contract --emit src/lib.js --fn add2    # persist @generated sidecar segment
nudo contract --emit src/lib.js --all --dry-run --exit-on-diff  # CI drift gate
```

- Handwritten sidecar bindings always win over generated segments.
- `--emit --exit-on-diff` exits `1` when the write would produce a diff.
- Usage-site evidence: `--from <paths…>`.

---

## `nudo export`

Project Abs into ecosystem artifacts. This is the **only** CLI path for `.d.ts`, guards, and Zod schemas.

```bash
nudo export <path> [--format dts|guard|zod|all] [--out dir]
```

```bash
nudo export src/user.js --format dts --out dist/types
nudo export src/user.js --format zod
nudo export src/user.js --format all --out dist
```

| Format | Artifact |
|--------|----------|
| `dts` | TypeScript declarations (one widened signature per function; case precision in JSDoc) |
| `guard` | Runtime type-guard functions |
| `zod` | Zod schemas |
| `all` | All three |

`.d.ts` is a **one-way, lossy projection** — Abs is the source of truth. Export is a one-shot shipping command; it does not take `--watch`.

---

## `nudo health`

Project health: analysis errors and solidification drift. Renamed from `nudo doctor`.

```bash
nudo health [paths…] [--watch] [--from paths…] [--json]
```

Exit `1` on drift or analysis errors. Uncovered functions are informational only.

```bash
nudo health src/ --from tests/
```

When generated `call@` directives would change, health reports drift and suggests:

```text
nudo test lib.js --from test.js --freeze=update
```

---

## `nudo env harvest`

Harvest `@types/<pkg>` into a Nudo env module.

```bash
nudo env harvest <pkg> [--out dir]
```

```bash
nudo env harvest node
```

Then reference the generated env from source:

```ts
/// @nudo:env ./nudo-harvest-node.ts
```

---

## Migration / deprecated verbs

Old verbs remain temporarily with **stderr deprecation warnings** and map to the new surface. They will be removed in the next major; they are not permanent silent synonyms.

| Deprecated | Use instead |
|------------|-------------|
| `nudo infer <path>` | Signatures → `nudo check <path>`; case report → `nudo test <path>`; dts → `nudo export --format dts` |
| `nudo types <path>` | `nudo check --abs` |
| `nudo interface` / `nudo refine` | `nudo contract` |
| `nudo generate` / `nudo emit` / `nudo guard` | `nudo export --format dts\|guard\|zod\|all` |
| `nudo doctor` | `nudo health` |
| `nudo watch` | `nudo check --watch` / `nudo test --watch` |
| `nudo harvest <pkg>` | `nudo env harvest <pkg>` |
| `--callsites` | `--from` |
| `--emit-cases[=update]` | `nudo test --freeze[=update]` |
| `infer --dts` | `nudo export --format dts` |

`infer --json` splits by consumer: diagnostics/signatures → `check --json`; cases → `test --json`. There is **no** `check --cases` flag — observation and enforcement stay separate.

---

## Typical workflows

### Day 0 — read types from existing JS

```bash
nudo check src/app.js          # signatures + L2 entry throws
nudo test src/app.js           # every call-site case
```

### Day 1 — explicit contracts

```bash
nudo contract --draft src/lib.js --write   # reviewable draft
nudo check src/lib.js                      # L1 + L2 gate
```

### CI

```bash
nudo check src/ --json
# optional: ignore noisy L2 types while migrating
nudo check src/ --ignore-throws TypeError
```

### Ecosystem types

```bash
nudo export src/api.js --format dts --out dist/types
```

### Continuous development

```bash
nudo check src/ --watch
# or
nudo test src/ --watch
```

---

## `any` vs `unknown`

| | `any` | `unknown` |
|---|-------|-----------|
| Meaning | Unconstrained: the union of JS values; **developer** refines | **Inference failed** / engine has no information; **Nudo** must fix |
| Source | Unannotated entry params, explicit `any()`, refine parse fallback | Evaluation failure, unmodeled native, truncation, leak, opaque |
| Display | `any` (optionally with a type-var like `A1`) | `unknown` + conf annotation |
| Product story | “No written contract ⇒ default constraint is `any` + JS runtime effects” | “Nudo hit a case it cannot handle” |

**Never** describe unconstrained entry params as `unknown`. See [Type Values](../concepts/type-values.md#any-vs-unknown).

---

## Exit codes

| Command | Exit `1` when |
|---------|----------------|
| `check` | Any error-level diagnostic (L1 or non-ignored L2) |
| `test` | Any **declared** assertion fails (synthetic `call@`/`entry@` do not fail the run) |
| `contract` (read-only) / `export` | Usage / IO errors only |
| `contract --emit --exit-on-diff` | Write would happen and a diff exists |
| `health` | Drift or analysis errors |

CI gates only on `check` (plus `test` declared assertions and `health` drift).
