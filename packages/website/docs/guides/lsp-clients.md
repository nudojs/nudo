---
sidebar_position: 2.6
description: "Capability matrix for Nudo's language server across VS Code, Zed, Neovim, Helix, and generic LSP clients — plus known gaps."
---

# LSP Client Matrix

Nudo ships **one** language server (`@nudojs/lsp`). Editors differ only in how they launch it and which client-side features they enable. This page is the alignment table: what the server provides, how each client consumes it, and where the gaps are.

The server is designed to run **next to** `tsserver` / `vtsls`, not instead of them.

## Server capabilities

Declared on `initialize` (see [@nudojs/lsp API](../api/lsp.md)):

| Capability | Server handler | Notes |
|------------|----------------|-------|
| Diagnostics | `validateText` (push) | Adaptive debounce 300/400/800 ms; cancel-stale generations (A8) |
| Hover | `onHover` | Abs / intension; exported fn name shows `● interface / handwritten\|generated\|implicit` (A7) |
| Completion (`.`) | `onCompletion` | Inferred property/method members |
| CodeLens | `onCodeLens` | **Interface tier first**: `● interface / <source>` + persist/update; case lenses are the debug sub-layer |
| Inlay hints | `languages.inlayHint` | Case hints + Abs param/return (`derived` mark on implicit exports) |
| Definition / References / Rename | standard LSP | Sidecar binding names included (A5) |
| Document / workspace symbols | standard LSP | |
| Signature help | `onSignatureHelp` | Triggers `(`, `,` |
| Code actions (`quickfix`) | `onCodeAction` | Unreachable cleanup; contract/param fixes (A6) |
| Semantic tokens (full) | `languages.semanticTokens` | Legend includes `contract` / `generated` / `derived` interface modifiers (A7) |
| Execute command | `nudo.*` | `selectCase`, `interface`, `interfaceEmit`, agent tools |
| Custom requests | `nudo/…` | Same handlers as commands (E5); slash-form is the protocol contract |
| Pull diagnostics | `diagnosticProvider` | `interFileDependencies: false` |

**File detection (A1/A2):** targets are `.js` / `.mjs` / `.ts`. Shipped default is `nudo.analysis.mode = "directives"` — unannotated `.js` is **not** analyzed by the IDE until the project sets `"exports"` or `"all"` in `package.json#nudo.analysis`. CodeLens interface tier uses the broader target path even when diagnostics stay quiet for directive-less files.

## Client support matrix

Legend: **Y** = works with stock client + this server · **C** = needs a setting / secondary-server config · **N** = not available in the client UI (server still serves the protocol) · **—** = not applicable

| Capability | VS Code (`nudo-vscode`) | Zed (`nudo-zed`) | Neovim (nvim-lspconfig) | Helix | Generic stdio LSP |
|------------|:-----------------------:|:----------------:|:-----------------------:|:-----:|:-----------------:|
| Launch | Bundled `server.js` over IPC | `nudo-lsp` / project `node_modules` / Zed npm | `cmd = nudo-lsp` | `command = nudo-lsp` | Spawn `nudo-lsp` or `node dist/server.js` |
| Diagnostics | Y | Y | Y | Y | Y |
| Hover (Abs + interface tier) | Y | Y | Y | Y | Y |
| Completion | Y | Y | Y | C (`.` via auto-pairs) | Y |
| CodeLens interface + case | Y | C (`code_lens: "on"`) | C (plugins: glance/nvim-code-action-menu vary) | N | C (client-dependent) |
| Inlay hints | Y | C (`inlay_hints.enabled`) | C (`inlay_hints` support) | C | C |
| Definition / References / Rename | Y | Y | Y | Y | Y |
| Document symbols | Y | Y | Y | Y | Y |
| Signature help | Y | Y | Y | C | Y |
| Code actions / Quickfix | Y | Y | Y | Y | C |
| Semantic tokens | Y | C (`semantic_tokens: "combined"`) | C (treesitter/semantic tokens plugin) | C | C |
| Active-case decoration | Y (extension) | N | N | N | N |
| Agent commands (`nudo.check`, `nudo.hover`, …) | Y (executeCommand / MCP bridge) | Y (agent tooling / custom request) | Y (custom LSP request) | C | Y |
| Open-buffer sidecar (A4) | Y | Y | Y | Y | Y |
| Buffer-aware interface agent tool (E5) | Y | Y | Y | Y | Y |

## Setup notes

### VS Code

Install `wmzy.nudo-vscode`. The extension bundles the server and registers `nudo.selectCase`. See [VS Code Extension](./vscode.md).

### Zed

Install [nudojs/nudo-zed](https://github.com/nudojs/nudo-zed) as a secondary language server next to `vtsls`. Enable `code_lens` and `inlay_hints`. See [Zed Extension](./zed.md).

### Neovim

```lua
require("lspconfig").nudo.setup({
  cmd = { "nudo-lsp" }, -- or { "node", "/path/to/@nudojs/lsp/dist/server.js" }
  filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
  root_dir = require("lspconfig").util.root_pattern("package.json", ".git"),
})
```

CodeLens and inlay hints need a client plugin (e.g. `nvim-lightbulb` / built-in `vim.lsp.inlay_hint`). Agent commands: `vim.lsp.buf.execute_command({ command = "nudo.check", arguments = { { file = vim.api.nvim_buf_get_name(0) } } })`.

### Helix

```toml
[language-server.nudo]
command = "nudo-lsp"

[[language]]
name = "javascript"
language-servers = [ "vtsls", "nudo" ]
```

Helix renders diagnostics/hover/definitions; CodeLens is not in the UI — use CLI `nudo interface` / `nudo check` for the same data.

### Generic / agent bridges

Any LSP client can `workspace/executeCommand` or send `nudo/<tool>` custom requests. Slash-form (`nudo/check`) is the protocol contract; dot-form (`nudo.check`) mirrors command names for MCP-style bridges. Both route to the same handlers (E5). See [Agent Integration](./mcp-server.md).

## Known gaps

Track these when adopting a non-VS Code client. Server-side semantics are shared; gaps are almost always **client UI**.

| Gap | Affected clients | Workaround | Tracking |
|-----|------------------|------------|----------|
| Active-case visual decoration (highlights the selected case body) | Zed, Neovim, Helix | CodeLens `●`/`○` still switches the active case; hover follows | nudo-zed / client plugins — no Zed decoration API |
| CodeLens not rendered | Helix, some minimal Neovim setups | `nudo interface` / `nudo check` CLI; agent `nudo.interface` | Client limitation |
| Semantic tokens off by default | Zed, Neovim, Helix | Set client semantic-token settings (see matrix) | Documented per client |
| Secondary-server diagnostics may compete with tsserver noise | All | Scope `nudo.analysis.include` / mute implicit diagnostics (A3) | Config, not a bug |
| File-detection docs lag analysis-mode default | Docs | Prefer `package.json#nudo.analysis` as the source of truth | Docs sync (this page) |
| Pull diagnostics unused by some clients | Older clients | Push path still works; open/validate on didOpen | Protocol age |

## Same-source guarantee

These surfaces always share one computation (pinned by tests):

| Surface | Shared source |
|---------|----------------|
| CodeLens `● interface` | `interfaceTierOf` |
| Hover first line + contract display | `interfaceTierOf` + `getHoverAtPosition` |
| Inlay `interfaceSource` / `derived` | `collectAbsInlays` + `interfaceTierOf` |
| Semantic token modifiers | `buildSemanticTokens` + `interfaceTierOf` |
| Agent `nudo.check` / `nudo.hover` / `nudo.interface` | `checkSource` / `getHoverAtPosition` / `interfaceSurface` (E5 `AGENT_TOOL_SOURCES`) |
| CLI `nudo check` / `nudo interface` | Same service/core entrypoints |

## See also

- [VS Code Extension](./vscode.md)
- [Zed Extension](./zed.md)
- [Migrating existing JS](./migrating-js.md)
- [Agent Integration](./mcp-server.md)
- [Versioning & Releases](./versioning.md)
- [@nudojs/lsp API](../api/lsp.md)
