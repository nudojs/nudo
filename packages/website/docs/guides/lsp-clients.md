---
description: "Capability matrix for Nudo's language server across VS Code, Zed, Neovim, Helix, and generic LSP clients — plus known gaps."
---

# LSP Client Matrix

Nudo ships **one** language server (`@nudojs/lsp`). Editors differ only in how they launch it and which client-side features they enable. This page is the alignment table: what the server provides, how each client consumes it, and where the gaps are.

The server is designed to run **next to** `tsserver` / `vtsls`, not instead of them.

## Known gaps / which limits are client-side (read first)

**Honest positioning.** The product gate is `nudo check --json` plus Agent/MCP tools. The IDE is a **best-effort observation surface** on the same server — not the gate. Server capabilities are never degraded to match a weaker client; almost every gap below is **client UI or client config**.

| Client | Role | Expectation |
|--------|------|-------------|
| **VS Code** (`wmzy.nudo-vscode`) | **Flagship** IDE client | Full feature face: hover, CodeLens interface tier + case switch, inlay hints, decorations, agent bridge |
| **Zed** | Best-effort | Core face works (diagnostics / hover / rename). CodeLens needs `code_lens: "on"`; no active-case decoration API |
| **Helix** | Best-effort | Diagnostics / hover / definition / rename. **No CodeLens UI** — use CLI `nudo contract` / `nudo check` for the same data |
| **Neovim** | Best-effort | Core face works; CodeLens / semantic tokens / decorations depend on plugins |
| Generic stdio / agent bridges | Protocol | `workspace/executeCommand` + `nudo/…` custom requests always available |

Gap themes (full table + workarounds below; tracking IDs live in the design source of truth [`docs/design/lsp-client-gaps.md`](https://github.com/nudojs/nudo/blob/main/docs/design/lsp-client-gaps.md)):

| Theme | IDs | Who feels it |
|-------|-----|--------------|
| Active-case decoration | **LSP-G1** | Closed on **VS Code** (function-body + case-line decorations). Zed / Neovim / Helix still open (client has no decoration API, or needs a plugin) |
| CodeLens not rendered | **LSP-G2** | Helix / minimal Neovim — **observation face covered by inlay** `● interface / <source>` (same `computeInterfaceLenses` as CodeLens). CodeLens UI itself remains a client limit |
| Semantic tokens off by default | **LSP-G3** | **VS Code** can paint (`semanticTokenScopes`). Zed / Neovim / Helix: enable per Setup notes |
| Secondary-server noise next to tsserver | **LSP-G4** | All clients (config: `nudo.analysis.include` / `exclude`, or `mode: "directives"`). VS Code: command `Nudo: Apply coexistence settings` |
| Pull diagnostics unused | **LSP-G6** | Older clients — **push path is pinned** (validateText always publishes); pull is an enhancement |
| Thin completion / signature help UI | **LSP-G7** | Server: real `paramTypes` / return + `@nudo:` directive completions (`@` trigger). Helix UI still varies by build |

**Rule of thumb:** if the protocol serves it but the editor does not draw it, that is a **client limitation** — fall back to `nudo check` / `nudo contract` or the agent tools. Server-side semantics stay identical across editors.

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
| Signature help | `onSignatureHelp` | Triggers `(`, `,`; projects real `paramTypes` / return via `formatShape` (G7) |
| Code actions (`quickfix`) | `onCodeAction` | Unreachable cleanup; contract/param fixes (A6) |
| Semantic tokens (full) | `languages.semanticTokens` | Legend includes `contract` / `generated` / `derived` interface modifiers (A7) |
| Execute command | `nudo.*` | `selectCase`, `contract`, `contract.draft`, `contract.emit`, agent tools |
| Custom requests | `nudo/…` | Same handlers as commands (E5); slash-form is the protocol contract |
| Pull diagnostics | `diagnosticProvider` | `interFileDependencies: false` |

**File detection (A1/A2):** targets are `.js` / `.mjs` / `.ts`. Shipped default is `nudo.analysis.mode = "exports"` — full gate semantics: [Coexistence](../guides/coexistence.md#when-to-use-modedirectives-vs-modeexports). CodeLens interface tier uses the broader target path even when diagnostics stay quiet for directive-less files.

**Zed / Nvim protocol smoke (B4):** `pnpm --filter @nudojs/lsp run smoke` exercises stdio `initialize` → `textDocument/hover` → `textDocument/publishDiagnostics` — the basic face those editors need. The VS Code package has its own `smoke` (bundled server + initialize).

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
| Code actions — extract / **inline var** / **change signature** | Y | Y | Y | Y | C |
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
2. Project `package.json`: `"devDependencies": { "@nudojs/lsp": "^1.0.0" }`.
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

Basic face check without an editor: `pnpm --filter @nudojs/lsp run smoke` (hover + push diagnostics over stdio).

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

Any LSP client can `workspace/executeCommand` or send `nudo/<tool>` custom requests. Slash-form (`nudo/check`) is the protocol contract; dot-form (`nudo.check`) mirrors command names for MCP-style bridges. Both route to the same handlers (E5). See [Agent Integration](./agent-integration.md) and the freeze inventory in [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md).

## Known gaps

Detail behind the [read-first summary](#known-gaps--which-limits-are-client-side-read-first). Track these when adopting a non-VS Code client. Server-side semantics are shared; gaps are almost always **client UI**. Every row has a workaround + tracking ID (monorepo truth: [`docs/design/lsp-client-gaps.md`](https://github.com/nudojs/nudo/blob/main/docs/design/lsp-client-gaps.md) — close a gap there first, then sync this table).

| Gap | Affected clients | Workaround | Tracking |
|-----|------------------|------------|----------|
| Active-case visual decoration (highlights the selected case **function body**) | Zed, Neovim, Helix (**VS Code closed**) | VS Code extension highlights the whole function body + case line. Elsewhere: CodeLens `●`/`○` still switches the active case when the client renders CodeLens; hover follows. Without CodeLens UI: CLI `nudo check` / agent `nudo.hover` after selectCase via custom request | **LSP-G1** — closed on VS Code; client limitation elsewhere (Zed has no decoration API; Neovim needs a custom plugin) |
| CodeLens not rendered | Helix, some minimal Neovim setups | **Inlay `● interface / …`** mirrors the CodeLens observation face (same source). Also CLI `nudo contract` / `nudo check`; agent `nudo.contract` / `nudo.contract.draft`; VS Code/Zed for UI CodeLens | **LSP-G2** — observation face via inlay; CodeLens UI still client-limited |
| Semantic tokens off by default | Zed, Neovim, Helix (**VS Code can paint**) | VS Code ships `semanticTokenScopes`. Elsewhere set client settings from Setup notes (Zed `semantic_tokens: "combined"`; Neovim treesitter/semantic-tokens plugin; Helix `editor.semantic-tokens`) | **LSP-G3** — VS Code ok; config debt on other clients |
| Secondary-server diagnostics may compete with tsserver noise | All | VS Code: command `Nudo: Apply coexistence settings`. Or scope `package.json#nudo.analysis.include` / `exclude`; or `mode: "directives"` — full recipe in [Coexistence](./coexistence.md#recipe-mixed-js-ts-no-double-error-storm) | **LSP-G4** — config; VS Code self-serve + [coexistence recipe](./coexistence.md#recipe-mixed-js-ts-no-double-error-storm) |
| File detection / `analysis.mode` docs | Docs | Source of truth: [`@nudojs/service` API](../api/service.md#shouldanalyzefile) + [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) §7 | **LSP-G5** — closed (docs synced to `exports` default) |
| Pull diagnostics unused by some clients | Older clients | Push path always publishes (`validateText` / didOpen); clients may ignore `diagnosticProvider` — pull is optional enhancement | **LSP-G6** — push face pinned by test |
| Completion trigger / signature help thin in some UIs | Helix (varies by build) | Server: real param/return shapes + `@nudo:` directive completions (trigger `@`). If the UI is still thin: hover + `nudo.check` (CLI) / `nudo test` | **LSP-G7** — server face improved; Helix UI still client-limited |

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
- [Agent Integration](./agent-integration.md)
- [Versioning & Releases](./versioning.md)
- [@nudojs/lsp API](../api/lsp.md)
