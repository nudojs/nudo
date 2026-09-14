---
sidebar_position: 2.5
description: "Install the Nudo language server in Zed: hover types, diagnostics, CodeLens case switching, inlay hints."
---

# Zed Extension

The **nudo** Zed extension attaches Nudo's language server to JavaScript and TypeScript buffers as a *secondary* language server — alongside `vtsls` / `typescript-language-server`.

## Prerequisites

- Node.js on `PATH` (or Zed's bundled Node runtime for the npm fallback)
- `@nudojs/lsp` available as one of:
  - project-local `node_modules/@nudojs/lsp` (`npm i @nudojs/lsp`)
  - global install providing the `nudo-lsp` bin (`npm i -g @nudojs/lsp`)
  - Zed-managed npm install (automatic, if neither of the above is found)

The published package ships `dist/server.js` with a `nudo-lsp` shebang entry.

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
| Diagnostics | Automatic for files with Nudo directives |
| Hover types | Standard LSP hover |
| Go to Definition / References / Rename | Standard LSP |
| Inlay hints | Enable `inlay_hints.enabled` |
| CodeLens (case switching) | Enable `code_lens: "on"` |
| Semantic tokens | Default off; set `semantic_tokens` |
| Agent commands (`nudo.check` / `nudo.infer` / …) | Reachable via any LSP client or Zed agent tooling |

VS Code-only decorations for the active case are not available; use the CodeLens case picker instead.

## File detection

Same as other editors: `.js`, `.mjs`, and `.ts` files that contain Nudo directives. Files without directives are skipped.

## Building the WASM extension

Zed compiles the extension when you install a dev extension. Manual build:

```bash
rustup target add wasm32-wasip2
cd nudo-zed
cargo build --target wasm32-wasip2 --release
```

## See also

- [VS Code Extension](./vscode.md)
- [Agent Integration](./mcp-server.md) — the same server, for coding agents
- [@nudojs/lsp API](../api/lsp.md)
