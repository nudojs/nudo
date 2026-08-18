---
sidebar_position: 6
---

# Agent Integration Guide

AI coding agents — Claude Code, Cursor, Copilot, Zed, and friends — access Nudo through its **language server**, [`@nudojs/lsp`](../api/lsp.md). The same server that powers the VS Code extension also exposes five agent commands over standard `workspace/executeCommand` calls, plus pull diagnostics. There is no separate MCP server process to install or keep alive: one server serves the editor *and* the agent.

Full command reference (parameters, return shapes, type-expression syntax): the [Agent API](../api/agent.md) page. A ready-made skill file for agents is published at [`packages/lsp/agent-skill/SKILL.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/agent-skill/SKILL.md).

## Install

```bash
npm i -g @nudojs/lsp
```

The server speaks LSP over stdio. Launch it with Node (type stripping requires Node ≥ 22.18; on older Node use `tsx`):

```bash
node "$(npm root -g)/@nudojs/lsp/src/server.ts"
# or from a project-local install, on any Node:
npx tsx node_modules/@nudojs/lsp/src/server.ts
```

## Three ways to connect

### Option 1: an LSP→MCP bridge

If your agent only speaks MCP, run a generic bridge and register Nudo as the language server for `.js` files. Three bridges work out of the box:

**[cclsp](https://github.com/ktnyt/cclsp)** — configure a `cclsp.json` next to your project:

```json
{
  "extensions": ["js", "mjs", "ts"],
  "command": ["npx", "tsx", "node_modules/@nudojs/lsp/src/server.ts"],
  "rootDir": "."
}
```

Then add the bridge to your MCP client:

```bash
claude mcp add cclsp -- npx cclsp@latest --env CCLSP_CONFIG_PATH=/abs/path/to/cclsp.json
```

**[mcpls](https://github.com/bug-ops/mcpls)** — configure a `mcpls.toml`:

```toml
[[lsp_servers]]
language_id = "javascript"
command = "node"
args = ["node_modules/@nudojs/lsp/src/server.ts"]
file_patterns = ["**/*.js", "**/*.mjs", "**/*.ts"]
```

**[agent-lsp](https://github.com/blackwell-systems/agent-lsp)** — run `agent-lsp init`; it detects language servers on `PATH` and writes the MCP client configs for you, orchestrating them into agent-native workflows.

:::note
Bridges differ in what they forward. Standard LSP features (hover, diagnostics, definition) always come through; if a bridge does not pass `workspace/executeCommand` through to Nudo's five commands, use Option 2 instead.
:::

### Option 2: a native LSP client

Any LSP client library (`vscode-languageserver-protocol`, `pylsp`-style clients, a hand-rolled stdio client) works. Spawn the server, `initialize`, then call `workspace/executeCommand` — the wire messages are plain JSON-RPC and can be sent verbatim:

```jsonc
// 1. handshake
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":"file:///home/you/project","capabilities":{}}}
{"jsonrpc":"2.0","method":"initialized","params":{}}

// 2. ask a what-if question
{"jsonrpc":"2.0","id":2,"method":"workspace/executeCommand","params":{
  "command": "nudo.whatIf",
  "arguments": [{ "file": "src/app.js", "bindings": [{ "name": "x", "type": "string" }], "target": "y" }]
}}
```

The `file` argument accepts a `file://` URI or a bare path. Files that are not open in an editor are read from disk — no `didOpen` required.

### Option 3: the VS Code / Cursor extension

Install the `nudo-vscode` extension and everything in this guide is already wired: the extension launches `@nudojs/lsp`, and in-editor agents get hover types, diagnostics, and case-switching CodeLens through the same server.

## The five commands

Each example is a complete `workspace/executeCommand` payload — copy, adjust the paths, and send. Shared sample file `src/app.js`:

```js
function normalize(x) {
  const trimmed = x.trim();
  return Number(trimmed);
}
```

**`nudo.whatIf`** — assume `x` is a string, ask what `trimmed` becomes:

```json
{ "command": "nudo.whatIf", "arguments": [{
    "file": "src/app.js",
    "bindings": [{ "name": "x", "type": "string" }],
    "target": "trimmed"
}] }
```

```text
Type of "trimmed": string
```

**`nudo.trace`** — list every case's inputs and outputs:

```json
{ "command": "nudo.trace", "arguments": [{ "file": "src/app.js", "functionName": "normalize" }] }
```

**`nudo.suggestCase`** — check `@nudo:case` coverage:

```json
{ "command": "nudo.suggestCase", "arguments": [{ "file": "src/app.js", "functionName": "normalize" }] }
```

When every case of the function was synthesized from call sites, the reply is directive text that can be pasted straight into the source above the function — e.g. for `add(a, b)` called with `(1, 2)` and `("x", "y")`:

```text
Function "add" has 2 synthesized case(s); suggested directives:
/**
 * @nudo:case "call@L2" (1, 2)
 * @nudo:case "call@L3" ("x", "y")
*/
```

Functions with handwritten cases instead get `Function "<name>" already has N case(s)`; the remaining outcomes are listed on the [Agent API](../api/agent.md#nudosuggestcase) page.

**`nudo.selectCase`** — pin a function to one case (drives hover and diagnostics until switched back):

```json
{ "command": "nudo.selectCase", "arguments": [{ "file": "src/app.js", "functionName": "normalize", "caseIndex": 0 }] }
```

**`nudo.getActiveCases`** — read the active case of every function:

```json
{ "command": "nudo.getActiveCases", "arguments": [{ "file": "src/app.js" }] }
```

`whatIf`, `trace`, and `suggestCase` return `{ content: [{ type: "text", text }] }` — MCP-style text content; `selectCase` returns `{ success: true }`; `getActiveCases` returns `Record<string, number>`.

## Pull diagnostics

Instead of the old `nudo-check` tool, request diagnostics with the standard LSP pull request:

```json
{"jsonrpc":"2.0","id":3,"method":"textDocument/diagnostic","params":{"textDocument":{"uri":"file:///home/you/project/src/app.js"}}}
```

Error-severity entries (failed `@nudo:returns` assertions, unreachable code, …) come back in `items` with `source: "nudo"`. Push diagnostics (`textDocument/publishDiagnostics`) are emitted too if your client prefers them.

## Migrating from the MCP server

The standalone `@nudojs/mcp` package is retired — its capabilities moved into `@nudojs/lsp`. To migrate:

1. **Remove the MCP registration** — delete the `nudo` entry from `.mcp.json` / your client's MCP config, and `npm rm @nudojs/mcp` if installed.
2. **Install and connect the language server** — follow [Install](#install) and one of the three options above.
3. **Re-map the old tools:**

| Old MCP tool | New equivalent |
|--------------|----------------|
| `nudo-what-if` | `nudo.whatIf` — and `bindings` are now actually applied (the old server ignored them) |
| `nudo-check` | `textDocument/diagnostic` pull request |
| `nudo-type-at` | `nudo.whatIf` with `target` (and empty `bindings`), or LSP hover |
| `nudo-suggest-case` | `nudo.suggestCase` |
| `nudo-trace` | `nudo.trace` |

One behavioral upgrade to be aware of: `nudo.whatIf` answers reflect the assumed `bindings` — the old server returned the file's own analysis and silently dropped the assumptions. Retune any prompts or pipelines that relied on the old behavior.
