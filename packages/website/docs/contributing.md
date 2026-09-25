---
description: Set up the Nudo monorepo and contribute — project structure, development workflow, operator semantics, directives, and docs.
---

# Contributing

Thank you for your interest in contributing to Nudo. This guide covers setup, project structure, development workflow, and how to extend the system.

---

## Prerequisites

- **Node.js** 18 or later (CI uses Node 24)
- **pnpm** 9.1.0 (pinned in `packageManager`; later 9.x also works)

```bash
npm install -g pnpm
```

---

## Clone and Setup

```bash
git clone https://github.com/nudojs/nudo.git
cd nudo
pnpm install
pnpm run build
```

---

## Project Structure

The monorepo uses pnpm workspaces. Key packages:

| Package | Description |
|---------|-------------|
| `@nudojs/core` | Type system (Abs algebra), extensional rendering (format), Environment |
| `@nudojs/parser` | Babel parse, directive extraction, `parseCaseArgExpr` |
| `@nudojs/cli` | CLI commands only (`check`, `test`, `contract`, `export`, `health`) |
| `@nudojs/service` | High-level API: `analyzeFile`, `getTypeAtPosition`, `getCompletionsAtPosition` |
| `@nudojs/lsp` | Language Server Protocol implementation, including AI-agent `executeCommand`/custom requests (see the [Agent guide](./guides/agent-integration.md)) |
| `@nudojs/harvester` | Converts `@types/*.d.ts` into Abs env definitions for `@nudojs/env` authoring and analysis auto-fill (not a product CLI verb) |
| `@nudojs/env` | Built-in environment type definitions (`/// @nudo:env es\|web\|node`, subpath exports `/es` `/web` `/node`) |
| `vite-plugin-nudo` | Vite plugin for type inference during dev |
| `nudo-vscode` | VS Code / Cursor extension |
| `website` | Docusaurus documentation site |

---

## Development Workflow

### Run tests

```bash
pnpm run test
pnpm run test:watch   # watch mode
```

### Build all packages

```bash
pnpm run build
```

### Run CLI locally

```bash
pnpm exec tsx packages/nudojs/src/index.ts check path/to/file.js
# or
pnpm exec nudo check path/to/file.js
pnpm exec nudo test path/to/file.js
```

---

## How to Add New Operator Semantics (Abs-native)

Operator semantics live in the algebra, not a separate `Ops` layer:

1. **Binary arithmetic / comparison** — `packages/core/src/algebra/arithmetic.ts` (Abs-to-Abs). Unary ops and strict equality live in `packages/core/src/algebra/surface.ts` (`typeofAbs`, `negAbs`, `notAbs`, `strictEqAbs`).

2. **Branch merge helpers** — `packages/service/src/evaluator/abs-route.ts` (`tryAbsJoinObjects`, φ-constraint helpers) joins object shapes when branches merge.

3. **Add tests** in `packages/core/src/algebra/__tests__/` (e.g. `surface.test.ts`, `arithmetic.test.ts`) or `packages/service/src/__tests__/`.

---

## How to Add New Directives

1. **Define the directive type** in `packages/parser/src/directives.ts`:

   ```typescript
   export type MyDirective = { kind: "my"; param: string };
   export type Directive = CaseDirective | ... | MyDirective;
   ```

2. **Add a regex** and parsing logic in `parseDirectivesFromComments`:

   ```typescript
   const MY_REGEX = /@nudo:my\s+(\w+)/g;
   // In the loop: match, extract, push { kind: "my", param: ... }
   ```

3. **Use the directive** in the evaluator or service:
   - `packages/nudojs/src/index.ts` or `packages/service/src/analyzer.ts` for analysis behavior.
   - Filter `fn.directives` by `d.kind === "my"` and apply your logic.

4. **Update `parseCaseArgExpr`** if the directive takes type-expression arguments.

5. **Add tests** in `packages/parser/src/__tests__/directives*.test.ts`.

---

## PR Guidelines

- Keep PRs focused; prefer several small PRs over one large one.
- Add or update tests for new behavior.
- Run `pnpm run build` and `pnpm run test` before submitting.
- Update docs (e.g. `docs/concepts/directives.md`, API reference) when adding directives or public APIs.
- **Docs drift rule**: when changing CLI commands/options, exported APIs, or directive syntax, update the documentation under `packages/website` in the same PR — both the English sources (`docs/`) and the Chinese mirrors (`i18n/zh-Hans/docusaurus-plugin-content-docs/current/`).

---

## Releases (VS Code extension)

Full checklist: [`packages/vscode/RELEASE_CHECKLIST.md`](https://github.com/nudojs/nudo/blob/main/packages/vscode/RELEASE_CHECKLIST.md) in the monorepo. Summary of what every Marketplace / Open VS X release must cover:

1. **Bundled server align** — extension ships `server/server.js` copied from `@nudojs/lsp` `dist` via `scripts/bundle-server.mjs`. Build the monorepo first; record the bundled lsp version in the extension CHANGELOG. The vsix is self-contained (no monorepo sibling path at runtime).
2. **Analysis default + escape hatch** — default `nudo.analysis.mode = "exports"`. Escape hatch in project `package.json#nudo.analysis.mode`: `"directives"` (conservative; diagnostics tier `errors`) or `"all"`. Release notes must state this default; a flip that invents diagnostics is a breaking default change.
3. **tsserver coexistence** — Nudo runs beside the built-in TS server. Mixed repos should scope `nudo.analysis.include` / `exclude` — see [Coexistence](./guides/coexistence.md). Do not point both tools at the same `.ts` sources with conflicting severities.
4. **Packaging dry-run** — `pnpm --filter nudo-vscode run build && pnpm --filter nudo-vscode run package`; install the `.vsix` locally; confirm hover/diagnostics on an export-bearing `.js` without editing; confirm palette commands `nudo.selectCase` / `nudo.contract` / `nudo.contract.draft` / `nudo.contract.emit`.
5. **Marketplace / Open VS X notes template** — extension version, bundled lsp version, analysis default, coexistence blurb, protocol surface pointer ([PUBLIC_API](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md)), known issues. Both targets in `release.yml` or an explicit skip.

Service-level daily smoke (no live VS Code): `packages/lsp/src/__tests__/ide-daily-smoke.test.ts`. Public freeze inventory: `@nudojs/lsp` [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) / [API page](./api/lsp.md).

---

## Code Style

- **TypeScript**: strict mode, ES modules.
- **Types**: Prefer `type` over `interface` and `enum`.
- **Structure**: Avoid class/OOP; use plain functions and objects.
- **Mutability**: Minimize `let`; prefer `const` and pure functions.
- **Control flow**: Minimize conditional branches; use early returns and small functions.
