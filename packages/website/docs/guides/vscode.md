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
code --install-extension nudojs.nudo-vscode
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

### Command: "Nudo: Select Case"

You can also invoke the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **Nudo: Select Case**. This command is registered as `nudo.selectCase` and is used by the CodeLens to switch the active case for a function.

---

## Summary

| Feature        | Description                                              |
|----------------|----------------------------------------------------------|
| Hover          | Shows inferred type at cursor via `getTypeAtPosition`    |
| Completions    | Triggered on `.`; property/method suggestions            |
| CodeLens       | Case selection on `@nudo:case` lines                     |
| Inlay hints    | Inline type annotations                                  |
| Status bar     | "Nudo" indicator when active                             |
| Command        | `nudo.selectCase` — select active case for inference     |
