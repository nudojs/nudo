# Versioning & Release Policy (E6)

How Nudo packages are versioned, what counts as a breaking change, and how to follow the changeset workflow.

## Package maturity

| Package | Current | Line | Policy |
|---------|---------|------|--------|
| `@nudojs/core` | 1.0.x | stable | SemVer 1.x — breaking = **major** |
| `@nudojs/service` | 1.0.x | stable | SemVer 1.x — breaking = **major** |
| `@nudojs/cli` | 1.0.x | stable | SemVer 1.x — breaking = **major** |
| `@nudojs/parser` | 0.4.x | pre-1.0 | Minor may break; patch is additive/fix |
| `@nudojs/lsp` | 0.7.x | pre-1.0 | Minor may break; patch is additive/fix |
| `@nudojs/env` | 0.2.x | pre-1.0 | Minor may break |
| `@nudojs/harvester` | 0.2.x | pre-1.0 | Minor may break |
| `nudojs` (shell) | 0.2.x | pre-1.0 | Tracks `@nudojs/cli`; prefer depending on `@nudojs/*` directly |
| `vite-plugin-nudo` | 0.3.x | pre-1.0 | Minor may break |
| `nudo-vscode` | 0.3.x | private | Marketplace release notes; not npm-semver for consumers |

The monorepo root (`nudo-monorepo@0.3.0`) is private and is **not** a publish unit. Published versions are per-package.

### 0.x SemVer (pre-1.0 packages)

Following common 0.x practice and npm’s caret rules:

- **`0.x.y` → `0.x.(y+1)` (patch)**: bugfixes, perf, docs, non-breaking additive APIs. Safe to take immediately.
- **`0.x.y` → `0.(x+1).0` (minor)**: **may** include breaking changes. Always read that package’s `CHANGELOG.md` before upgrading.
- **No 1.0 promise until** the package’s public surface is frozen for a full minor cycle without unplanned breaks.

### 1.x SemVer (core / service / cli)

- **patch**: soundness fixes that do **not** change documented public API shapes; may change inferred types when the old result was wrong (documented as “behavior fix” in the changeset, not API break).
- **minor**: additive APIs, new diagnostic codes, new CLI flags, new optional config keys.
- **major**: removals, renames, signature changes, schema breaks (JSON / dts / CheckJson), default-behavior flips that silence or invent diagnostics.

> Soundness fixes that change *results* without changing *API* ship as **patch** with an explicit changeset note. Consumers who pin exact diagnostic snapshots must re-run goldens on patch upgrades.

## What counts as breaking (Nudo-specific)

Treat as **breaking** (major on 1.x, minor on 0.x):

| Surface | Examples |
|---------|----------|
| Public package exports | Removing a subpath (`@nudojs/cli/evaluator` → `@nudojs/service/evaluator` was a 1.0.0 major) |
| `CheckJson` / `InferJson` schema | Field removal/rename; `version` bump without dual-read |
| `.d.ts` projection shape | Signature text changes that break `tsc --noEmit` consumers of generated types |
| Diagnostic codes | Renaming codes; removing codes; changing severity of existing codes by default |
| CLI flags / defaults | Removing flags; flipping default `analysis.mode` / `autoBind` without a config escape |
| Directive grammar | Removing `@nudo:*` kinds; changing accepted `T.*` / refine syntax |
| LSP protocol contracts | Removing `nudo.*` commands or `nudo/…` requests; changing positional CodeLens args |
| Sidecar semantics | Changing binding keys, `@generated` markers, or handwritten-wins rules |

Treat as **non-breaking** (patch/minor):

- New diagnostic codes (opt-in visibility)
- New optional config keys under `package.json#nudo`
- New CLI flags with safe defaults
- Inference precision improvements (more precise types)
- Removing **undocumented** internal modules not listed in package `exports`
- Docs / website / private packages

## Changeset workflow

Config: `.changeset/config.json` — public access, base branch `main`, `updateInternalDependencies: patch`.

### Authoring

```bash
pnpm exec changeset
```

1. Select affected packages (multi-select for cross-package breaks).
2. Bump type:
   - pre-1.0 package + breaking → **minor**
   - pre-1.0 package + fix/additive → **patch**
   - 1.0 package + API/schema break → **major**
   - 1.0 package + additive → **minor**
   - 1.0 package + fix/soundness → **patch**
3. Write a summary that answers **who breaks** and **how to migrate** in 1–3 bullets. Prefix with `**BREAKING**:` when applicable (see `@nudojs/core@1.0.0` changelog style).

Markdown body lives in `.changeset/<slug>.md`:

```markdown
---
"@nudojs/core": major
"@nudojs/service": minor
---

**BREAKING**: short description.

Migration: `old` → `new`.
```

### Release (CI)

`release.yml` on `main`:

1. `changeset version` — applies bumps + changelog entries + `scripts/bump-vscode-version.mjs`
2. Publish via npm Trusted Publishing (environment `NPM_TOKEN`)
3. Deploy docs / package VS Code extension (Marketplace / Open VSX)

Do **not** hand-edit published `CHANGELOG.md` history on `main`; fix forward with a new changeset.

### Local dry-run

```bash
pnpm exec changeset status
pnpm run ci:version   # only on a throwaway branch — rewrites package.json versions
```

## Migration notes (known breaking waves)

### 1.0.0 — Abs-native production path

| Change | Migration |
|--------|-----------|
| `@nudojs/cli/evaluator` removed | `import { … } from "@nudojs/service/evaluator"` |
| TypeValue evaluator IR removed from production analysis | Consume Abs (`shape × term × pred × conf`); do not reintroduce TypeValue as a second IR |
| `CallRecord` is Abs-only (`argAbs` / `resultAbs` / `throwsAbs`) | Stop reading `argTypes` TypeValue fields |
| Body-slot “implicit shape” obligations removed (C0) | No evidence → `any` / call-site facts. Contracts only from `*.nudo.js` / `@nudo:refine` / call sites |
| Interface tiers | `handwritten` = obligation · `generated` = fact + drift · `implicit` = display only |

### Directive / contract surface

| Change | Migration |
|--------|-----------|
| `T.*` directive grammar deprecated | Prefer `@nudo:refine` + `*.nudo.js` constraint builders; `T.*` still parses |
| Class methods / CJS / `export default` sidecar keys | Use `Class.method`, `Class_method`, nested objects, or local export names — see `design-refine-derivation.md` |
| `nudo.interface` product name | `nudo refine` is an alias; prefer `nudo interface` |

### IDE / agent surface

| Change | Migration |
|--------|-----------|
| CodeLens is interface-first | Case lenses still work as the debug sub-layer |
| Hover/inlay/tokens share `interfaceTierOf` (A7) | Clients must render new semantic modifiers `contract`/`generated`/`derived` or ignore unknown modifiers |
| Agent tools honor project `autoBind` (E5) | Clients cannot re-enable sidecars when `nudo.interface.autoBind: false` |

## Consumer pinning guide

| Goal | Pin |
|------|-----|
| Reproducible CI check | Exact versions: `"@nudojs/core": "1.0.1"` |
| Take fixes only | Caret on 1.x: `"^1.0.1"`; on 0.x treat minor as possible break |
| Track LSP/IDE | Prefer VS Code/Zed extension release notes over npm caret |
| Monorepo workspace | Internal deps bump via changesets (`patch`); align majors deliberately |

## Checklist for a breaking PR

- [ ] Changeset with `**BREAKING**:` + migration line
- [ ] Affected packages selected (not only the leaf that changed)
- [ ] Gold tests / `verify:examples` updated if pins or output text changed
- [ ] `docs/` design notes and website guides updated when semantics shift
- [ ] CHANGELOG style matches existing 1.0.0 entries (who / what / how to migrate)

## See also

- `.changeset/README.md` — changesets tool docs pointer
- `docs/superpowers/plans/2026-05-28-close-ts-dx-gaps.md` — E6 task
- `docs/design-refine-derivation.md` — interface tier semantics
- Website guide: `packages/website/docs/guides/versioning.md`
