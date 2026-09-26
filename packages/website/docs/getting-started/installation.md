---
description: Install the Nudo CLI, VS Code extension, and Vite plugin via npm, pnpm, or yarn — published packages require Node.js >= 20.
---

# Installation

Install Nudo tools via npm, pnpm, or yarn. Surfaces: the **CLI** (`nudojs`), the **VS Code extension** (`nudo-vscode`), the **Zed extension**, and the **Vite plugin** (`vite-plugin-nudo`).

## Prerequisites

- **Run the published CLI**: Node.js >= 20 (`engines` on all published packages)
- **Develop this repo**: Node.js >= 20 (CI uses Node 24)

Packages ship compiled ESM in `dist/` (`files: ["dist"]`), not TypeScript source. There is no separate runtime to install — the CLI is plain Node.

## CLI

```bash
# global install — provides the `nudo` command
npm install -g nudojs
# or add as a project dependency
npm install nudojs
# or
pnpm add nudojs
# or
yarn add nudojs
```

Then observe and gate your code:

```bash
npx nudojs check path/to/file.js   # signatures + contract gate
npx nudojs test path/to/file.js    # call-site case reports
# after a global install, the command is simply `nudo`
```

Primary verbs: `check` / `test` / `contract` / `export` / `health`. There is no `infer` verb — observation is `check` signatures, `test` cases, and IDE hover.

| Install style | Command shape | Use when |
|---|---|---|
| Global (`npm i -g nudojs`) | `nudo check …` | Day-to-day local work, shell scripts |
| Project dep (`pnpm add nudojs`) | `npx nudojs check …` | CI, reproducible versions next to the code |
| One-shot (`npx nudojs …`) | no install | Trying Nudo before committing to a dep |

### npx

`npx nudojs check src/` is the standard CI invocation — it resolves the project-local install when present, and downloads one otherwise. Prefer a project dependency (plus a lockfile) in pipelines so the analyzer version is pinned.

### Monorepo / pnpm workspaces

Install `nudojs` once in the workspace root, or per package that Nudo should gate. Scope IDE analysis with `nudo.analysis.include` / `exclude` so JS packages get Nudo and TS packages stay on `tsc`:

```json
{
  "nudo": {
    "analysis": {
      "mode": "exports",
      "include": ["packages/js-lib/src/**"],
      "exclude": ["**/*.test.ts", "packages/ts-lib/**"]
    }
  }
}
```

Details: [Coexistence with TypeScript](../guides/coexistence.md) · [Recipes — monorepo](../guides/recipes.md).

## VS Code extension

Install the **nudo-vscode** extension for inline type hints and diagnostics:

1. Open VS Code
2. Go to **Extensions** (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for **nudo-vscode** (or "Nudo")
4. Click **Install**

Published on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=wmzy.nudo-vscode) and on Open VSX. You can also install from the command line:

```bash
code --install-extension wmzy.nudo-vscode
```

The vsix is self-contained: it bundles the language server, so you do not need a separate `@nudojs/lsp` install for the extension to start. Activation is `onLanguage:javascript` / `onLanguage:typescript`; whether a buffer is *analyzed* is the `nudo.analysis.mode` gate. Full surface: [VS Code guide](../guides/vscode.md).

## Zed

The **nudo** Zed extension attaches Nudo's language server to JavaScript and TypeScript buffers as a *secondary* language server (alongside `vtsls`). It lives in a standalone repository ([nudojs/nudo-zed](https://github.com/nudojs/nudo-zed)) and needs `@nudojs/lsp` ≥ 0.5.0 available project-locally, globally, or via Zed's npm fallback.

Install and settings walkthrough: [Zed extension](../guides/zed.md). Other editors: [LSP clients](../guides/lsp-clients.md).

## Vite plugin

Use **vite-plugin-nudo** to run Nudo during development or build:

```bash
npm install vite-plugin-nudo --save-dev
# or
pnpm add -D vite-plugin-nudo
```

In `vite.config.js`:

```javascript
import { defineConfig } from "vite";
import nudo from "vite-plugin-nudo";

export default defineConfig({
  plugins: [nudo()],
});
```

During the build the plugin analyzes files that pass `nudo.analysis.mode` (shipped default `"exports"`) and reports Nudo diagnostics — evaluator issues plus refinement-gate violations (`nudo:constraint-violated`, `nudo:assign-mismatch`, `nudo:arg-structure`) — as build warnings, or as errors with `failOnError`. See the [Vite plugin guide](../guides/vite-plugin.md).

## Verify the install

Smoke-test the CLI on any small JS file:

```bash
npx nudojs check path/to/file.js
```

You should see `signatures` printed on success *and* failure — `check` is not silent. Exit `0` means the gate passed; exit `1` means an error-level diagnostic (L1 contract or L2 entry may-throw). Next, open the same file in VS Code or Zed and hover an export: the inferred signature should match the CLI.

If `npx nudojs` is missing or fails to resolve, check the Node version (`node -v` ≥ 20) and that the package name is `nudojs` (the npm package), while the binary is `nudo` / `nudojs`.

## Next steps

- [Quick start](./quick-start.md) — signatures, cases, and a first sidecar contract
- [Mental model](./mental-model.md) — how Abs analysis is different from a checker
- [Concept layers](../concepts/layers.md) — Observation / Contracts / Advanced, pick what you need
- [CLI Reference](../api/cli-reference.md) — every flag and exit code
