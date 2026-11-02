---
"@nudojs/core": minor
"@nudojs/service": minor
"@nudojs/harvester": minor
"nudojs": minor
"@nudojs/lsp": minor
"vite-plugin-nudo": minor
---

Dedup / fail-closed / dead-code batch (repo-wide review): single-source the
cross-face copies and stop folding read errors into silent misses.

- **Cross-face single sources** (previously hand-synced copies that had already
  drifted): eval injection assembly (`buildEvalInjection` in `@nudojs/service`;
  CLI check/migrate/health, LSP agent tools, and vite-plugin all consume it —
  the `health` copy still used the object-spread env merge that Bug 1037 fixed
  everywhere else, hand-rolled env absolutization, and dropped
  `mockFromErrors`); `parseIgnoreThrows`/`configIgnoreThrows` (service; CLI /
  LSP / vite-plugin); `CHECK_FACE_DIAG_CODES` and `CHECK_ISSUE_OPTIONAL_KEYS`
  (`@nudojs/core/internal`); `normalizeRealPath` (service; replaces 6
  realpath-fallback micro-copies with two divergent identity-key 口径);
  `Object.prototype` name list now derived instead of hand-synced;
  `normalizeModulePath`/`externalAbsCallRecords`/`stripIssuesByCode` shared
  within the CLI package.
- **Fail-closed fixes** (read errors no longer fold into "miss"): harvester
  disk cache fingerprint carries a `readerr:` sentinel and skips the disk
  layer when a dts closure read fails; transient harvest failures are no
  longer pinned as `null` in the process cache; unreadable dts entries count
  into `stats.skipped`; `nudo migrate` enumeration surfaces non-ENOENT
  failures instead of silently skipping (a chmod-000 package could silently
  vanish from `retire --all`); `nudo export --out` refuses to overwrite an
  existing target it cannot read (EISDIR still routes to the write-failure
  channel, which cannot clobber); LSP sidecar read failures surface as
  structured `nudo:path-io` path errors instead of "no sidecar"; core's
  same-file contract-face resolver notes engine exceptions
  (`nudo:internal`) instead of silently memoizing "no contract face".
- **Removed zero-consumer aliases** (no production consumers in-repo or in
  the published docs matrix): `transpile` (use `transpileSource`) from
  `@nudojs/core`, `generateGuardFunction` (use
  `generateGuardFunctionFromAbs`) from `@nudojs/service/emit`,
  `maybeLeak`/`leakIfNeeded`/`resetLeakCounter` from `@nudojs/core/internal`.
- **Behavior notes**: `nudo health` now merges env modules via
  `mergeHarvestUnderEnv` (same-name env+harvest packages keep harvest's
  non-conflicting exports) and can fail red on error-level mock-load
  problems; the check face may surface `nudo:internal` info issues for
  engine exceptions that were previously swallowed.
- **Internal refactors, byte-identical output**: class-emit / computed-key
  assignment / destructure emitters deduplicated via shared helpers (verified
  by a 56-corpus byte-diff plus the pinned emission suites);
  `analyzeFileUncachedInner` module-issue mapping is table-driven; `runHealth`
  split into print/json helpers.
