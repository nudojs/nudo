---
sidebar_position: 2
description: "Install the nudo-vscode extension for hover types, completions, case-switching CodeLens, inlay hints, and diagnostics powered by Nudo's language server."
---

# VS Code Extension

The **nudo-vscode** extension brings Nudo's type inference into your editor with hover types, completions, CodeLens, and inlay hints.

## Installation

1. Open the Extensions view (`Cmd+Shift+X` / `Ctrl+Shift+X`)
2. Search for **nudo-vscode** or "Nudo"
3. Click **Install**

Or install from the command line:

```bash
code --install-extension wmzy.nudo-vscode
```

## Activation

The extension activates when you open JavaScript files. It uses the `@nudojs/lsp` package to run a Language Server Protocol (LSP) server that provides all editor features.

**File detection**: The language server analyzes `.js`, `.ts`, and `.mjs` files. Shipped default is `nudo.analysis.mode = "exports"` (export / sidecar / directives); set `"all"` or `"directives"` to widen or tighten the gate. Directives (`@nudo:case`, `@nudo:mock`, `@nudo:refine`, …) remain the explicit contract surface — full syntax in the [Directives reference](../concepts/directives.md). Cross-editor capability comparison: [LSP Client Matrix](./lsp-clients.md).

**Activation vs analysis gate**: `activationEvents` (`onLanguage:javascript` / `onLanguage:typescript`) only *starts* the client. Whether a buffer is *analyzed* is the server-side `shouldAnalyzeFile` gate (target path + `nudo.analysis.mode`). JSX/tsx languages may activate the extension but are not Nudo analysis targets.

## Release checklist (maintainers)

Full checklist: [`packages/vscode/RELEASE_CHECKLIST.md`](https://github.com/nudojs/nudo/blob/main/packages/vscode/RELEASE_CHECKLIST.md) in the monorepo. Summary of what every Marketplace / Open VS X release must cover:

1. **Bundled server align** — extension ships `server/server.js` copied from `@nudojs/lsp` `dist` via `scripts/bundle-server.mjs`. Build the monorepo first; record the bundled lsp version in the extension CHANGELOG. The vsix is self-contained (no monorepo sibling path at runtime).
2. **Analysis default + escape hatch** — default `nudo.analysis.mode = "exports"`. Escape hatch in project `package.json#nudo.analysis.mode`: `"directives"` (conservative; diagnostics tier `errors`) or `"all"`. Release notes must state this default; a flip that invents diagnostics is a breaking default change.
3. **tsserver coexistence** — Nudo runs beside the built-in TS server. Mixed repos should scope `nudo.analysis.include` / `exclude` — see [Coexistence](./coexistence.md). Do not point both tools at the same `.ts` sources with conflicting severities.
4. **Packaging dry-run** — `pnpm --filter nudo-vscode run build && pnpm --filter nudo-vscode run package`; install the `.vsix` locally; confirm hover/diagnostics on an export-bearing `.js` without editing; confirm palette commands `nudo.selectCase` / `nudo.interface` / `nudo.interface.draft` / `nudo.interfaceEmit`.
5. **Marketplace / Open VS X notes template** — extension version, bundled lsp version, analysis default, coexistence blurb, protocol surface pointer ([PUBLIC_API](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md)), known issues. Both targets in `release.yml` or an explicit skip.

Service-level daily smoke (no live VS Code): `packages/lsp/src/__tests__/ide-daily-smoke.test.ts`. Public freeze inventory: `@nudojs/lsp` [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) / [API page](../api/lsp.md).

## Features

### Hover Types

Hover over an expression to see its inferred type. The extension uses `getTypeAtPosition` to compute the type at the cursor and displays it in a hover tooltip.

```javascript
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

### CodeLens on Interface and Cases

CodeLens faces the **interface tier** first (design §8):

- **● interface / handwritten|generated|implicit** — effective contract source for each exported function; click prints the same surface as `nudo interface`
- **⚡ persist interface** / **↻ update interface** — freeze call-site domains into the `*.nudo.js` sidecar
- **● / ○ case "name"** — debug sub-layer; click selects the active case for type replay

Hover on an exported function name shows the same `● interface / <source>` line (A7 same-source). The active case is highlighted with a distinct style in VS Code.

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

Find all usages of a symbol across the current file. Press `Shift+F12` (or right-click → Find All References).

### Rename Symbol

Safely rename a symbol and all its references. Press `F2` (or right-click → Rename Symbol). Nudo validates that the new name doesn't conflict with existing symbols.

### Signature Help

When typing inside a function call's parentheses, Nudo shows parameter hints. This activates automatically when you type `(` or `,`.

```javascript
/**
 * @nudo:case "test" (T.string, T.number)
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

You can also invoke the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **Nudo: Select Case**. This command is registered as `nudo.selectCase` and is used by the CodeLens to switch the active case for a function.

### Commands: Interface / Draft / Persist

| Palette title | Command | Behavior |
|---------------|---------|----------|
| Nudo: Show Interface | `nudo.interface` | Print tiers in the **Nudo** output channel (same as `nudo interface`) |
| Nudo: Draft Interface (code-first) | `nudo.interface.draft` | Preview draft in Output; optional **Write draft file** → `*.nudo.draft.js` / `*.nudo.draft.ts` (write is fail-closed without a project root) |
| Nudo: Persist Interface (@generated) | `nudo.interfaceEmit` | **Dry-run first** (`dryRun: true`, no write) → Output preview → confirm → real sidecar write. CodeLens persist/update uses the same confirm flow |

CodeLens on non-handwritten exports includes `⚡ draft interface` — same path as CLI `--draft` and agent `nudo.interface.draft`. Persist/update CodeLens never writes before the dry-run confirm dialog is accepted.

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
| Hover             | Abs / intension; `● interface / <source>` on export fn names |
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
| Command           | `nudo.selectCase` / `nudo.interface` / `nudo.interfaceEmit` |

See also: [LSP Client Matrix](./lsp-clients.md) for other editors.
