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
| Diagnostics | `validateText` (push) + `diagnosticProvider` (pull) | Adaptive debounce 300/400/800 ms; cancel-stale generations (A8); pull hits cache only when version + casesHash + depsHash match |
| Hover | `onHover` | Abs / intension; exported fn name shows `● interface / handwritten\|generated\|implicit` (A7) |
| Completion (`.`) | `onCompletion` | Inferred property/method members |
| CodeLens | `onCodeLens` | **Interface tier first**: `● interface / <source>` + persist/update; case lenses are the debug sub-layer |
| Inlay hints | `languages.inlayHint` | Case hints + Abs param/return (`derived` mark on implicit exports) |
| Definition / References / Rename | standard LSP | Sidecar binding names included (A5) |
| Document / workspace symbols | standard LSP | |
| Signature help | `onSignatureHelp` | Triggers `(`, `,` |
| Code actions (`quickfix`) | `onCodeAction` | Unreachable cleanup; contract/param fixes (A6) |
| Semantic tokens (full) | `languages.semanticTokens` | Legend includes `contract` / `generated` / `derived` interface modifiers (A7) |
| Execute command | `nudo.*` | `selectCase`, `contract`, `contract.draft`, `contract.emit`, agent tools |
| Custom requests | `nudo/…` | Same handlers as commands (E5); slash-form is the protocol contract |
| Pull diagnostics | `diagnosticProvider` | `interFileDependencies: false` |

**File detection (A1/A2):** targets are `.js` / `.mjs` / `.ts`. Shipped default is `nudo.analysis.mode = "exports"` — files with `export` / sidecar / directives are analyzed by the IDE; set `"all"` for every target path or `"directives"` to opt back into the conservative gate. CodeLens interface tier uses the broader target path even when diagnostics stay quiet for directive-less files.

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

## Setup notes (minimal copy-paste)

Install `@nudojs/lsp` so `nudo-lsp` is on `PATH` (project-local `npm i -D @nudojs/lsp` or global). Server freeze inventory: [`packages/lsp/PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) / [API](../api/lsp.md).

### VS Code

Install `wmzy.nudo-vscode`. The extension bundles the server and registers `nudo.selectCase`. See [VS Code Extension](./vscode.md) (includes the maintainer release checklist).

### Zed — minimal

1. Install [nudojs/nudo-zed](https://github.com/nudojs/nudo-zed) as a dev/extension install, **or** point at a local server binary.
2. Project `package.json`: `"devDependencies": { "@nudojs/lsp": "^0.8.0" }`.
3. `~/.config/zed/settings.json` (or project `.zed/settings.json`):

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
  "lsp": {
    "nudo": {
      "binary": {
        "path": "npx",
        "arguments": ["--yes", "@nudojs/lsp"]
      }
    }
  },
  "code_lens": "on",
  "inlay_hints": { "enabled": true }
}
```

If `nudo-lsp` is already on `PATH`, prefer `"binary": { "path": "nudo-lsp", "arguments": [] }`. Semantic tokens: set `"semantic_tokens": "combined"`. See [Zed Extension](./zed.md).

### Neovim — minimal

`lazy.nvim` + `nvim-lspconfig` (Neovim 0.11+ `vim.lsp.config` shown; older setups use `require("lspconfig").nudo.setup{…}`):

```lua
-- after installing @nudojs/lsp so `nudo-lsp` is on PATH
vim.lsp.config("nudo", {
  cmd = { "nudo-lsp" },
  filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
  root_markers = { "package.json", ".git" },
})
vim.lsp.enable("nudo")

-- inlay hints (built-in)
vim.lsp.inlay_hint.enable(true, { bufnr = 0 })

-- optional: CodeLens UI via a plugin (e.g. glance / nvim-code-action-menu)
```

Legacy lspconfig form:

```lua
require("lspconfig").nudo.setup({
  cmd = { "nudo-lsp" }, -- or { "node", "node_modules/@nudojs/lsp/dist/server.js" }
  filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
  root_dir = require("lspconfig").util.root_pattern("package.json", ".git"),
})
```

Agent command example:

```lua
vim.lsp.buf.execute_command({
  command = "nudo.check",
  arguments = { { file = vim.api.nvim_buf_get_name(0) } },
})
```

Custom request (slash form is the protocol contract):

```lua
vim.lsp.buf_request(0, "nudo/check", { file = vim.api.nvim_buf_get_name(0) }, function(err, result) end)
```

### Helix — minimal

`~/.config/helix/languages.toml`:

```toml
[language-server.nudo]
command = "nudo-lsp"
# args = ["--stdio"]  # optional; server defaults to stdio when no transport flag is passed

[[language]]
name = "javascript"
language-servers = [ "vtsls", "nudo" ]

[[language]]
name = "typescript"
language-servers = [ "vtsls", "nudo" ]
```

Helix renders diagnostics / hover / definitions / rename. **CodeLens is not in the Helix UI** — use CLI `nudo contract` / `nudo check` for the same data. Signature help depends on Helix version; if absent, use the CLI/agent tools.

### Generic / agent bridges

Any LSP client can `workspace/executeCommand` or send `nudo/<tool>` custom requests. Slash-form (`nudo/check`) is the protocol contract; dot-form (`nudo.check`) mirrors command names for MCP-style bridges. Both route to the same handlers (E5). See [Agent Integration](./mcp-server.md) and the freeze inventory in [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md).

## Known gaps

Track these when adopting a non-VS Code client. Server-side semantics are shared; gaps are almost always **client UI**. Every row has a workaround + tracking anchor.

| Gap | Affected clients | Workaround | Tracking |
|-----|------------------|------------|----------|
| Active-case visual decoration (highlights the selected case body) | Zed, Neovim, Helix | CodeLens `●`/`○` still switches the active case when the client renders CodeLens; hover follows. Without CodeLens UI: CLI `nudo check` / agent `nudo.hover` after selectCase via custom request | Client limitation — no tracking issue (Zed has no decoration API; Neovim needs a custom plugin) |
| CodeLens not rendered | Helix, some minimal Neovim setups | CLI `nudo contract` / `nudo check`; agent `nudo.contract` / `nudo.contract.draft`; VS Code/Zed for UI CodeLens | Client limitation — no tracking issue (Helix CodeLens UI absent) |
| Semantic tokens off by default | Zed, Neovim, Helix | Set client settings from Setup notes above (Zed `semantic_tokens: "combined"`; Neovim treesitter/semantic-tokens plugin; Helix `editor.semantic-tokens`) | Documented per client on this page — no separate issue |
| Secondary-server diagnostics may compete with tsserver noise | All | Scope `package.json#nudo.analysis.include` / `exclude`; or `mode: "directives"` — full recipe in [Coexistence](./coexistence.md#recipe-mixed-js-ts-no-double-error-storm) | Config, not a bug — tracking doc: [coexistence recipe](./coexistence.md#recipe-mixed-js-ts-no-double-error-storm) |
| File-detection docs lag analysis-mode default | Docs | Prefer `package.json#nudo.analysis` + [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) as the source of truth | Docs sync — this page + PUBLIC_API.md |
| Pull diagnostics unused by some clients | Older clients | Push path still works; open/validate on didOpen; clients may ignore `diagnosticProvider` | Protocol age — no tracking issue (server keeps push) |
| Completion trigger / signature help thin in some UIs | Helix (varies by build) | Use hover + `nudo.check` (CLI) / `nudo test` for full signatures; VS Code/Zed for signature help UI | Client limitation — no tracking issue |

## Same-source guarantee

These surfaces always share one computation (pinned by tests):

| Surface | Shared source |
|---------|----------------|
| CodeLens `● interface` | `interfaceTierOf` |
| Hover first line + contract display | `interfaceTierOf` + `getHoverAtPosition` |
| Inlay `interfaceSource` / `derived` | `collectAbsInlays` + `interfaceTierOf` |
| Semantic token modifiers | `buildSemanticTokens` + `interfaceTierOf` |
| Agent `nudo.check` / `nudo.hover` / `nudo.contract` / test/whatIf/trace | Same service/core entrypoints + buffer-aware `loadModule` (E5 `AGENT_TOOL_SOURCES`); tool errors carry `isError: true` |
| CLI `nudo check` / `nudo contract` | Same service/core entrypoints |
| executeCommand `nudo.*` ↔ slash `nudo/…` | Same dispatch table; inventory pinned in `packages/lsp/PUBLIC_API.md` + `public-api-surface.test.ts` |

## See also

- [VS Code Extension](./vscode.md)
- [Zed Extension](./zed.md)
- [Coexistence with TypeScript](./coexistence.md)
- [Migrating existing JS](./migrating-js.md)
- [Agent Integration](./mcp-server.md)
- [Versioning & Releases](./versioning.md)
- [@nudojs/lsp API](../api/lsp.md)
