---
sidebar_position: 10
description: "How Nudo packages are versioned: 0.x vs 1.x SemVer, what counts as breaking, changeset workflow, and migration notes."
---

# Versioning & Releases

Nudo is a pnpm monorepo that publishes **per-package** versions via [changesets](https://github.com/changesets/changesets). The monorepo root version is private and is not a publish unit.

## Package lines

| Package | Line | Upgrade rule |
|---------|------|----------------|
| `@nudojs/core` | **2.x** (stable SemVer line) | SemVer: breaking → major |
| `@nudojs/service` | **2.x** (stable SemVer line) | SemVer: breaking → major |
| `@nudojs/cli` | **2.x** (stable SemVer line) | SemVer: breaking → major |
| `@nudojs/parser` | 0.x | **Minor may break** — read CHANGELOG |
| `@nudojs/lsp` | 0.x (**0.8.0** pre-1.x) | **Minor may break**. 1.x gate: observe freeze via `packages/lsp/PUBLIC_API.md` — no automatic bump |
| `@nudojs/env` / `@nudojs/harvester` | 0.x (**0.3.0** / **0.2.5**) | Minor may break; pin a minor for stable IDE/CI analysis. Handwritten env wins on overlapping modules/exports (`mergeHarvestUnderEnv`) |
| `nudojs` (npm shell) | 0.x | Prefer `@nudojs/cli` / `@nudojs/core` directly |
| `vite-plugin-nudo` | 0.x | Minor may break |
| `nudo-vscode` | Marketplace | Follow extension release notes |

### 0.x in one sentence

`0.x.y` patches are safe; `0.(x+1).0` minors **may** contain breaking changes. Pin exact versions in CI if you need bit-stable diagnostics.

### 1.x in one sentence

Patches fix soundness (results may get *more correct*); minors add APIs/codes/flags; majors remove or rename public surfaces.

Full policy (what Nudo treats as breaking): [`docs/versioning.md`](https://github.com/nudojs/nudo/blob/main/docs/versioning.md) in the repo.

## Ecosystem packages (`@nudojs/env` / `@nudojs/harvester`)

> Authoritative long form lives in repo `docs/versioning.md` § Ecosystem packages. This section is the consumer-facing summary.

| Package | Current | Pin style | Notes |
|---------|---------|-----------|-------|
| `@nudojs/env` | 0.3.0 (pre-1.0) | workspace / `~0.3.0` for bit-stable IDE/CI analysis | New Abs modules (e.g. `events` / `stream` / `querystring`) ship as **minor**; signature display may change. Handwritten env **wins** over harvest on overlapping modules/exports. |
| `@nudojs/harvester` | 0.2.5 (pre-1.0) | workspace / `~0.2.5` | Harvest is a **side channel** — not the type-system source of truth. Budget defaults: `maxFiles=12`, `maxMs=2500`, disable via `NUDO_HARVEST_NODE=off`. |

Rules:

- **Handwritten `@nudojs/env` wins** over harvest / auto-harvest when both supply the same module key or export name. Analysis injects via `mergeHarvestUnderEnv` in `@nudojs/service`; harvest only fills missing slots. Changing that priority is service-breaking.
- Coverage reports (`pnpm run coverage:env` → `docs/reports/env-coverage-baseline.*`) are **optional release-notes content**, not a soundness gate. Prefer **leaf-clean** counts over raw resolved ratios.
- Production bare-import harvest injects through `abs-modules-graph` / `harvest-to-abs` (`bareSpecToAbsModules`). `autoHarvestModules` remains a library helper for programmatic harvest, not a second analysis path.

## What usually breaks

- Removing package export subpaths
- `CheckJson` / `InferJson` / generated `.d.ts` schema or shape changes
- Renaming diagnostic codes or flipping default severity
- Removing CLI flags or changing analysis defaults without an escape hatch
- **Default `analysis.mode` flip** (`directives` → `exports` in fix-2): intentional on 1.x service/cli — escape hatch `package.json#nudo.analysis.mode`; treat as **major** in release notes
- Directive grammar / sidecar binding-key changes
- Class-method / export-alias sidecar keys use the **local declaration name** (`Local.method` for `export { Local as Public }`), not the public export alias
- Removing LSP `nudo.*` commands or custom requests

**Non-breaking:** new diagnostic codes, new optional `package.json#nudo` keys, more precise inference, new CLI flags with safe defaults.

## Following releases

Each published package ships a `CHANGELOG.md` maintained by changesets. Breaking entries are prefixed `**BREAKING**:` and include a one-line migration.

Example (core 1.0.0): evaluator subpath moved from `@nudojs/cli/evaluator` to `@nudojs/service/evaluator`.

```bash
# after a minor bump on a 0.x package
npm i @nudojs/lsp@0.8.0
# read node_modules/@nudojs/lsp/CHANGELOG.md for BREAKING bullets
```

## Changesets (contributors)

```bash
pnpm exec changeset
```

Pick packages + bump type, then write a short **who breaks / how to migrate** summary. CI on `main` runs `changeset version` → publish → docs/VS Code packaging.

| Situation | Bump |
|-----------|------|
| 0.x package, breaking | minor |
| 0.x package, fix/additive | patch |
| 1.x package, API/schema break | major |
| 1.x package, additive | minor |
| 1.x package, soundness fix | patch (note result changes) |

## Pinning recipes

```jsonc
// reproducible CI
{ "dependencies": { "@nudojs/core": "1.0.1" } }

// 1.x: track compatible fixes
{ "dependencies": { "@nudojs/core": "^1.0.1" } }

// 0.x: only take patches automatically
{ "dependencies": { "@nudojs/lsp": "~0.8.0" } }
```

## IDE extensions

VS Code (`wmzy.nudo-vscode`) and Zed (`nudojs/nudo-zed`) bundle or resolve `@nudojs/lsp`. Extension release notes are the source of truth for editor-facing changes; the language server still follows the 0.x table above. VS Code packaging checklist: repo `packages/vscode/RELEASE_CHECKLIST.md`. LSP freeze inventory: repo `packages/lsp/PUBLIC_API.md`.

## See also

- [LSP Client Matrix](./lsp-clients.md)
- [VS Code Extension](./vscode.md)
- [Zed Extension](./zed.md)
- [Agent Integration](./mcp-server.md)
- [Coexistence with TypeScript](./coexistence.md)
- [@nudojs/lsp API](../api/lsp.md)
