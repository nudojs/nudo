---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.15.0 |
| `@nudojs/service` | 1.9.0 |
| `nudojs (CLI)` | 1.6.0 |
| `@nudojs/parser` | 1.5.0 |
| `@nudojs/lsp` | 1.7.0 |
| `@nudojs/env` | 0.5.0 |
| `@nudojs/harvester` | 0.4.0 |
| `vite-plugin-nudo` | 0.5.0 |
| `nudo-vscode` | 0.3.48 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.15.0 {#pkg-core}

## 1.15.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- aae0f96: Fix stale-cache windows in cache keys and session eviction. `nodeHarvestCacheKey`
  floored `mtimeMs` to whole seconds (same-second, same-size rewrites of
  `@types/node` reused a stale harvest — now uses the raw float mtime, matching
  the repo-wide `mtimeMs+size` strict-equality contract). The path-env cache
  key/validation only compared `mtimeMs` (coarse-mtime filesystems could keep
  serving a stale `defineEnv` factory and re-register it, self-perpetuating — now
  `mtimeMs+size`, and the direct-import URL query carries `size` so the ESM
  module cache can't replay old content). The path-env fallback copy filename
  hashed only `path:mtime` — rewritten content now hashes into the filename so a
  changed file gets a new URL and the ESM cache invalidates naturally. Harvest
  caches (`harvestCache`, node not-found cache) had no production eviction —
  `clearAnalysisSessionCaches()` now clears both, so `pnpm install` / watcher
  rounds see upgraded or newly installed `@types` without a process restart.
  `checkMemoKey` now normalizes `filePath` via `stablePathKey` (same file no
  longer occupies two entries under different path shapes).
- 1ccff57: Fix unsound strict numeric endpoints under IEEE rounding. Strict bounds
  (`gt`/`lt`) synthesized by endpoint arithmetic (add/sub/mul/div, linear
  interval propagation) could round *inward* past the true infimum/supremum and
  produce false proofs — e.g. `x >= 1 && y > 1e-16` proved `x + y > 1` while
  `f(1, 1.05e-16)` returns exactly `1` in IEEE arithmetic. Strict endpoints are
  now calibrated with a float-discreteness witness (`x > a ⟺ x ≥ nextUp(a)`):
  when the witness result collides with the endpoint, the bound steps one ulp
  outward (`gt(nextDown(E)) ⟺ ge(E)`), so `x > 0 ⟹ x + 1 > 1` now correctly
  reports `> 0.9999999999999999`. Non-strict bounds are unaffected (fl
  monotonicity). Also: `gt(x, NaN)` (a vacuously-false predicate from `0/0`
  literals) is no longer collected as a numeric bound endpoint, matching the
  existing NaN exclusion semantics. Contracts that relied on the old false
  strict bounds (e.g. the `interface-derivation` example's `x>0 ⟹ x+4>4`) now
  correctly fail — the example and docs were updated to sound forms
  (`ge(0) ⟹ ge(4)`).

更早版本（51）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.9.0 {#pkg-service}

## 1.9.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- aae0f96: Fix stale-cache windows in cache keys and session eviction. `nodeHarvestCacheKey`
  floored `mtimeMs` to whole seconds (same-second, same-size rewrites of
  `@types/node` reused a stale harvest — now uses the raw float mtime, matching
  the repo-wide `mtimeMs+size` strict-equality contract). The path-env cache
  key/validation only compared `mtimeMs` (coarse-mtime filesystems could keep
  serving a stale `defineEnv` factory and re-register it, self-perpetuating — now
  `mtimeMs+size`, and the direct-import URL query carries `size` so the ESM
  module cache can't replay old content). The path-env fallback copy filename
  hashed only `path:mtime` — rewritten content now hashes into the filename so a
  changed file gets a new URL and the ESM cache invalidates naturally. Harvest
  caches (`harvestCache`, node not-found cache) had no production eviction —
  `clearAnalysisSessionCaches()` now clears both, so `pnpm install` / watcher
  rounds see upgraded or newly installed `@types` without a process restart.
  `checkMemoKey` now normalizes `filePath` via `stablePathKey` (same file no
  longer occupies two entries under different path shapes).
- 52de5ca: Classify fs "miss" vs "read failure" everywhere. Replaced every
  `existsSync(p) && statSync(p)` double call (TOCTOU race + errno swallowing)
  with a single `statSync(p, { throwIfNoEntry: false })` per the repo's
  load-module convention: ENOENT stays a silent miss, EACCES/EIO surface via the
  site's error channel (top-level catch, `reports.push({error})`, exit-1
  message, or a logged warning) instead of masquerading as "file absent".
  Read-failure catches now branch on `e.code`: sidecar contracts unreadable for
  reasons other than ENOENT print a `warning: cannot read sidecar contract …`
  in `check`/`check --fix` (no more silent contract-blind green runs);
  `@nudo:mock` seed evaluation failures warn in `export` before degrading;
  `pnpm-workspace.yaml` read failures other than ENOENT abort `migrate` (a
  snapshot/read failure no longer disguises the file as "other" and skips
  rollback); mock files that exist but can't be read report `read-failed` with
  the errno instead of the misleading "Mock file not found"; npm entry
  probes and LSP module-candidate stats log persistent failures instead of
  degrading a package's export face to unknown or silently breaking
  go-to-definition; `contract --from-dts` path-like arguments that don't exist
  now error as `path not found` instead of being treated as npm package names
  ending in a misleading `no .d.ts files found`.
- Updated dependencies [aae0f96]
- Updated dependencies [52de5ca]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/harvester@0.4.0
  - @nudojs/parser@1.5.0
  - @nudojs/env@0.5.0

更早版本（53）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.6.0 {#pkg-nudojs}

## 1.6.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- 52de5ca: Classify fs "miss" vs "read failure" everywhere. Replaced every
  `existsSync(p) && statSync(p)` double call (TOCTOU race + errno swallowing)
  with a single `statSync(p, { throwIfNoEntry: false })` per the repo's
  load-module convention: ENOENT stays a silent miss, EACCES/EIO surface via the
  site's error channel (top-level catch, `reports.push({error})`, exit-1
  message, or a logged warning) instead of masquerading as "file absent".
  Read-failure catches now branch on `e.code`: sidecar contracts unreadable for
  reasons other than ENOENT print a `warning: cannot read sidecar contract …`
  in `check`/`check --fix` (no more silent contract-blind green runs);
  `@nudo:mock` seed evaluation failures warn in `export` before degrading;
  `pnpm-workspace.yaml` read failures other than ENOENT abort `migrate` (a
  snapshot/read failure no longer disguises the file as "other" and skips
  rollback); mock files that exist but can't be read report `read-failed` with
  the errno instead of the misleading "Mock file not found"; npm entry
  probes and LSP module-candidate stats log persistent failures instead of
  degrading a package's export face to unknown or silently breaking
  go-to-definition; `contract --from-dts` path-like arguments that don't exist
  now error as `path not found` instead of being treated as npm package names
  ending in a misleading `no .d.ts files found`.
- 9a3d6e7: Stop silently swallowing business-Promise failures. `nudo check/test --watch`
  incremental rounds died silently when the round body threw outside the
  per-file try (`buildModuleGraph` / `evictForDependents` / `topoSortDirty`) —
  the screen just froze on the previous round's results; the error is now
  printed (`nudo <label> incremental failed: …`), mirroring the existing
  first-round BUG-023 handling. In the LSP server, `validateDocument` (didOpen /
  didChange debounce) and `handleNudoDepFileChanged` (didOpen / didChange /
  watched-files) rejections were discarded with an empty catch — a file throwing
  in the analyzer produced no diagnostics and no trace, forever; failures are
  now logged to stderr as `[nudo-lsp] …` lines. Best-effort client capability
  requests (`DiagnosticRefresh` / `CodeLensRefresh` / inlay-hint refresh) keep
  their intentional silent catch.
- Updated dependencies [aae0f96]
- Updated dependencies [52de5ca]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/service@1.9.0
  - @nudojs/harvester@0.4.0
  - @nudojs/parser@1.5.0
  - @nudojs/env@0.5.0

更早版本（50）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.0 {#pkg-parser}

## 1.5.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- Updated dependencies [aae0f96]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0

更早版本（50）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.7.0 {#pkg-lsp}

## 1.7.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- 52de5ca: Classify fs "miss" vs "read failure" everywhere. Replaced every
  `existsSync(p) && statSync(p)` double call (TOCTOU race + errno swallowing)
  with a single `statSync(p, { throwIfNoEntry: false })` per the repo's
  load-module convention: ENOENT stays a silent miss, EACCES/EIO surface via the
  site's error channel (top-level catch, `reports.push({error})`, exit-1
  message, or a logged warning) instead of masquerading as "file absent".
  Read-failure catches now branch on `e.code`: sidecar contracts unreadable for
  reasons other than ENOENT print a `warning: cannot read sidecar contract …`
  in `check`/`check --fix` (no more silent contract-blind green runs);
  `@nudo:mock` seed evaluation failures warn in `export` before degrading;
  `pnpm-workspace.yaml` read failures other than ENOENT abort `migrate` (a
  snapshot/read failure no longer disguises the file as "other" and skips
  rollback); mock files that exist but can't be read report `read-failed` with
  the errno instead of the misleading "Mock file not found"; npm entry
  probes and LSP module-candidate stats log persistent failures instead of
  degrading a package's export face to unknown or silently breaking
  go-to-definition; `contract --from-dts` path-like arguments that don't exist
  now error as `path not found` instead of being treated as npm package names
  ending in a misleading `no .d.ts files found`.
- 9a3d6e7: Stop silently swallowing business-Promise failures. `nudo check/test --watch`
  incremental rounds died silently when the round body threw outside the
  per-file try (`buildModuleGraph` / `evictForDependents` / `topoSortDirty`) —
  the screen just froze on the previous round's results; the error is now
  printed (`nudo <label> incremental failed: …`), mirroring the existing
  first-round BUG-023 handling. In the LSP server, `validateDocument` (didOpen /
  didChange debounce) and `handleNudoDepFileChanged` (didOpen / didChange /
  watched-files) rejections were discarded with an empty catch — a file throwing
  in the analyzer produced no diagnostics and no trace, forever; failures are
  now logged to stderr as `[nudo-lsp] …` lines. Best-effort client capability
  requests (`DiagnosticRefresh` / `CodeLensRefresh` / inlay-hint refresh) keep
  their intentional silent catch.
- Updated dependencies [aae0f96]
- Updated dependencies [52de5ca]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/service@1.9.0
  - @nudojs/parser@1.5.0

更早版本（54）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.0 {#pkg-env}

## 0.5.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- Updated dependencies [aae0f96]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0

更早版本（50）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.4.0 {#pkg-harvester}

## 0.4.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- aae0f96: Fix stale-cache windows in cache keys and session eviction. `nodeHarvestCacheKey`
  floored `mtimeMs` to whole seconds (same-second, same-size rewrites of
  `@types/node` reused a stale harvest — now uses the raw float mtime, matching
  the repo-wide `mtimeMs+size` strict-equality contract). The path-env cache
  key/validation only compared `mtimeMs` (coarse-mtime filesystems could keep
  serving a stale `defineEnv` factory and re-register it, self-perpetuating — now
  `mtimeMs+size`, and the direct-import URL query carries `size` so the ESM
  module cache can't replay old content). The path-env fallback copy filename
  hashed only `path:mtime` — rewritten content now hashes into the filename so a
  changed file gets a new URL and the ESM cache invalidates naturally. Harvest
  caches (`harvestCache`, node not-found cache) had no production eviction —
  `clearAnalysisSessionCaches()` now clears both, so `pnpm install` / watcher
  rounds see upgraded or newly installed `@types` without a process restart.
  `checkMemoKey` now normalizes `filePath` via `stablePathKey` (same file no
  longer occupies two entries under different path shapes).
- 52de5ca: Classify fs "miss" vs "read failure" everywhere. Replaced every
  `existsSync(p) && statSync(p)` double call (TOCTOU race + errno swallowing)
  with a single `statSync(p, { throwIfNoEntry: false })` per the repo's
  load-module convention: ENOENT stays a silent miss, EACCES/EIO surface via the
  site's error channel (top-level catch, `reports.push({error})`, exit-1
  message, or a logged warning) instead of masquerading as "file absent".
  Read-failure catches now branch on `e.code`: sidecar contracts unreadable for
  reasons other than ENOENT print a `warning: cannot read sidecar contract …`
  in `check`/`check --fix` (no more silent contract-blind green runs);
  `@nudo:mock` seed evaluation failures warn in `export` before degrading;
  `pnpm-workspace.yaml` read failures other than ENOENT abort `migrate` (a
  snapshot/read failure no longer disguises the file as "other" and skips
  rollback); mock files that exist but can't be read report `read-failed` with
  the errno instead of the misleading "Mock file not found"; npm entry
  probes and LSP module-candidate stats log persistent failures instead of
  degrading a package's export face to unknown or silently breaking
  go-to-definition; `contract --from-dts` path-like arguments that don't exist
  now error as `path not found` instead of being treated as npm package names
  ending in a misleading `no .d.ts files found`.
- Updated dependencies [aae0f96]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/parser@1.5.0
  - @nudojs/env@0.5.0

更早版本（50）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.5.0 {#pkg-vite-plugin}

## 0.5.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- Updated dependencies [aae0f96]
- Updated dependencies [52de5ca]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/service@1.9.0

更早版本（53）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
