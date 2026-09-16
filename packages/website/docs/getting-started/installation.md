---
sidebar_position: 1
description: Install the Nudo CLI, VS Code extension, and Vite plugin via npm, pnpm, or yarn — published packages require Node.js >= 20.
---

# Installation

Install Nudo tools via npm, pnpm, or yarn.

## Prerequisites

- **Run the published CLI**: Node.js >= 20 (`engines` on all published packages)
- **Develop this repo**: Node.js >= 20 (CI uses Node 24)

Packages ship compiled ESM in `dist/` (`files: ["dist"]`), not TypeScript source.

## CLI

```bash
# thin shell (published as `nudojs`; installs the `nudo` command)
npm install -g nudojs
# or the full CLI package
npm install @nudojs/cli
# or
pnpm add @nudojs/cli
# or
yarn add @nudojs/cli
```

Then run type inference:

```bash
npx nudojs infer path/to/file.js
# after a global install, the command is simply `nudo`
```

## VS Code Extension

Install the **nudo-vscode** extension for inline type hints and diagnostics:

1. Open VS Code
2. Go to **Extensions** (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for **nudo-vscode** (or "Nudo")
4. Click **Install**

You can also install from the command line:

```bash
code --install-extension wmzy.nudo-vscode
```

## Vite Plugin

Use **vite-plugin-nudo** to run Nudo during development or build:

```bash
npm install vite-plugin-nudo --save-dev
```

In `vite.config.js`:

```javascript
import { defineConfig } from "vite";
import nudo from "vite-plugin-nudo";

export default defineConfig({
  plugins: [nudo()],
});
```

The plugin analyzes files with `@nudo:` directives during the build and reports Nudo diagnostics — evaluator issues plus refinement-gate violations (`nudo:constraint-violated`, `nudo:assign-mismatch`, `nudo:arg-structure`) — as build warnings, or as errors with `failOnError`. See the [Vite plugin guide](../guides/vite-plugin.md).
