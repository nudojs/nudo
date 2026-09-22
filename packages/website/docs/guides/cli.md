---
description: "Drive Nudo from the terminal: check signatures, report cases, draft contracts, export projections — the six primary verbs."
---

# CLI Usage

The `nudo` CLI is the product surface for type inference on `.js`, `.mjs`, and `.ts` files. Install it globally or via `npx` — see [Installation](../getting-started/installation.md).

## Primary verbs

```text
nudo — JavaScript types, computed

  nudo check <path> [--watch|-w]   # gate contracts + entry throws; print signatures
  nudo test <path> [--watch|-w]    # report every inferred case; assert declared expectations
  nudo contract <path>             # draft / emit interfaces
  nudo export <path>               # project dts / guard / schema / standard
  nudo health [paths]              # project health & drift
  nudo env harvest <pkg>           # harvest @types into an env
```

Observation lives in the output of `check` / `test` and in IDE hover — not a separate primary command.

**Day 0:** `nudo check` (signatures) and `nudo test` (cases).  
**Day 1:** `nudo contract` + `nudo check`.  
**Ecosystem:** `nudo export`.

| Want to know | Run |
|--------------|-----|
| Entry signatures / any / unknown / throws | `nudo check <path>` (prints `signatures` even on success) |
| Per-call-site ground truth / narrowing | `nudo test <path>` (prints every case, including synthetic `call@` / `entry@`) |
| Usage-site argument shapes | `nudo check` / `test` / `contract` `--from <paths…>` |
| Algebra face (shape + conf; `--generalize` adds term/pred α) | `nudo check --abs` (or `test --abs`) |
| Machine-readable | `nudo check --json` / `nudo test --json` |
| Interactive | IDE hover / inlay |

---

## `nudo check`

Gate contracts and entry throws. On success **and** failure, `check` prints signatures — it is not silent.

```bash
nudo check <path> [--watch|-w] [--json] [--verbose] [--abs]
           [--from paths…] [--ignore-throws names] [--entry-throws error|warning|off]
```

```bash
nudo check user.js
```

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
      expected: entry total, or declare/catch throws
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
```

Unconstrained entry parameters display as **`any`**. `unknown` means inference failed (engine debt) — it is never the default for an unconstrained entry parameter. In `[ERROR L# name]`, `L#` is the **line number** of the offending call/declaration — not a contract layer (L1/L2 are the layers). The sample above prints `L1` because `getName` is declared on line 1 of that file — its layer is L2.

- **Semantics** (L1 explicit contracts / L2 entry throws, exit codes, filtering): [nudo check](./check.md)
- **Options & config** (`--watch` / `--json` / `--abs` / `--from` / `--ignore-throws` / `--entry-throws`, `package.json#nudo.check`): [CLI Reference](../api/cli-reference.md#nudo-check)

`nudo check` is the CI gate.

---

## `nudo test`

Report every inferred case and run declared `@nudo:case` assertions.

```bash
nudo test <path> [--watch|-w] [--from paths…] [--freeze[=mode]] [--dry-run] [--exit-on-diff] [--json] [--abs]
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
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 2 synthetic case(s) printed above)
```

- Synthetic `call@` / `entry@` cases **print by default** — that is the call-site observation surface.
- When usage-site `call@` cases exist, the analyzer does **not** also synthesize `entry@` for that function.
- Only `@nudo:case` directives **with `=> expected`** enter pass/fail; failures affect the exit code.
- `--from <paths…>` harvest usage-site call shapes.
- `--freeze[=mode]` solidifies synthesized cases as directives: `--freeze` (or `--freeze=omit`) adds new witnesses; `--freeze=update` re-synchronizes previously generated directives.
- `--dry-run` (with `--freeze`) prints a unified diff instead of writing; `--exit-on-diff` (with `--freeze --dry-run`) exits 1 when the diff is non-empty.
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
```

---

## `nudo contract`

Draft, print, or emit effective interfaces (handwritten / generated / implicit layers).

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

Project Abs into ecosystem artifacts. This is the **only** CLI path for `.d.ts`, guards, and schema projections.

```bash
nudo export <path> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
```

```bash
nudo export src/user.js --format dts --out dist/types
nudo export src/user.js --format schema --dialect zod
nudo export src/user.js --format standard --out dist
nudo export src/user.js --format all --out dist
```

| Format | Artifact |
|--------|----------|
| `dts` | TypeScript declarations (one widened signature per function; case precision in JSDoc) |
| `guard` | Runtime type-guard functions |
| `schema` | Schema **source** projection for a dialect (default dialect: `zod`) → `*.nudo.schema.<dialect>.ts` |
| `standard` | **Standard Schema v1** runtime modules (`~standard`, vendor `nudo`) → `<fn>.nudo.standard.ts` |
| `all` | dts + guard + schema + standard |

Full per-format semantics and exit codes: [CLI Reference](../api/cli-reference.md#nudo-export).

---

## `nudo health`

Project health: analysis errors and solidification drift.

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
nudo env harvest <pkg> [--out file]   # --out is an output .ts file (default ./nudo-harvest-<pkg>.ts)
nudo env harvest --auto [dir]         # scan a dir for bare imports, report auto-harvestable @types
```

```bash
nudo env harvest node
```

Then reference the generated env from source:

```ts
/// @nudo:env nudo-harvest-node.ts
```

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

Unconstrained entry params display as **`any`**; **`unknown`** means inference failed (engine debt) and must never be described as the default for unconstrained params. The full contract (sources, operations, narrowing, product story) lives in [Abs — any vs unknown](../concepts/type-values.md#any-vs-unknown).

---

## Exit codes

Per-command exit contracts: [CLI Reference](../api/cli-reference.md). CI gates only on `check` (plus `test` declared assertions and `health` drift).
