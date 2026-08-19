---
name: nudo
description: Query precise JavaScript types by abstract interpretation — use when the project uses Nudo (@nudo: directives) and you need the inferred type of a variable or expression, a function's input→output type trace, what-if type hypotheses, case coverage, or type diagnostics for a .js file.
---

# Nudo — type inference for JavaScript

Nudo is a comment-driven type inference engine for plain JavaScript. It derives types by **executing** code with symbolic type values (`T.number`, `T.string`) instead of requiring TypeScript annotations: functions marked with `@nudo:case` directives are run under abstract interpretation, and unmarked functions get cases synthesized from their call sites (whole-program inference). Ask Nudo instead of guessing what a refactor does to types.

## Install and connect

Nudo's agent face lives in its language server. Install it in the user's project (or globally):

```bash
npm i @nudojs/lsp          # project-local; or: npm i -g @nudojs/lsp
```

The server speaks LSP over stdio:

```bash
node node_modules/@nudojs/lsp/src/server.ts   # Node >= 22.18; on older Node: npx tsx <path>
```

Three ways to connect (details in the [Agent Integration Guide](https://nudojs.github.io/nudo/docs/guides/mcp-server)):

1. **Generic LSP→MCP bridge** (cclsp, mcpls, agent-lsp) — registers Nudo as the language server for `.js` files; verify the bridge passes through `workspace/executeCommand`.
2. **Native LSP client** — spawn the server over stdio, `initialize`, then call `workspace/executeCommand` (or the custom request aliases below).
3. **VS Code / Cursor** — the `nudo-vscode` extension launches the server automatically.

## Command cheat sheet

All commands are available as `workspace/executeCommand` (dot form) and as custom LSP requests (slash form); agents use the `file` parameter everywhere (accepts a `file://` URI or a bare path). Editor extensions call the `nudo/selectCase` / `nudo/getActiveCases` requests with editor-style `uri` params instead — same handlers. Files that are not open in an editor are read from disk. `whatIf`, `suggestCase`, and `trace` return MCP-style text content — `{ content: [{ type: "text", text }] }`.

| Command (request alias) | Arguments (JSON) | Returns |
|---|---|---|
| `nudo.whatIf` (`nudo/whatIf`) | `{ "file": "src/config.js", "bindings": [{ "name": "raw", "type": "string" }], "target": "size" }` | Text: the inferred type of `target` **under the assumed bindings** — e.g. `Type of "size": number`; bindings match top-level declarations only |
| `nudo.trace` (`nudo/trace`) | `{ "file": "src/app.js", "functionName": "parse" }` | Text: one line per case, e.g. `Input: (T.string) => Output: number` |
| `nudo.suggestCase` (`nudo/suggestCase`) | `{ "file": "src/app.js", "functionName": "parse" }` | Text: paste-ready `@nudo:case` directives when every case is call-site synthesized, e.g. `Function "parse" has 2 synthesized case(s); suggested directives:`; otherwise the current case count, e.g. `Function "parse" already has 3 case(s)`, or a suggested `@nudo:case` directive |
| `nudo.selectCase` (`nudo/selectCase`) | `{ "file": "src/app.js", "functionName": "parse", "caseIndex": 1 }` | `{ "success": true }` — switches the active case (affects hover/diagnostics until changed back) |
| `nudo.getActiveCases` (`nudo/getActiveCases`) | `{ "file": "src/app.js" }` | `{ "parse": 1, "greet": 0 }` — active case index per function |

Diagnostics (failed `@nudo:returns` assertions, unreachable code, …) are available as LSP diagnostics — push (`textDocument/publishDiagnostics`) and pull (`textDocument/diagnostic`).

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

→ `Type of "size": number`. Then flip the hypothesis (`"type": "string | null"`) and re-ask: the same `size` now reports `unknown`, because the null arm can propagate through `.length`. Use this to preview refactors, validate an API's return type before calling it, or compare how alternative type assumptions ripple through downstream code.

Bindings only match **top-level declarations** (`const`/`let`/`var`/`function`) in the file. A function parameter name does not resolve — you get `Type of "...": unknown` plus `Bindings not applied (no top-level declaration found): x` in the reply.

## Type expression syntax

`bindings[].type` accepts a primitive or a `|`-separated union of primitives:

- `number`, `string`, `boolean`, `null`, `undefined`, `bigint`, `symbol`
- Unions: `string | null`, `number | string`

## Notes

- **Unopened files use disk state.** If the file is not open in a connected editor, analysis runs on the on-disk content; edits the user has not saved are invisible.
- Commands that report types reflect Nudo's inference, which follows runtime semantics (e.g. `Number("")` is `0`, not an error) — trust them over guesswork, but remember they describe the current code, not the user's intent.
- Whole-program inference means every function with inferable call sites already has cases. When all of them are call-site synthesized, `suggestCase` returns ready-to-paste `@nudo:case` directive text (paste it above the function); `already has N case(s)` (handwritten or entry-only cases) is the normal report for the rest, not an error.
