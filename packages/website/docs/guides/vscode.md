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

**File detection**: The language server analyzes `.js`, `.ts`, and `.mjs` files. Directive-only mode is conservative; project-wide analysis opens via `package.json#nudo.analysis.mode` (`exports` | `all`). Directives (`@nudo:case`, `@nudo:mock`, `@nudo:refine`, …) remain the explicit contract surface — full syntax in the [Directives reference](../concepts/directives.md). Cross-editor capability comparison: [LSP Client Matrix](./lsp-clients.md).

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
- **Update @nudo:refine** — when assertion doesn't match inferred type

### Semantic Tokens

Nudo provides syntax highlighting based on inferred types. Functions, variables, and dead code are highlighted differently from standard syntax coloring.

### Command: "Nudo: Select Case"

You can also invoke the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **Nudo: Select Case**. This command is registered as `nudo.selectCase` and is used by the CodeLens to switch the active case for a function.

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
