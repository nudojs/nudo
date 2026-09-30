---
description: "Install the Nudo language server in Zed: hover types, diagnostics, CodeLens case switching, inlay hints."
---

# Zed Extension

The **nudo** Zed extension attaches Nudo's language server to JavaScript and TypeScript buffers as a *secondary* language server — alongside `vtsls` / `typescript-language-server`.

## Prerequisites

- Zed's bundled Node runtime (used to launch the server)
- [`@nudojs/lsp` ≥ 0.5.0](https://www.npmjs.com/package/@nudojs/lsp) — the
  extension installs it automatically via Zed's managed npm (no manual install)

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

Skip the managed install and point Zed at a specific server (same surface as
other Zed LSP extensions):

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

### LSP settings passthrough

`lsp.nudo.settings` and `lsp.nudo.initialization_options` are forwarded to the
language server (same idea as VS Code LSP settings). Project analysis config
(`analysis.mode` / `include` / `exclude`) still lives in `package.json#nudo` or
`nudo.json`.

## How the server is resolved

The extension installs `@nudojs/lsp` via Zed's managed npm
(`npm_install_package`) and launches
`<node_binary_path>/node_modules/@nudojs/lsp/dist/server.js --stdio` —
the same pattern as other Zed language-server extensions. A user
`lsp.nudo.binary` override, when set, is used instead.

## Features in Zed

| Capability | Notes |
|------------|-------|
| Diagnostics | Automatic for analysis targets (`.js`/`.mjs`/`.ts`); see `nudo.analysis.mode` for directive-less files |
| Hover types | Standard LSP; exported fn names show `● interface / <source>` (same as CodeLens) |
| Go to Definition / References / Rename | Standard LSP (sidecar binding names included) |
| Inlay hints | Enable `inlay_hints.enabled`; implicit exports mark `derived` |
| CodeLens | Enable `code_lens: "on"` — **interface tier first** (`● interface`, persist/update, `⚡ draft interface`), case lenses behind |
| Semantic tokens | Default off; set `semantic_tokens: "combined"` — includes `contract`/`generated`/`derived` modifiers |
| Code actions / Signature help | Standard LSP quickfix + signature help (real `paramTypes` / return, same as VS Code) |
| Agent commands (`nudo.check` / `nudo.contract.draft` / …) | Reachable via any LSP client or Zed agent tooling |
| JSX / TSX buffers | Attached (`JavaScript React` / `TypeScript React`), same document face as VS Code |

CodeLens `⚡ draft interface` runs the same code-first draft path as CLI `nudo contract --draft` (writes `*.nudo.draft.js` only when the client requests `write: true`). Migration walkthrough: [Migrating existing JS](./migrating-js.md).

VS Code-only decorations for the active case are not available; use the CodeLens case picker instead.

Full client comparison and known gaps: [LSP Client Matrix](./lsp-clients.md).

## File detection

Analysis targets are `.js`, `.mjs`, and `.ts`. Shipped default `package.json#nudo.analysis.mode` is `"exports"`; mode semantics and the conservative `"directives"` gate: [Coexistence](./coexistence.md#when-to-use-modedirectives-vs-modeexports). CodeLens interface tier uses the broader target path.

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
- [Migrating existing JS](./migrating-js.md) — draft → review → check
- [Versioning & Releases](./versioning.md)
- [Agent Integration](./agent-integration.md) — the same server, for coding agents
- [@nudojs/lsp API](../api/lsp.md)
