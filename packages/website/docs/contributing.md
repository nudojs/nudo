---
description: Set up the Nudo monorepo and contribute — project structure, development workflow, operator semantics, directives, and docs.
---

# Contributing

Thank you for your interest in contributing to Nudo. This guide covers setup, project structure, development workflow, and how to extend the system.

---

## Prerequisites

- **Node.js** >= 20 (CI uses Node 24)
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
| `nudojs` | The `nudo` CLI (`check` / `test` / `contract` / `export` / `health`, plus the one-way `migrate` TypeScript retirement gate `status` \| `strip` \| `verify` \| `retire`) |
| `@nudojs/service` | Analysis core: analyzer orchestration (`analyzeFile`), Abs-native evaluator, session caches; emit products at `@nudojs/service/emit` (interface/dts/schema/guard/case) |
| `@nudojs/lsp` | Language Server Protocol implementation — hover/completions (`getTypeAtPosition`, `getCompletionsAtPosition`) and AI-agent `executeCommand`/custom requests (see the [Agent guide](./guides/agent-integration.md)) |
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
- **Blog dates are publication truth.** Put the real publish date in frontmatter `date:` (and the `YYYY-MM-DD-` filename prefix). Do not backdate or batch-rewrite history for freshness. Multi-post drops get a `launch-series` (or similar) tag plus a short ordered series banner — see the 2026-09-21 launch set. New posts after that date should land on their actual calendar day so the archive stays honest.

---

## Docs maintenance {#docs-maintenance}

The site (`packages/website`) is gated like code. A docs PR runs the same CI as an engine PR, so know the toolbox before you edit prose.

### Gate toolbox

| Command | What it enforces |
|---|---|
| `pnpm run verify:docs [-- --report]` | Executes every tagged code block through the real CLI and greps the printed output for the page's promised lines; also audits CLI verbs/flags both ways (`docs` ↔ `packages/nudojs/src/commands`), checks zh fence parity byte-for-byte, and (with `--report`) the verified-page coverage floor. Needs `pnpm run build` first. |
| `pnpm run verify:examples` | The `docs/examples/` matrix (`docs/examples/README.md`) — commands × expected exit codes + output pins. |
| `pnpm run verify:links` | Offline route check for absolute `nudojs.github.io/nudo/...` links in READMEs and site sources. |
| `pnpm vitest run packages/website/tests` | The docs-as-code rules: i18n mirror parity, fence metadata, sidebar↔page pairing, `llms.txt`↔route↔title sync, glossary anchors, examples-table↔matrix consistency, design-notes index coverage, homepage stat sourcing, playground presets. |
| `pnpm run docs:gen` + `git diff --exit-code -- packages/website/docs/{releases*,api}` | Generated pages (`releases*`, `guides/versioning`, `api/*` skeleton) must match their sources. Never hand-edit them. |
| `pnpm --filter website run build` | Docusaurus build: broken links and broken anchors throw. |
| `pnpm run docs:build` | The full local production build — runs the site build **and** the `postbuild` step that writes per-page `.md` sidecars + `llms-full.txt`. |

A weekly scheduled job (`docs-links.yml`) checks external links; it never blocks a PR.

### Code fence tags

Code blocks are documentation until they are tagged. The site's fenced blocks are the input of `verify:docs`:

| Opening fence | Meaning |
|---|---|
| ```` ```js ```` / ```` ```javascript ```` | Documentation only. Gets a Playground button unless `noplayground`. |
| ```` ```js verify ```` | Appended (in page order) to `<page>.js` and executed with `nudo check` / `nudo test`. |
| ```` ```js verify-sidecar ```` | Appended to `<page>.nudo.js` — the auto-binding sidecar for the page's main file. |
| ```` ```js verify#<slug> ```` | A **scenario file**: `<page>-<slug>.js`, executed on its own. Use it when a page shows several independent examples whose line numbers (`call@L5`, `entry@L1`) must stay truthful. |
| ```` ```js verify-sidecar#<slug> ```` | Sidecar for that scenario. |
| ```` ```js noplayground ```` | Hides the Playground button (keeps the block runnable). |

Rules of thumb:

- Pin **only** strings the CLI actually prints — never invent golden output.
- A page that teaches CLI output should carry at least one `verify` block; quoting another page is allowed, but `verify:docs` will require the quoted line to still exist in the real run.
- zh mirrors carry the **same** fences byte-for-byte (only prose is translated). `verify:docs` fails on any byte drift.

### Page conventions

- Every page needs frontmatter `description` (search, `llms.txt`, JSON-LD).
- New pages land as a **pair**: `docs/<path>.md` + `i18n/zh-Hans/docusaurus-plugin-content-docs/current/<path>.md`, registered in `sidebars.ts`, with an entry in `static/llms.txt` in the form `- [<page H1>](<url>): <one-line summary>`.
- Keep English pages free of CJK text (the `en` tree is the source language).
- Docs in the repository (`docs/design/*.md`, `docs/reports/*.md`, `docs/examples/`) are linked with full GitHub URLs; new design notes must be listed in [Design notes](./design/notes.md).
- Do not hand-edit generated pages: `releases.md`, `releases-history.md`, `guides/versioning.md`, `api/*` skeleton blocks.
- Page-level provenance (engine version + build commit) and the JSON-LD/OG metadata are generated at build time — no manual version bookkeeping.
- Static social cards live in `packages/website/static/img/` (`nudo-og.jpg`); the site is one OG image by design (per-page cards would need a rasterizer in CI).

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
