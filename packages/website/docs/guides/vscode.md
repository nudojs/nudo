---
description: "Install the nudo-vscode extension for hover types, completions, case-switching CodeLens, inlay hints, and diagnostics powered by Nudo's language server."
---

# VS Code Extension

The **nudo-vscode** extension brings Nudo's type inference into your editor with hover types, completions, CodeLens, and inlay hints.

**Positioning (honest):** VS Code is Nudo's **flagship IDE path** — the fullest client face on `@nudojs/lsp`. The **gate path** is still CLI / Agent: `nudo check --json` in CI and `nudo.check` / MCP tools for agents. The IDE is best-effort observation on the same server; it does not replace the gate. Other editors: [LSP Client Matrix](./lsp-clients.md).

## Installation

1. Download `nudo-vscode.vsix` from the [latest GitHub release](https://github.com/nudojs/nudo/releases)
2. In VS Code: **Extensions** view (`Cmd+Shift+X` / `Ctrl+Shift+X`) → `…` menu → **Install from VSIX…**
3. Pick the downloaded file

Or from the command line:

```bash
code --install-extension nudo-vscode.vsix
```

Marketplace listings (`wmzy.nudo-vscode` on the VS Code Marketplace and Open VSX) are release artifacts — install from the extension view when it is reachable, or build from source (`pnpm --filter nudo-vscode run build && pnpm --filter nudo-vscode run package`). The GitHub release `.vsix` is the source of truth.

## Activation

The extension activates when you open JavaScript files. It uses the `@nudojs/lsp` package to run a Language Server Protocol (LSP) server that provides all editor features.

**File detection**: The language server analyzes `.js`, `.ts`, and `.mjs` files. Shipped default is `nudo.analysis.mode = "exports"` (export / sidecar / directives); see [Coexistence](./coexistence.md#when-to-use-modedirectives-vs-modeexports) for mode semantics. Contracts live in `*.nudo.js` sidecars and in-source `@nudo:contract`; `@nudo:case` is a debug / optional `nudo test` sub-layer. Full syntax: [Directives reference](../concepts/directives.md). Cross-editor capability comparison: [LSP Client Matrix](./lsp-clients.md).

**Activation vs analysis gate**: `activationEvents` (`onLanguage:javascript` / `onLanguage:typescript`) only *starts* the client. Whether a buffer is *analyzed* is the server-side `shouldAnalyzeFile` gate (target path + `nudo.analysis.mode`). JSX/tsx languages may activate the extension but are not Nudo analysis targets.

## Release checklist (maintainers)

Extension packaging and Marketplace release steps: [Contributing — Releases](../contributing.md).

## Features

### Hover Types

Hover over an expression to see its inferred type. The extension uses `getTypeAtPosition` to compute the type at the cursor and displays it in a hover tooltip.

### Active-case decoration (LSP-G1)

Selecting a `@nudo:case` via CodeLens highlights the **whole function body** plus the case comment line (not only the comment). The highlight is recomputed from the current buffer on every document edit, so it keeps tracking the case while you type. Server-side signature help also projects real `paramTypes` / return shapes.

### Coexistence with tsserver (LSP-G4)

Command palette → **Nudo: Apply coexistence settings (vs tsserver)** writes workspace `javascript.validate.enable=false` after confirmation (never silent). Full recipes: [Coexistence](./coexistence.md).

```javascript verify
/**
 * @nudo:case "test" (42)
 */
function double(x) {
  return x * 2;  // hover over x → number
}
```

### Completions

Completions are triggered when you type `.` after an expression. The LSP suggests properties and methods based on the inferred type at that position.

```javascript
/**
 * @nudo:case "test" ("hello")
 */
function upper(s) {
  return s.  // completions: toUpperCase, toLowerCase, slice, etc.
}
```

### CodeLens: Observation Selector (contract + cases)

The lens row is an **observation selector** — contract is one option alongside each case, exactly one active (`●`) at a time:

- **● contract / hw|gen|imp** — the contract option (handwritten / generated / implicit tier); the default. Click to switch back to the contract observation (`nudo.selectContract`); idempotent when already active
- **⚡ persist interface** / **↻ update interface** — freeze call-site domains into the `*.nudo.js` sidecar
- **● / ○ case "name"** — click selects the active case for type replay (`nudo.selectCase`); the contract option flips to `○`

Hover on an exported function name shows the same `● contract / hw\|gen\|imp` line (A7 same-source). The active case is highlighted with a distinct style in VS Code.

### Inlay Hints

Inlay hints show type information inline. After each case result or in relevant positions, Nudo displays the inferred type as grayed-out annotations.

### Status Bar

A status bar item on the right shows `Nudo` when the extension is active, with a tooltip: "Nudo Type Inference Engine".

### Go-to-Definition

Jump to the definition of a function, variable, or class. Place your cursor on an identifier and press `F12` (or right-click → Go to Definition).

```javascript
function process(data) {
  return transform(data);  // F12 on transform → jumps to its definition
}
```

### Find References

Find all usages of a symbol — local plus cross-file (importers in other open / known files). Press `Shift+F12` (or right-click → Find All References).

### Rename Symbol

Safely rename a symbol and all its references. Press `F2` (or right-click → Rename Symbol). Nudo validates that the new name doesn't conflict with existing symbols.

### Signature Help

When typing inside a function call's parentheses, Nudo shows parameter hints. This activates automatically when you type `(` or `,`.

```javascript
/**
 * @nudo:case "test" (string(), number())
 */
function createUser(name, age) { ... }

createUser(  // ← signature help shows: (name: string, age: number)
```

### Code Actions / Quick Fixes

When Nudo reports diagnostics, quick fix suggestions are available. Click the lightbulb icon or press `Cmd+.` / `Ctrl+.` to see available fixes:

- **Remove unreachable code** — for code after `return`/`throw`
- **Add missing field to call / sidecar shape** — inserts `field: undefined` at the call site and into `*.nudo.js` shape when present
- **Relax sidecar contract** — rewrites numeric preds (`number().gt(0)` → `number()`) on the handwritten sidecar for refine/domain violations

### Semantic Tokens

Nudo provides syntax highlighting based on inferred types. Functions, variables, and dead code are highlighted differently from standard syntax coloring.

### Command: "Nudo: Select Case"

**Nudo: Select Case** (`nudo.selectCase`) is the command behind the case CodeLens: the lens hands over the file, the function name, and the case index, and the extension switches that function's active case (highlighting it locally right away).

The same command is listed in the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`), but a palette run carries **no arguments** — a bare command has no function or case to work with. The extension falls back to the active editor for the file and then reports the missing input (**Nudo: select case needs a function name (use the CodeLens)**) instead of guessing: no request is sent and no local highlight is written. Switching a case is therefore a **CodeLens** action.

Two more notes:

- The command's handler is attached when the language server connects (the client registers the ids the server advertises), so the palette entry becomes runnable once the client is up.
- If the server rejects a case switch, the extension shows the error and **rolls the optimistic local highlight back** — a rejected switch never leaves a stale highlight behind.

### Commands: Interface / Draft / Persist

| Palette title | Command | Behavior |
|---------------|---------|----------|
| Nudo: Show Contract | `nudo.contract` | Print tiers in the **Nudo** output channel (same as `nudo contract`) |
| Nudo: Select Contract (back to contract observation) | `nudo.selectContract` | Switch the function back to contract observation (drops its activated case) and clear the local case highlight |
| Nudo: Trace Observation (entry@ / call@) | `nudo.trace` | Print the per-case observation (`entry@` / `call@`) of a function in the **Nudo** output channel (same as `nudo trace`) |
| Nudo: Draft Contract (code-first) | `nudo.contract.draft` | Preview draft in Output; optional **Write draft file** → `*.nudo.draft.js` / `*.nudo.draft.ts` (write is fail-closed without a project root) |
| Nudo: Persist Contract (@generated) | `nudo.contract.emit` | **Dry-run first** (`dryRun: true`, no write) → Output preview → confirm → real sidecar write. CodeLens persist/update uses the same confirm flow; from the palette the function is picked interactively, and the same three-step gate applies |

CodeLens on non-handwritten exports includes `⚡ draft interface` — same path as CLI `--draft` and agent `nudo.contract.draft`. Persist/update CodeLens never writes before the dry-run confirm dialog is accepted.

Run from the command palette, these commands work on the **active editor** (no file argument needed): **Show Contract** and **Draft Contract** are file-granular, while **Persist Contract (@generated)** asks which function to persist with a **QuickPick** over the file's persistable exports — the same set the server's `⚡ persist interface` / `↻ update interface` CodeLens offers. If the file has no persistable function, the command reports that there is none (there is no free-text fallback). The three-step gate is the same on both paths: the dry-run never writes, a failed dry-run offers no write action at all, and the sidecar is written only after you confirm.

---

## Resource Usage

The Nudo language server is designed to stay small next to your other tooling:

- **Bounded memory.** Between requests the server keeps only lightweight bookkeeping — file paths, function names, and small per-file records — and drops a file's analysis as soon as you close it. It never keeps parsed syntax trees in memory, and it is built to run alongside TypeScript's own language features rather than replace them.
- **Diagnostics on open.** Opening a file analyzes it immediately; you don't need to edit it first to see Nudo's diagnostics.
- **Stale diagnostics clear on reopen.** A file you have *closed* is not re-analyzed when something it depends on changes — its diagnostics stay where they were until you open it again, at which point they are refreshed. Files deleted from disk have their diagnostics cleared automatically.

---

## Summary

| Feature           | Description                                              |
|-------------------|----------------------------------------------------------|
| Hover             | Abs / intension; `● contract / hw\|gen\|imp` on export fn names |
| Completions       | Triggered on `.`; property/method suggestions            |
| CodeLens          | Interface tier + persist/update; case sub-layer          |
| Inlay hints       | Abs param/return; `derived` on implicit exports          |
| Go-to-Definition  | Jump to symbol definition (`F12`)                        |
| Find References   | Find all usages of a symbol (`Shift+F12`)                |
| Rename Symbol     | Rename symbol and all references (`F2`)                  |
| Signature Help    | Parameter hints inside function calls                    |
| Code Actions      | Quick fixes for diagnostics                              |
| Semantic Tokens   | Type-aware highlighting + interface-tier modifiers       |
| Status bar        | "Nudo" indicator when active                             |
| Command           | `nudo.selectCase` / `nudo.contract` / `nudo.contract.emit` |

See also: [LSP Client Matrix](./lsp-clients.md) for other editors.

## Next

- [LSP Client Matrix](./lsp-clients.md) — other editors and known gaps
- [Zed Extension](./zed.md)
- [Agent Integration](./agent-integration.md) — the same server for coding agents
- [Mental model](../getting-started/mental-model.md)
