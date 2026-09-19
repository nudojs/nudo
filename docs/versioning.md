# Versioning & Release Policy (E6)

How Nudo packages are versioned, what counts as a breaking change, and how to follow the changeset workflow.

## Package maturity

> **Source of truth for Current versions:** each `packages/*/package.json`. This policy doc does not pin patch numbers.
>
> **Intentional behavior changes (fix-2) — release notes, not regressions:**
> 1. **C0.1:** body-AST required-slot inference removed. Obligations come only from explicit contracts or call-site facts.
> 2. **A1:** `analysis.mode` shipped default flipped `directives` → `exports` (`DEFAULT_ANALYSIS_MODE` in `@nudojs/service`). Escape hatch: `package.json#nudo.analysis.mode = "directives"` (old silence) or `"all"` (every target path). On **1.x** packages this is a **default-behavior flip that can invent diagnostics** on previously unanalyzed export-bearing files → treat as **major** in changesets/release notes unless the team ships a documented minor with the escape hatch called out.
>
> `@nudojs/core` / `@nudojs/service` / `@nudojs/cli` are already on the **1.x** line (see each package.json). The monorepo root version is private and is not a publish unit.
>
> **Current package.json facts (do not invent bumps here):** `@nudojs/lsp@0.8.0`, `@nudojs/env@0.3.0`, `@nudojs/harvester@0.2.5`, `nudo-vscode@0.3.5` (private). Policy doc never pins patch numbers as a release action.

| Package | Current | Line | Policy |
|---------|---------|------|--------|
| `@nudojs/core` | see package.json | stable | SemVer 1.x — breaking = **major** |
| `@nudojs/service` | see package.json | stable | SemVer 1.x — breaking = **major** |
| `@nudojs/cli` | see package.json | stable | SemVer 1.x — breaking = **major** |
| `@nudojs/parser` | 0.4.x | pre-1.0 | Minor may break; patch is additive/fix |
| `@nudojs/lsp` | **0.8.0** | pre-1.0 | Minor may break; patch is additive/fix. **1.x gate (A1/A2):** observe freeze via [`packages/lsp/PUBLIC_API.md`](../packages/lsp/PUBLIC_API.md) for ≥1 minor cycle with no unplanned stable-surface breaks; **no automatic version bump** — cut 1.0 only with an explicit major changeset |
| `@nudojs/env` | **0.3.0** | pre-1.0 | Minor may break. **B8 coordination:** service/cli/env consumers pin a **minor** deliberately; coverage numbers optional in release notes; not on the core 1.x timetable |
| `@nudojs/harvester` | **0.2.5** | pre-1.0 | Minor may break. Same B8 rhythm as `@nudojs/env` (harvest products remain a side channel, never Abs truth) |
| `nudojs` (shell) | 0.2.x | pre-1.0 | Tracks `@nudojs/cli`; prefer depending on `@nudojs/*` directly |
| `vite-plugin-nudo` | 0.3.x | pre-1.0 | Minor may break |
| `nudo-vscode` | 0.3.5 | private | Marketplace / Open VSX release notes; not npm-semver for consumers. Bundled `@nudojs/lsp` must match the monorepo lsp dist at package time (see `packages/vscode/RELEASE_CHECKLIST.md`) |

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
| Class methods / CJS / `export default` sidecar keys | Use `Class.method` (**local declaration name**, not export alias), `Class_method`, nested objects, or local export names — `export { Local as Public }` binds `Local.method`, not `Public.method`. See `design-refine-derivation.md` |
| `nudo.interface` product name | `nudo refine` is an alias; prefer `nudo interface` |

### IDE / agent surface

Inventory: [`packages/lsp/PUBLIC_API.md`](../packages/lsp/PUBLIC_API.md)
(executeCommand dot form, slash-form `nudo/…` protocol contract,
`AGENT_TOOL_SOURCES`, initialize capabilities, CheckJson/InferJson pointers).
Regression pin: `packages/lsp/src/__tests__/public-api-surface.test.ts`.

| Change | Migration |
|--------|-----------|
| CodeLens is interface-first | Case lenses still work as the debug sub-layer |
| Hover/inlay/tokens share `interfaceTierOf` (A7) | Clients must render new semantic modifiers `contract`/`generated`/`derived` or ignore unknown modifiers |
| Agent tools honor project `autoBind` (E5) | Clients cannot re-enable sidecars when `nudo.interface.autoBind: false` |
| Slash-form `nudo/…` is the protocol contract | Dot-form `nudo.*` remains valid for executeCommand + MCP bridges; do not invent a third spelling |
| executeCommand aliases `nudo.interfaceDraft` / `nudo.interfaceEmit` | Prefer `nudo.interface.draft` / `nudo.interface.emit`; aliases stay through 1.x — removal after 1.0 is **major** |
| CheckJson / InferJson v1 schema | Field add-only; removals/renames are **major** on 1.x core/service (lsp surfaces them unchanged) |
| Default `analysis.mode=exports` + `diagnostics=default` | Escape hatch `package.json#nudo.analysis.mode`; flipping defaults that invent/silence diagnostics is **major** on 1.x |
| lsp 1.x cut | Only after PUBLIC_API stable rows sit through ≥1 0.x minor with no unplanned break; changeset template mirrors core 1.0 `**BREAKING**:` table |

### env / harvester (B8 coordination)

`@nudojs/env` (0.3.0) and `@nudojs/harvester` (0.2.5) stay **pre-1.0** while
coverage baselines land. Consumers that need bit-stable IDE/CI analysis pin an
exact or tilde minor (`"@nudojs/env": "~0.3.0"`). Harvest output remains a
side channel: handwritten project `@nudo:env` / mocks win over harvested
modules; conflicts warn, they do not silently replace Abs truth. When these
packages later cut 1.x, use the same freeze-observation gate as lsp — no
automatic major from coverage-report growth alone.

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
- `docs/design-eval-missing-slot.md` — C0.5 optional eval-driven diagnostics
- Website: `guides/migrating-js.md` — code-first migration walkthrough
- Website guide: `packages/website/docs/guides/versioning.md`

## Ecosystem packages (env / harvester)

> Added for P0-B (2026-09-19). Agent B owns this subsection; do not duplicate
> under a different heading.

`@nudojs/env` and `@nudojs/harvester` are **pre-1.0** sidecar packages consumed
by `@nudojs/service` / `@nudojs/cli`. They do **not** carry their own SemVer
1.x freeze; service/cli pin them via workspace/release versions.

| Package | Pin style | When to bump minor | Release-notes suggestion |
|---------|-----------|--------------------|---------------------------|
| `@nudojs/env` | workspace / caret on 0.x | New Abs env modules or signature-level APIs that service CLI/tests depend on (e.g. `events` / `stream` / `querystring` slots) | Optional **Coverage** section: `node resolved N/M (unknown=…, mock-required=…)` from `pnpm run coverage:env` / `docs/reports/env-coverage-baseline.json` |
| `@nudojs/harvester` | workspace / caret on 0.x | Harvest result shape changes (`HarvestedEnv.stats`, module key aliases) or emit format changes that break generated `defineEnv` files | Note harvest budget defaults if changed (`maxFiles` / `maxMs`); regenerate CLI harvest samples |

Rules:

- **0.x**: patch = additive env signatures / harvest fixes; minor **may** break
  generated env consumers — always ship a changeset that names the migration.
- Handwritten `@nudojs/env` **wins** over harvest when both supply the same
  builtin module (priority documented in website harvester API). Changing that
  priority is **breaking** for service analysis results → minor on 0.x + callout.
- Coverage report numbers are **optional release-notes content**, not a
  soundness gate. Do not promise completeness from resolved-ratio.
- `NUDO_HARVEST_NODE=off` and harvest cache helpers (`clearNodeHarvestCache`)
  are public service API surface — treat removals as service 1.x **major**.
