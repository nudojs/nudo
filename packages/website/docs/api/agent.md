---
sidebar_position: 5
description: "Agent API — nudo.* commands: check (Abs gate), infer, hover, whatIf, suggestCase, trace, selectCase, getActiveCases."
---

# Agent API

Reference for the agent-facing surface of `@nudojs/lsp`. All agent commands live inside the Nudo language server and are reached through standard `workspace/executeCommand` calls or custom LSP requests — there is no separate server process or protocol to install. For connection setup (LSP→MCP bridges, native LSP clients, VS Code), see the [Agent Integration Guide](../guides/mcp-server.md).

## Commands

| Command | Custom request alias | Purpose |
|---------|---------------------|---------|
| `nudo.check` | `nudo/check` | Constraint gate — **CheckJson v1** (Abs signatures + actual ⊭ expected) |
| `nudo.infer` | `nudo/infer` | Whole-file inference — **InferJson v1** (intension carries lossless Abs) |
| `nudo.hover` | `nudo/hover` | Lossless Abs at a source position (+ optional inlays + interface tier) |
| `nudo.whatIf` | `nudo/whatIf` | Apply type assumptions to bindings and read the inferred type of a target |
| `nudo.suggestCase` | `nudo/suggestCase` | Check `@nudo:case` coverage; when every case is synthesized, return paste-ready directives |
| `nudo.trace` | `nudo/trace` | List each case's argument types → result type for a function |
| `nudo.interface` | `nudo/interface` | Print effective interface tiers (`handwritten` / `generated` / `implicit`) |
| `nudo.interface.draft` | `nudo/interface.draft` | **Code-first draft**: reviewable `*.nudo.draft.js` from existing code (same as CLI `--draft`) |
| `nudo.interfaceEmit` | `nudo/interface.emit` | Persist call-site domains as `@generated` sidecar segments |
| `nudo.selectCase` | `nudo/selectCase` | Switch the active case used for hover/diagnostics |
| `nudo.getActiveCases` | `nudo/getActiveCases` | Read the active case index of every function in a file |

`nudo.check` / `nudo.infer` / `nudo.hover` / `nudo.whatIf` / `nudo.suggestCase` / `nudo.trace` / `nudo.interface*` return MCP-style text content — `{ content: [{ type: "text", text }] }`. `nudo.selectCase` returns `{ success: true }`; `nudo.getActiveCases` returns `Record<string, number>`. Shared sources are pinned by `AGENT_TOOL_SOURCES` (E5) — agent tools and CLI/LSP commands call the same service/core entrypoints.

## Conventions

- **`file` parameter** — every command takes a `file` string, accepting either a `file://` URI or a bare path. Files that are not open in an editor are read from disk.
- **Editor-style requests** — the `nudo/selectCase` and `nudo/getActiveCases` requests additionally accept editor-style `{ uri, ... }` params (this is what the VS Code extension's CodeLens uses). Agents should always use `file`.
- **Type expressions** — see [Type expressions](#type-expressions) below.
- **Abs-first** — `check` / `infer` / `hover` expose the lossless algebra (Abs). Extensional strings (`args` / `result` / `ext`) are lossy projections for compatibility, not the type model.

---

## nudo.check

Constraint gate on **Abs** (type-as-computation). Same contract as CLI `nudo check --json`. See [nudo check](../guides/check.md).

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path |
| `source` | `string?` | Pre-read source (bypasses disk/editor) |
| `format` | `"text" \| "json"` | `"json"` → CheckJson only; default human summary + JSON |

**Returns (CheckJson v1):** `{ version: 1, file, ok, summary, signatures[], issues[] }` where each issue may carry `actual` / `expected`. Issue codes (full table: [check guide](../guides/check.md)):

| Code | Meaning |
|------|---------|
| `nudo:constraint-violated` | Call argument or return ⊭ precondition |
| `nudo:assign-mismatch` | Assignment ⊭ existing shape |
| `nudo:arg-structure` | HOF argument not callable / arity mismatch |
| `nudo:case-inconsistency` | `@nudo:case` witness ⊭ refine |
| `nudo:interface-param-mismatch` | Handwritten contract param name not on formal surface |
| `nudo:interface-conflict` | Handwritten contract conjunction unsatisfiable |
| `nudo:interface-load` / `nudo:interface-cycle` | Sidecar load failure / cycle |
| `nudo:interface-domain-exceeds` | Cross-file call evidence ⊄ handwritten contract |
| `nudo:interface-name-clash` | Sidecar export name clashes with source export |
| `nudo:interface-underivable` | Handwritten contract cannot be derived from source |
| `nudo:interface-drift` | `@generated` segment ≠ recomputed (warning) |
| `nudo:no-signature` | No symbolic Abs signature |
| `nudo:opaque-result` / `nudo:eval-error` | Opaque evaluation / evaluation threw |

```json
{
  "command": "nudo.check",
  "arguments": [{ "file": "src/validators.js", "format": "json" }]
}
```

## nudo.infer

Whole-file inference — same contract as CLI `nudo infer --json`.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path or URI |
| `source` | `string?` | Pre-read source |
| `format` | `"text" \| "json"` | `"json"` → InferJson only |
| `functions` | `string[]?` | Filter to these function names |

**Returns (InferJson v1):** `cases[].intension` carries `abs` / `term` / `pred` / `conf` (lossless); `args` / `result` are extensional strings (`formatShape` projections).

```json
{
  "command": "nudo.infer",
  "arguments": [{ "file": "src/app.js", "functions": ["scale"], "format": "json" }]
}
```

## nudo.hover

Lossless Abs at a position — same source as editor hover, no projection in between.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path or URI |
| `line` | `number` | **1-based** line |
| `column` | `number` | **0-based** column |
| `source` | `string?` | Pre-read source |
| `includeInlays` | `boolean?` | Also return all Abs inlays for the file |

**Returns JSON:** `{ file, line, column, abs, absMultiline, intension, ext, inlays? }` — `abs` is lossless; `ext` is the extensional projection for comparison only.

## nudo.whatIf

Set type assumptions and observe the inferred type at another position — the primary tool for AI-driven type exploration.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |
| `bindings` | `Array<{ name: string, type: string }>` | Type assumptions to apply. `name` must be a **top-level declaration** (a top-level `const`/`let`/`var`, function, or class) — function parameters and locals have no matching declaration and are reported back as not applied. `type` is a type expression such as `number` or `string \| null` |
| `target` | `string` | Top-level variable to get the type of |

**Returns:** `{ content: [{ type: "text", text }] }` where `text` is `Type of "<target>": <type>` — the inferred type of the target **under the assumed bindings**, or `unknown` if it is not a known binding. Trailing note lines report which bindings took effect: `Bindings applied: …` and, for names with no top-level declaration, `Bindings not applied (no top-level declaration found): …` (the answer then uses the file's own types).

**Example** — given `src/config.js` with `const size = raw.length` where `raw` comes from an unknown loader, assume `raw` is `string` and ask what `size` becomes:

```javascript
const raw = loadRaw();
const size = raw.length;
```

```json
{
  "command": "nudo.whatIf",
  "arguments": [
    {
      "file": "src/config.js",
      "bindings": [{ "name": "raw", "type": "string" }],
      "target": "size"
    }
  ]
}
```

```text
Type of "size": number
Bindings applied: raw: string
```

## nudo.suggestCase

Suggest `@nudo:case` directives for a function based on its parameter types.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |
| `functionName` | `string` | Name of the function |

**Returns:** `{ content: [{ type: "text", text }] }` with one of four outcomes:

- `Function "<functionName>" not found` — the file has no such function.
- `Suggested: /** @nudo:case */` followed by `function <functionName>(...) { ... }` — the function has no cases at all (only functions skipped by inference end up with zero cases).
- `Function "<functionName>" already has N case(s)` — the function has handwritten (or entry-only) `@nudo:case` cases; they are left untouched.
- Every case was synthesized from call sites — the reply is directive text that can be pasted into the source directly above the function, e.g.:

```text
Function "add" has 2 synthesized case(s); suggested directives:
/**
 * @nudo:case "call@L2" (1, 2)
 * @nudo:case "call@L3" ("x", "y")
*/
```

Cases whose arguments cannot be serialized as directives (functions, Promises, instances, …) are dropped and reported in a trailing `(M case(s) skipped: not serializable as directives)` line; if none of the cases is serializable, the reply falls back to `Function "<functionName>" already has N case(s) (none serializable as directives)`.

## nudo.trace

Trace how a type transforms from input to output in a function — one line per case.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |
| `functionName` | `string` | Function to trace |

**Returns:** `{ content: [{ type: "text", text }] }` with one `Input: (<argument types>) => Output: <result type>` line per case, or `Function "<functionName>" not found` / `No cases found for "<functionName>"`.

## nudo.selectCase

Switch the active case of a function. The active case drives hover types, diagnostics, and inlay hints until changed again.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |
| `functionName` | `string` | Name of the function |
| `caseIndex` | `number` | 0-based index of the case to activate |

**Returns:** `{ success: true }`. The server revalidates the document with the new active case and refreshes CodeLens.

## nudo.getActiveCases

Read the active case index of every function in a file.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |

**Returns:** `Record<string, number>` mapping function name → active case index, e.g. `{ "parse": 1, "greet": 0 }`.

## nudo.interface / nudo.interface.draft / nudo.interfaceEmit

Interface product surface (same data sources as CLI):

| Command | Args | Behavior |
|---------|------|----------|
| `nudo.interface` | `{ file, functionName?, loadModule?, autoBind? }` | Print `fn  [handwritten\|generated\|implicit]  (params) → returns` + JSON |
| `nudo.interface.draft` | `{ file, functionName?, write?, dryRun?, loadModule?, autoBind? }` | Code-first draft module (`@nudo:draft`); `write: true` lands `*.nudo.draft.js` (not ambient-bound). Body-read fields appear as **suggestions only** |
| `nudo.interfaceEmit` / `nudo.interface.emit` | `{ file, functionName, mode: "add"\|"update" }` | Persist call-site domains via `emitInterface` |

Handwritten contracts are never overwritten by draft or emit. Accept a draft by copying reviewed exports into `*.nudo.js`.

## Type expressions

The `type` field of `nudo.whatIf` bindings accepts a primitive or a `|`-separated union of primitives:

| Expression | Meaning |
|------------|---------|
| `number` \| `string` \| `boolean` | The primitive type |
| `null` \| `undefined` | The corresponding singleton |
| `bigint` \| `symbol` | The remaining primitives |
| `string \| null` | Union — "string or null" |

Forms already in `T.*` syntax and structural expressions (object/array literals, `=>` functions) pass through to the directive grammar (`parseTypeValueExpr`); any other name becomes `T.unknown`.

## Diagnostics

Type errors (failed `@nudo:refine` assertions, unreachable code, …) are available as LSP diagnostics in both directions:

- **Push**: `textDocument/publishDiagnostics` after each analysis
- **Pull**: `textDocument/diagnostic` on demand

Pull mode is the natural fit for agents: open (or point at) a file, send `textDocument/diagnostic`, and read the severity-1 entries — no command call needed.

## Migration from the MCP server

The standalone `@nudojs/mcp` package is retired; its tools map onto the commands above:

| Old MCP tool | Replacement |
|--------------|-------------|
| `nudo-what-if` | `nudo.whatIf` — `bindings` are now actually applied (previously ignored) |
| `nudo-check` | `nudo.check` (CheckJson v1) or pull diagnostics via `textDocument/diagnostic` |
| `nudo-type-at` | `nudo.hover` (lossless Abs), or `nudo.whatIf` with empty `bindings` and `target` set |
| `nudo-suggest-case` | `nudo.suggestCase` |
| `nudo-trace` | `nudo.trace` |

See the [migration section](../guides/mcp-server.md#migrating-from-the-mcp-server) of the guide for connection-level changes.
