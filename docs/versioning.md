<!-- CLI semantics: docs/design/cli-semantics.md — primary verbs check/test/contract/export/health.
     L1 explicit contracts + L2 entry may-throw. Harvest is not a product verb. -->
# Versioning & Release Policy (E6)

How Nudo packages are versioned, what counts as a breaking change, and how to follow the changeset workflow.

## Package maturity

> **Source of truth for Current versions:** each `packages/*/package.json`. This policy doc does not pin patch numbers.
>
> **Intentional behavior changes (fix-2) — release notes, not regressions:**
> 1. **C0.1:** body-AST required-slot inference removed. Shape-slot obligations come only from explicit contracts or call-site facts. **L2 is different:** entry may-throw (`nudo:entry-may-throw`) is a runtime-boundary obligation on export/entry functions — default **error**, filterable via `--ignore-throws` / `package.json#nudo.check.ignoreThrows`. It does **not** invent body slots.
> 2. **A1:** `analysis.mode` shipped default flipped `directives` → `exports` (`DEFAULT_ANALYSIS_MODE` in `@nudojs/service`). Escape hatch: `package.json#nudo.analysis.mode = "directives"` (old silence) or `"all"` (every target path). On **1.x** packages this is a **default-behavior flip that can invent diagnostics** on previously unanalyzed export-bearing files → treat as **major** in changesets/release notes unless the team ships a documented minor with the escape hatch called out.
> 3. **CLI semantics:** primary verbs are `check` / `test` / `contract` / `export` / `health`. Observation is check signatures + test case reports + IDE hover; `watch` is `--watch` on check/test. Flags: `--from`, `test --freeze`, `export --format dts|guard|schema|standard|all` with `--dialect zod` for schema, `export --out`. Entry unconstrained params display as **`any`**; true `unknown` = inference failure. Harvest is **not** a product verb (`@types` auto-fill is analysis-internal; env-package generation uses `@nudojs/harvester`).
>
> `@nudojs/core` / `@nudojs/service` / `nudojs` / `@nudojs/parser` / `@nudojs/lsp` are on the **stable SemVer 1.x+ line** (each package’s major may differ — see package.json). **Packages version independently; majors are not lockstep.** At time of writing the major lines differ (illustrative only — package.json is authoritative): core on 3.x, service on 5.x, nudojs on 1.x. The monorepo root version is private and is not a publish unit.
>
> **Do not pin exact versions in this policy doc.** Authoritative numbers live in each `packages/*/package.json` and the consumer-facing table in website `guides/versioning.md` (`NUDO-VERSIONS` block). This file states **lines and rules only**.

| Package | Line | Policy |
|---------|------|--------|
| `@nudojs/core` | stable 1.x+ | SemVer — breaking = **major** |
| `@nudojs/service` | stable 1.x+ | SemVer — breaking = **major** |
| `nudojs` | stable 1.x+ | SemVer — breaking = **major** |
| `@nudojs/parser` | stable 1.x+ | SemVer — breaking = **major** |
| `@nudojs/lsp` | stable 1.x+ | SemVer — breaking = **major**. Freeze inventory: [`packages/lsp/PUBLIC_API.md`](../packages/lsp/PUBLIC_API.md) |
| `@nudojs/env` | pre-1.0 | Minor may break. Policy authority: [Ecosystem packages](#ecosystem-packages-env--harvester) |
| `@nudojs/harvester` | pre-1.0 | Minor may break. Policy authority: [Ecosystem packages](#ecosystem-packages-env--harvester) |
| `@nudojs/cli` | deprecated stub | Forwards to `nudojs`; do not depend on it. Prefer `npm i nudojs` / `@nudojs/*` directly. **Sunset:** see [`@nudojs/cli` sunset](#nudojscli-sunset-deprecated-forward-stub) |
| `vite-plugin-nudo` | pre-1.0 | Minor may break |
| `nudo-vscode` | private | Marketplace / Open VSX release notes; not npm-semver for consumers. Bundled `@nudojs/lsp` must match the monorepo lsp dist at package time (see `packages/vscode/RELEASE_CHECKLIST.md`) |

The monorepo root (`nudo-monorepo@0.3.0`) is private and is **not** a publish unit. Published versions are per-package.

### `@nudojs/cli` sunset (deprecated forward stub)

`@nudojs/cli` is a **deprecated forward stub** kept only for migration. It forwards the `nudo` bin and module entry to [`nudojs`](https://www.npmjs.com/package/nudojs) and prints a deprecation line on stderr. CHANGELOG already claims it will be unpublished after the first stable 1.0 release train / one beta cycle — the **deadline is explicit and checkable**:

- **Unpublish no later than 30 days after `nudojs@1.0.0` stable** ships on npm `latest`.
- **Or immediately**, whichever comes first, if npm download data shows only monorepo CI traffic (no third-party installs) — in that case the stub can be removed as soon as the stable train lands.

Consumers should migrate now:

```bash
npm rm @nudojs/cli
npm i nudojs          # same `nudo` command
nudo --version        # prints `nudojs <ver>` (+ `@nudojs/core <ver>` when resolvable)
```

Do not add new dependencies on `@nudojs/cli`. After the unpublish date, `import "@nudojs/cli"` / `npx @nudojs/cli` will fail; use `nudojs` / `nudo` instead.

### 0.x SemVer (pre-1.0 packages)

Following common 0.x practice and npm’s caret rules:

- **`0.x.y` → `0.x.(y+1)` (patch)**: bugfixes, perf, docs, non-breaking additive APIs. Safe to take immediately.
- **`0.x.y` → `0.(x+1).0` (minor)**: **may** include breaking changes. Always read that package’s `CHANGELOG.md` before upgrading.
- **No 1.0 promise until** the package’s public surface is frozen for a full minor cycle without unplanned breaks.

### 1.x+ SemVer (core / service / nudojs / parser / lsp)

- **patch**: soundness fixes that do **not** change documented public API shapes; may change inferred types when the old result was wrong (documented as “behavior fix” in the changeset, not API break).
- **minor**: additive APIs, new diagnostic codes, new CLI flags, new optional config keys.
- **major**: removals, renames, signature changes, schema breaks (JSON / dts / CheckJson), default-behavior flips that silence or invent diagnostics.

> Soundness fixes that change *results* without changing *API* ship as **patch** with an explicit changeset note. Consumers who pin exact diagnostic snapshots must re-run goldens on patch upgrades.

## What counts as breaking (Nudo-specific)

Treat as **breaking** (major on 1.x, minor on 0.x):

| Surface | Examples |
|---------|----------|
| Public package exports | Removing a subpath (`@nudojs/cli/evaluator` → `@nudojs/service/evaluator` was a 1.0.0 major) |
| `CheckJson` / `CaseJson` schema | Field removal/rename; `version` bump without dual-read |
| `.d.ts` projection shape | Signature text changes that break `tsc --noEmit` consumers of generated types |
| Diagnostic codes | Renaming codes; removing codes; changing severity of existing codes by default |
| CLI flags / defaults | Removing flags; flipping default `analysis.mode` / `autoBind` / L2 `entry-throws` without a config escape |
| **CLI primary verbs** | Removing `check`/`test`/`contract`/`export`/`health` is **major**. (`env harvest` was removed from the product face — harvest is analysis-internal / env-package tooling.) |
| Directive grammar | Removing `@nudo:*` kinds; changing accepted refine / builder syntax (`T.*` already removed) |
| LSP protocol contracts | Removing `nudo.*` commands or `nudo/…` requests; changing positional CodeLens args |
| Sidecar semantics | Changing binding keys, `@generated` markers, or handwritten-wins rules |

Treat as **non-breaking** (patch/minor):

- New diagnostic codes (opt-in visibility)
- New optional config keys under `package.json#nudo`
- New CLI flags with safe defaults
- Adding `nudo export --format schema` / `--dialect` / `--format standard` (additive)
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
   - 1.x+ package + API/schema break → **major**
   - 1.x+ package + additive → **minor**
   - 1.x+ package + fix/soundness → **patch**
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

### Beta (CI) — `dev` is the beta train

`release.yml` **same workflow file** (npm Trusted Publishing is bound to a workflow filename — a second file cannot publish) runs the `release-beta` job on **`dev` push** with the same `NPM_TOKEN` environment:

1. lint + `test:coverage` (same bar as stable — no untested publishes)
2. If `.changeset/*.md` are pending **and** `.changeset/pre.json` is in pre mode → `changeset version` + push `[skip ci]` version commit
3. `changeset publish` — dist-tag comes from `.changeset/pre.json` (`beta` today); already-published versions are skipped

| Step | Command |
|------|---------|
| Enter beta | `npx changeset pre enter beta` (commit `pre.json`) |
| Land a beta | add changeset → merge/push `dev` → CI versions + publishes `x.y.z-beta.n` under tag `beta` |
| Install beta | `npm i pkg@beta` / `nudojs@beta` |
| Cut stable | `npx changeset pre exit` → merge `dev` → `main` → `release.yml` (stable `latest`) |

VS Code Marketplace / Open VS X / GitHub Release stay on `main` only. Local publish is discouraged (no OIDC); use CI.

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
| Body-slot “implicit shape” obligations removed (C0) | No evidence → `any` / call-site facts. **L1** contracts from `*.nudo.js` / `@nudo:contract` / call sites; **L2** entry may-throw still gates export boundaries |
| Interface tiers | `handwritten` = obligation · `generated` = fact + drift · `implicit` = display only |
| **CLI verbs** | Current product surface: `check` (signatures/gate), `test` (cases), `contract` (print/draft/emit), `export` (`dts|guard|schema|standard|all`), `health`. Flags: `--from`, `test --freeze`, `export --out`, schema `--dialect zod`. |
| Entry display | Unconstrained params = **`any`**; `unknown` = inference failure (not the unconstrained default) |
| L2 entry may-throw | Default **error** on export/entry undigested throws (`nudo:entry-may-throw`). Escape: `--ignore-throws TypeError` / `package.json#nudo.check.ignoreThrows` / `--entry-throws off\|warning`. Does not swallow L1. |

### Directive / contract surface

| Change | Migration |
|--------|-----------|
| **`T.*` directive grammar removed (breaking)** | Use constraint builders (`number()`, `lit(42)`, `shape({...})`, `union(...)`, …) or concrete literals in `@nudo:case` / `@nudo:as` / `@nudo:replace` / `@nudo:mock` / `@nudo:skip`. `parseTypeValueExpr` export removed — use `parseCaseArgExpr`. `serializeCaseArg` emits builders, not `T.*`. |
| `@nudo:case` product role | **Debug / `nudo test` / LSP scenario only.** Contracts live in `*.nudo.js` / `@nudo:contract`. CLI **`test`** prints call-site observations (`call@L…`) and `debug "name"` witnesses — not `Case "…"` as the type product. |
| Class methods / CJS / `export default` sidecar keys | Use `Class.method` (**local declaration name**, not export alias), `Class_method`, nested objects, or local export names — `export { Local as Public }` binds `Local.method`, not `Public.method`. See `design-refine-derivation.md` |
| Contract product name | **`nudo contract`** is the primary verb (print / `--draft` / `--emit`). |

### IDE / agent surface

Inventory: [`packages/lsp/PUBLIC_API.md`](../packages/lsp/PUBLIC_API.md)
(executeCommand dot form, slash-form `nudo/…` protocol contract,
`AGENT_TOOL_SOURCES`, initialize capabilities, CheckJson/CaseJson pointers).
Regression pin: `packages/lsp/src/__tests__/public-api-surface.test.ts`.

| Change | Migration |
|--------|-----------|
| CodeLens is interface-first | Case lenses still work as the debug sub-layer |
| Hover/inlay/tokens share `interfaceTierOf` (A7) | Clients must render new semantic modifiers `contract`/`generated`/`derived` or ignore unknown modifiers |
| Agent tools honor project `autoBind` (E5) | Clients cannot re-enable sidecars when `nudo.contract.autoBind: false` |
| Slash-form `nudo/…` is the protocol contract | Dot-form `nudo.*` remains valid for executeCommand + MCP bridges; do not invent a third spelling |
| Agent executeCommand names | Product names: `nudo.test`, `nudo.contract`, `nudo.contract.draft`, `nudo.contract.emit`; slash-form `nudo/test`, `nudo/contract`, `nudo/contract.draft`, `nudo/contract.emit` |
| CheckJson / CaseJson v1 schema | Field add-only; removals/renames are **major** on 1.x core/service (lsp surfaces them unchanged) |
| Default `analysis.mode=exports` + `diagnostics=default` | Escape hatch `package.json#nudo.analysis.mode`; flipping defaults that invent/silence diagnostics is **major** on 1.x |
| lsp stable line | lsp is already on 1.x+; treat further breaks as **major** and keep [`packages/lsp/PUBLIC_API.md`](../packages/lsp/PUBLIC_API.md) in lockstep. Changeset template mirrors core 1.0 `**BREAKING**:` table |

### env / harvester (B8 coordination)

**Authoritative policy lives in [Ecosystem packages (env / harvester)](#ecosystem-packages-env--harvester) below.** Short form: both packages stay pre-1.0; consumers that need bit-stable IDE/CI analysis pin a minor (`"@nudojs/env": "~0.3.0"`). Harvest is a side channel — handwritten env / project `@nudo:env` wins on overlapping modules/exports (enforced by `mergeHarvestUnderEnv` in `@nudojs/service`). Changing that priority is service-breaking.

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
- `docs/design/refine-derivation.md` — interface tier semantics
- `docs/design/limitations.md` §1.0b — C0.5 optional eval-driven diagnostics (`nudo.analysis.evalMissingSlot`)
- Website: `guides/migrating-js.md` — code-first migration walkthrough
- Website guide: `packages/website/docs/guides/versioning.md`

## Ecosystem packages (env / harvester)

> **Single authority** for `@nudojs/env` / `@nudojs/harvester` policy (P0-B B8).
> Maturity table and the IDE section above only point here.

`@nudojs/env` and `@nudojs/harvester` are **pre-1.0** sidecar packages consumed
by `@nudojs/service` / `nudojs`. They do **not** carry their own SemVer
1.x freeze; service/CLI pin them via workspace/release versions.

| Package | Pin style | When to bump minor | Release-notes suggestion |
|---------|-----------|--------------------|---------------------------|
| `@nudojs/env` | workspace / tilde on 0.x (e.g. `~0.4.0`) for bit-stable CI | New Abs env modules or signature-level APIs that service CLI/tests depend on (e.g. `events` / `stream` / `querystring` slots) | Optional **Coverage** section: `node resolved N/M (leaf-clean=…, unknown=…, mock-required=…)` from `pnpm run coverage:env` / `docs/reports/env-coverage-baseline.json` |
| `@nudojs/harvester` | workspace / tilde on 0.x (e.g. `~0.2.7`) | Harvest result shape changes (`HarvestedEnv.stats`, module key aliases) or emit format changes that break generated `defineEnv` files | Note harvest budget defaults if changed (`maxFiles` / `maxMs`); regenerate CLI harvest samples |

Rules:

- **0.x**: patch = additive env signatures / harvest fixes; minor **may** break
  generated env consumers — always ship a changeset that names the migration.
- **Handwritten `@nudojs/env` wins** over harvest when both supply the same
  module key or the same export name. Analysis injects via
  `mergeHarvestUnderEnv` (`@nudojs/service` `bpath-run.ts`) — harvest only
  fills missing modules/exports. Changing that priority is **breaking** for
  service analysis results → service 1.x **major** on 1.x / minor on 0.x + callout.
- Coverage report numbers are **optional release-notes content**, not a
  soundness gate. Do not promise completeness from resolved-ratio. Prefer
  **leaf-clean** counts over raw resolved counts. CI lint job regenerates
  `docs/reports/env-coverage-baseline.*` and uploads the `env-coverage-baseline`
  artifact.
- `NUDO_HARVEST_NODE=off` and harvest cache helpers (`clearNodeHarvestCache`)
  are public service API surface — treat removals as service 1.x **major**.
- When these packages later cut 1.x, use the same freeze-observation gate as
  lsp — no automatic major from coverage-report growth alone.
- Consumer-facing summary: website `guides/versioning.md` § Ecosystem packages
  (en + zh). This file remains the single long-form authority.
