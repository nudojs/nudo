---
sidebar_position: 2
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

**File detection**: The extension analyzes `.js`, `.ts`, and `.mjs` files that contain Nudo directives (`@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, `@nudo:returns`). Files without these directives are not analyzed.

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

### CodeLens on `@nudo:case` Lines

Each `@nudo:case` directive gets a CodeLens above the function. Click a lens to select that case as the active context for type inference. The active case is highlighted with a distinct style.

- **● case "name"** — currently active
- **○ case "name"** — click to activate

This lets you see types under different inputs without changing the file.

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
- **Update @nudo:returns** — when assertion doesn't match inferred type

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
| Hover             | Shows inferred type at cursor via `getTypeAtPosition`    |
| Completions       | Triggered on `.`; property/method suggestions            |
| CodeLens          | Case selection on `@nudo:case` lines                     |
| Inlay hints       | Inline type annotations                                  |
| Go-to-Definition  | Jump to symbol definition (`F12`)                        |
| Find References   | Find all usages of a symbol (`Shift+F12`)                |
| Rename Symbol     | Rename symbol and all references (`F2`)                  |
| Signature Help    | Parameter hints inside function calls                    |
| Code Actions      | Quick fixes for diagnostics                              |
| Semantic Tokens   | Type-aware syntax highlighting                           |
| Status bar        | "Nudo" indicator when active                             |
| Command           | `nudo.selectCase` — select active case for inference     |
