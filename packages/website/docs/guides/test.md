---
slug: /guides/test
description: nudo test — per-case call-site ground truth on Abs; synthetic call@/entry@ cases print by default; declared @nudo:case assertions drive the exit code; --from, --freeze, --json, --abs.
---

# nudo test

`nudo test` is a **debug / scenario reporter, not the CI gate.** The gate is [`nudo check`](./check.md) (L1 contracts + L2 entry throws) — only signatures + constraint violations + throws enter CI. Use `test` to inspect how Nudo executed cases (`call@` / `entry@` / `debug` witnesses), to drive declared `@nudo:case` assertions, or to pin regressions via `--freeze`.

**You'll leave with:** the default case report (`call@` / `entry@` / `debug` witnesses), declared assertions — the only thing that fails the run — witness solidification with `--freeze`, and a clean split between `test` and `check`.

`nudo test` is Nudo's **case report**: per-call-site ground truth computed on Abs. It is the **observation face**, not the CI gate.

- Every inferred case prints by default — synthetic `call@L…` / `entry@L…` cases **and** `debug` witnesses.
- Only **declared assertions** (`@nudo:case "…" (args) => expected`) enter pass/fail; only their failures set exit `1`.
- Analysis diagnostics print after the report for awareness — they do not set the exit code.

The gate lives in [`nudo check`](./check.md) (L1 contracts + L2 entry throws). Observation needs no verb of its own: it is `check` signatures, `test` case reports, and IDE hover.

```bash
nudo test <path> [--watch|-w] [--from paths…] [--freeze[=mode]] [--dry-run] [--exit-on-diff] [--json] [--abs]
```

## Default output

```js verify#math
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
nudo test  math.js

=== subtract ===
  call@L5  (5, 3) => 2
  call@L6  (1, 10) => -9

assertions
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 2 synthetic case(s) printed above)
```

Nobody wrote those cases. Nudo executed `subtract` with the arguments each call site actually passed and reported the results. Reading the sections:

| Line | Meaning |
|------|---------|
| `=== fn ===` | One section per analyzed function; imported modules group under `--- <module> (imported) ---` |
| `call@L…` | A real call site (line `L` in the analyzed file or a `--from` usage site), executed with its actual arguments |
| `entry@L…` | The fallback for functions nobody calls — parameters default to **`any`** (unconstrained), never `unknown`. When `call@` cases exist, no `entry@` is synthesized for that function |
| `debug "name"` | An `@nudo:case` witness (see below) |
| `   throws TypeError` | Appended to any case whose path may throw |

The entry-only fallback, on a function with no call sites anywhere:

```js verify#entry
export function getName(user) {
  return user.name;
}
```

```text
=== getName ===
  entry@L1  (any) => any   throws TypeError
```

### The assertions summary

The `assertions` block counts **declared cases only** — synthetic `call@` / `entry@` never enter it:

- `✓ N passed · N failed · N unchecked` when declared expectations exist (`✗` when any failed);
- `— 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; N synthetic case(s) printed above)` when none are declared.

`unchecked` is a `@nudo:case` **without** `=> expected`: a witness Nudo executes and reports, but does not judge. Analysis diagnostics, when present, print after the report as `[severity] file:line:col message (code)` — for awareness; the exit code stays driven by declared assertions.

## Declared assertions

`@nudo:case "name" (args) => expected` declares an expectation. Nudo executes the case and checks the actual result against the expected Abs (`leqAbs`):

```js verify#dbl
/**
 * @nudo:case "double" (2) => 4
 * @nudo:case "bad" (3) => 7
 */
export function double(x) {
  return x * 2;
}
```

```bash
nudo test dbl.js
```

```text
nudo test  dbl.js

=== double ===
  debug "double"  (2) => 4
  debug "bad"  (3) => 6

assertions
  ✗ 1 passed · 1 failed · 0 unchecked
  [ok]   double  case "double" → 4
  [FAIL] double  case "bad"
         expected: 7
         actual:   6

diagnostics
  [error] dbl.js:3:0 debug "bad": expected 7, got 6. The inferred return type does not match the expected type declared in the @nudo:case witness (nudo:case-expected)
```

Exit `1` — a declared assertion failed.

A case may also declare its intentional throw domain with the `!! throws` suffix (`@nudo:case "neg" (0) !! throws` declares any throw; `!! throws Error` declares by kind). It is parsed alongside `@nudo:throws` in core's `refine.ts` — full syntax in the [directive reference](../concepts/directives.md#nudocase--debug-witnesses). `@nudo:case` stays debug/test/LSP surface; the contract product is `*.nudo.js` / `@nudo:contract`.

| Code | Meaning |
|------|---------|
| `0` | All declared assertions passed (or none declared) |
| `1` | Any **declared assertion** failed — synthetic `call@` / `entry@` cases never block exit |

Full exit-code contract: [CLI Reference](../api/cli-reference.md#nudo-test).

## Freeze witnesses (`--freeze`)

Synthetic cases exist only inside the run that produced them. `--freeze` writes them back into the analyzed file as real `@nudo:case` directives, so the shapes survive outside the run:

```bash
nudo test lib/ --from tests/ --freeze          # add (default): fill functions that have no case directives
nudo test lib/ --from tests/ --freeze=update   # re-synchronize previously generated call@ directives
```

- Hand-written cases (names not starting with `call@`) are **never touched**; `call@` is a reserved prefix.
- `--dry-run` prints a unified diff instead of writing:

```text
freeze: would write cases → math.js (dry run)
  subtract: call@L5, call@L6
--- a/math.js
+++ b/math.js
@@ -1,3 +1,7 @@
+       /**
+        * @nudo:case "call@L5" (5, 3)
+        * @nudo:case "call@L6" (1, 10)
+        */
 export function subtract(a, b) {
   return a - b;
 }
```

- `--exit-on-diff` (requires `--dry-run`) exits `1` when the diff is non-empty — the CI drift gate for frozen witnesses.

The merge policy (what each mode touches, serializable-shape limits) is specified in [Call-Site Discovery](./callsite-discovery.md). To watch that drift continuously instead of refreshing by hand, [`nudo health`](./health.md) re-runs the same re-solidify chain and exits `1` as soon as generated directives would change.

## Usage sites (`--from`)

`--from <paths…>` points at usage-site files — tests, examples, upstream apps. Nudo harvests their real call records and injects each matched call as a `call@L` case, so argument shapes come from how the code is *actually* used rather than from hand-written directives. The two-phase harvest, the attribution gate, and trial numbers live in [Call-Site Discovery](./callsite-discovery.md).

## Machine-readable and algebra faces

`--json` emits `CaseJson` v1 — **single file only**; cannot combine with `--abs` or `--freeze` — with `version` / `file` / `summary` / `functions[].cases[]` (extensional `args` / `result` / `throws`, plus lossless `argsAbs` / `resultAbs` / `intension` where available) and an `assertions` summary on top. Excerpt (trimmed):

```json
{
  "version": 1,
  "file": "dbl.js",
  "summary": { "functions": 1, "externalFunctions": 0, "cases": 3, "diagnostics": 1 },
  "functions": [
    {
      "name": "double",
      "entryOnly": false,
      "cases": [
        {
          "name": "double",
          "args": ["2"],
          "result": "4",
          "throws": null,
          "source": "directive",
          "argsAbs": ["2  #exact"],
          "resultAbs": "4  #exact",
          "intension": {
            "display": "double: (x: A1) => number = (A1 * 2)",
            "abs": "4  #exact",
            "term": "(A1 * 2)",
            "conf": "exact"
          }
        }
      ]
    }
  ],
  "assertions": { "passed": 1, "failed": 1, "unchecked": 1 }
}
```

`--json` still exits `1` when a declared assertion fails.

`--abs` prints the `check --abs` algebra face (per-function shape + conf) first, then the case report — declared assertion failures stay visible and still block exit. `--watch` / `-w` re-runs on file changes (a mode flag, not a verb).

## test vs check

| | `nudo check` | `nudo test` |
|---|---|---|
| Role | **Gate**: L1 explicit contracts + L2 entry may-throw | **Report**: per-case ground truth + declared assertions |
| Prints | Signatures (always, even on success) + issues | Every case (`call@` / `entry@` / `debug`) + assertions summary |
| Exit `1` | Any error-level diagnostic | Any declared assertion failed |
| CI | The product gate (analogue of `tsc --noEmit`) | Optional: declared assertions, freeze drift |

Observation is not a separate verb — it lives in `check` signatures, `test` case reports, and IDE hover.

## Options

| Option | Description |
|--------|-------------|
| `--watch` / `-w` | Re-run on changes (flag, not a verb) |
| `--from <paths…>` | Usage-site files whose calls become `call@L` cases |
| `--freeze[=mode]` | Write synthesized cases back as `@nudo:case` directives (`add` default / `update`) |
| `--dry-run` | With `--freeze`: print a unified diff instead of writing |
| `--exit-on-diff` | With `--freeze --dry-run`: exit `1` when the diff is non-empty |
| `--json` | `CaseJson` (single file; not with `--abs` / `--freeze`) |
| `--abs` | Algebra face (as `check --abs`), then the case report |

Full flag and exit-code tables: [CLI Reference](../api/cli-reference.md#nudo-test).

## Next

- [nudo check](./check.md) — the CI gate in detail
- [Call-Site Discovery](./callsite-discovery.md) — `--from` harvesting, attribution gate, freeze merge policy
- [nudo health](./health.md) — drift as a CI gate
- [CLI Reference](../api/cli-reference.md#nudo-test) — every flag and exit code
