---
sidebar_position: 2.5
description: "Install the Nudo language server in Zed: hover types, diagnostics, CodeLens case switching, inlay hints."
---

# Zed Extension

The **nudo** Zed extension attaches Nudo's language server to JavaScript and TypeScript buffers as a *secondary* language server — alongside `vtsls` / `typescript-language-server`.

## Prerequisites

- Node.js on `PATH` (or Zed's bundled Node runtime for the npm fallback)
- [`@nudojs/lsp` ≥ 0.5.0](https://www.npmjs.com/package/@nudojs/lsp) available as one of:
  - project-local `node_modules/@nudojs/lsp` (`npm i @nudojs/lsp`)
  - global install providing the `nudo-lsp` bin (`npm i -g @nudojs/lsp`)
  - Zed-managed npm install (automatic, if neither of the above is found)

0.5.0+ ships `dist/server.js` with a `nudo-lsp` shebang entry and defaults to stdio when no transport flag is passed.

## Install

The extension lives in a standalone repository: [nudojs/nudo-zed](https://github.com/nudojs/nudo-zed).

### From source (dev)

```bash
git clone https://github.com/nudojs/nudo-zed
```

In Zed: **Extensions → Install Dev Extension…** → select the cloned `nudo-zed` directory.

### Settings

```json
{
  "languages": {
    "JavaScript": {
      "language_servers": ["vtsls", "nudo", "..."]
    },
    "TypeScript": {
      "language_servers": ["vtsls", "nudo", "..."]
    }
  },
  "code_lens": "on",
  "inlay_hints": { "enabled": true }
}
```

`"..."` keeps the remaining registered language servers. Enable semantic tokens if you want type-aware highlighting:

```json
{
  "semantic_tokens": "combined"
}
```

### Binary override

Skip discovery and point Zed at a specific server:

```json
{
  "lsp": {
    "nudo": {
      "binary": {
        "path": "node",
        "arguments": ["/abs/path/node_modules/@nudojs/lsp/dist/server.js"]
      }
    }
  }
}
```

Or, if `nudo-lsp` is on `PATH`:

```json
{
  "lsp": {
    "nudo": {
      "binary": { "path": "nudo-lsp", "arguments": [] }
    }
  }
}
```

## How the server is resolved

The extension's `language_server_command` tries, in order:

1. `nudo-lsp` on `PATH`
2. `<worktree>/node_modules/@nudojs/lsp/dist/server.js` (via `node`)
3. Zed-managed `npm install @nudojs/lsp`, resolved with `require.resolve`

## Features in Zed

| Capability | Notes |
|------------|-------|
| Diagnostics | Automatic for analysis targets (`.js`/`.mjs`/`.ts`); see `nudo.analysis.mode` for directive-less files |
| Hover types | Standard LSP; exported fn names show `● interface / <source>` (same as CodeLens) |
| Go to Definition / References / Rename | Standard LSP (sidecar binding names included) |
| Inlay hints | Enable `inlay_hints.enabled`; implicit exports mark `derived` |
| CodeLens | Enable `code_lens: "on"` — **interface tier first** (`● interface` + persist/update), case lenses behind |
| Semantic tokens | Default off; set `semantic_tokens: "combined"` — includes `contract`/`generated`/`derived` modifiers |
| Code actions / Signature help | Standard LSP quickfix + signature help |
| Agent commands (`nudo.check` / `nudo.infer` / `nudo.interface` / …) | Reachable via any LSP client or Zed agent tooling |

VS Code-only decorations for the active case are not available; use the CodeLens case picker instead.

Full client comparison and known gaps: [LSP Client Matrix](./lsp-clients.md).

## File detection

Analysis targets are `.js`, `.mjs`, and `.ts`. Directive-only mode is conservative; open whole-file analysis with `package.json#nudo.analysis.mode` (`exports` | `all`). CodeLens interface tier uses the broader target path.

## Building the WASM extension

Zed compiles the extension when you install a dev extension. Manual build:

```bash
rustup target add wasm32-wasip2
cd nudo-zed
cargo build --target wasm32-wasip2 --release
```

## See also

- [VS Code Extension](./vscode.md)
- [LSP Client Matrix](./lsp-clients.md) — capability alignment across editors
- [Versioning & Releases](./versioning.md)
- [Agent Integration](./mcp-server.md) — the same server, for coding agents
- [@nudojs/lsp API](../api/lsp.md)
