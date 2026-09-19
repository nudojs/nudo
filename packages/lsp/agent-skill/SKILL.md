---
name: nudo
description: Query precise JavaScript types by abstract interpretation — use when the project uses Nudo (@nudo: directives) and you need the inferred type of a variable or expression, a function's input→output type trace, what-if type hypotheses, case coverage, or type diagnostics for a .js file.
---

# Nudo — type inference for JavaScript

Nudo is a comment-driven type inference engine for plain JavaScript. The type system is **Abs** (`shape × term × pred × conf`); production analysis is Abs-native. It derives types by **executing** observed call sites under abstract interpretation (whole-program inference). Contracts live in `*.nudo.js` sidecars and `@nudo:refine` / contract modules (constraint builders such as `number()`, `lit(42)`, `shape({...})`). `@nudo:case` is debug / `nudo test` only — not the contract product.

## CLI verbs agents should use

Primary surface (no observation verb):

```bash
nudo check <path> [--json] [--abs] [--from paths…] [--ignore-throws names]
nudo test <path> [--json] [--from paths…] [--freeze[=update]]
nudo contract <path> [--emit] [--draft] [--write] [--fn name]
nudo export <path> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
nudo health [paths] [--from paths…] [--json]
nudo env harvest <pkg>
```

- **Observation** = `check` signatures (printed on success too) + `test` case report + IDE hover.
- Unconstrained entry params display as **`any`**. `unknown` means inference failed (engine debt).
- L2: undigested may-throw on **entry/export** functions is an error (`nudo:entry-may-throw`). Internal helpers are not gated. Filter with `--ignore-throws TypeError`.

## Install and connect

Nudo's agent face lives in its language server. Install it in the user's project (or globally):

```bash
npm i @nudojs/lsp          # project-local; or: npm i -g @nudojs/lsp
```

The server speaks LSP over stdio:

```bash
nudo-lsp                                    # after npm i -g @nudojs/lsp
node node_modules/@nudojs/lsp/dist/server.js
```

Three ways to connect (details in the [Agent Integration Guide](https://nudojs.github.io/nudo/docs/guides/mcp-server)):

1. **Generic LSP→MCP bridge** (cclsp, mcpls, agent-lsp) — registers Nudo as the language server for `.js` files; verify the bridge passes through `workspace/executeCommand`.
2. **Native LSP client** — spawn the server over stdio, `initialize`, then call `workspace/executeCommand` (or the custom request aliases below).
3. **VS Code / Cursor / Zed** — `nudo-vscode` or the Zed extension launches the server automatically.

## Command cheat sheet

All commands are available as `workspace/executeCommand` (dot form) and as custom LSP requests (slash form); agents use the `file` parameter everywhere (accepts a `file://` URI or a bare path). Editor extensions call the `nudo/selectCase` / `nudo/getActiveCases` requests with editor-style `uri` params instead — same handlers. Files that are not open in an editor are read from disk. `whatIf`, `suggestCase`, and `trace` return MCP-style text content — `{ content: [{ type: "text", text }] }`.

| Command (request alias) | Arguments (JSON) | Returns |
|---|---|---|
| `nudo.check` (`nudo/check`) | `{ "file": "src/app.js", "format": "json"? }` | CheckJson v1 — same as CLI `nudo check` (signatures + L1/L2; reads `package.json#nudo.check`) |
| `nudo.test` (`nudo/test`) | `{ "file": "src/app.js", "functions"?: ["parse"] }` | CaseJson v1 — case report face (CLI `nudo test`) |
| `nudo.whatIf` (`nudo/whatIf`) | `{ "file": "src/config.js", "bindings": [{ "name": "raw", "type": "string" }], "target": "size" }` | Text: the inferred type of `target` **under the assumed bindings** — e.g. `Type of "size": number`; bindings match top-level declarations only |
| `nudo.trace` (`nudo/trace`) | `{ "file": "src/app.js", "functionName": "parse" }` | Text: one line per case, e.g. `Input: (string()) => Output: number` |
| `nudo.suggestCase` (`nudo/suggestCase`) | `{ "file": "src/app.js", "functionName": "parse" }` | Text: paste-ready `@nudo:case` directives when every case is call-site synthesized; otherwise the current case count or a suggested directive |
| `nudo.selectCase` (`nudo/selectCase`) | `{ "file": "src/app.js", "functionName": "parse", "caseIndex": 1 }` | `{ "success": true }` — switches the active case (affects hover/diagnostics until changed back) |
| `nudo.getActiveCases` (`nudo/getActiveCases`) | `{ "file": "src/app.js" }` | `{ "parse": 1, "greet": 0 }` — active case index per function |
| `nudo.contract` (`nudo/contract`) | `{ "file": "src/lib.js", "functionName": "add4"? }` | Text: each export's effective contract (handwritten / generated / implicit) — same data as CLI `nudo contract` |
| `nudo.contract.draft` (`nudo/contract.draft`) | `{ "file": "src/lib.js", "functionName": "add4"? }` | Draft summary — same as CLI `nudo contract --draft` |
| `nudo.contract.emit` (`nudo/contract.emit`) | `{ "file": "src/lib.js", "functionName": "add4", "mode": "update" }` | Persist the inferred contract as an `@generated` segment in `*.nudo.js` — same as CLI `nudo contract --emit` |

Diagnostics (failed `@nudo:refine` assertions, L2 entry may-throw, unreachable code, …) are available as LSP diagnostics — push (`textDocument/publishDiagnostics`) and pull (`textDocument/diagnostic`). Persisted-contract drift surfaces as `nudo:interface-drift` warnings.

## Contract sidecars (`*.nudo.js`)

- **Handwritten root** in `lib.nudo.js` (e.g. `export const add4 = fn({ x: positive }, positive4)`) drives **downstream derivation**: `nudo contract --emit lib.js --fn add2` writes a compositional `@generated` segment into `add.nudo.js` (`fn({ x }, x.shift(2))`), not an expanded dump.
- Without `--fn`/`--all`, emit only **refreshes existing** `@generated` segments — it does not invent new contracts.
- Handwritten sidecar bindings always win; emit refuses to overwrite them (`nudo:interface-name-clash`).
- **Package allowlist**: `package.json` → `"nudo": { "contract": { "emit": ["src/api/**"] } }`. Empty/omitted = no path filter. Paths outside the allowlist are denied (`nudo:interface-emit-denied`).
- `nudo health` fails CI when a file with `@generated` sidecar segments has persisted-contract drift (`nudo:interface-drift`).

## What-if workflow

The signature move: hypothesize a type for a top-level binding, observe what another binding becomes — without editing any source.

```js
// src/config.js
const raw = readInput();
const size = raw.length;
```

Assume `raw` is a string, ask what `size` is:

```json
{
  "command": "nudo.whatIf",
  "arguments": [{
    "file": "src/config.js",
    "bindings": [{ "name": "raw", "type": "string" }],
    "target": "size"
  }]
}
```

→ `Type of "size": number`. Then flip the hypothesis (`"type": "string | null"`) and re-ask: the same `size` now reports `unknown` (inference under that hypothesis has no precise result for `.length` on null). Use this to preview refactors, validate an API's return type before calling it, or compare how alternative type assumptions ripple through downstream code.

Bindings only match **top-level declarations** (`const`/`let`/`var`/`function`) in the file. A function parameter name does not resolve — you get `Type of "...": unknown` plus `Bindings not applied (no top-level declaration found): x` in the reply.

## Type expression syntax

`bindings[].type` accepts a primitive or a `|`-separated union of primitives:

- `number`, `string`, `boolean`, `null`, `undefined`, `bigint`, `symbol`
- Unions: `string | null`, `number | string`

## Notes

- **Unopened files use disk state.** If the file is not open in a connected editor, analysis runs on the on-disk content; edits the user has not saved are invisible.
- Commands that report types reflect Nudo's inference, which follows runtime semantics (e.g. `Number("")` is `0`, not an error) — trust them over guesswork, but remember they describe the current code, not the user's intent.
- Whole-program inference means every function with inferable call sites already has observations. When all of them are call-site synthesized, `suggestCase` returns ready-to-paste `@nudo:case` **debug** directive text (paste it above the function for `nudo test` / LSP scenarios — not the contract product); `already has N case(s)` is the normal report for the rest, not an error.
- For CI/type truth prefer CLI `nudo check` (signatures + gate) and `nudo test` (cases). For contract persistence use `nudo contract`. For `.d.ts`/schema/standard/guard use `nudo export`.
