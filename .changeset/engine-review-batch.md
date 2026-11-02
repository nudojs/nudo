---
"@nudojs/core": minor
"@nudojs/service": minor
---

Engine review batch (evaluation-engine design audit; 3 concurrent domains,
behavior-preserving except where noted). Full suite green (2113 files /
16579 tests), `verify:examples` 251 checks green, build + lint + lint:tests
clean, `public-api-freeze` green (internal face +1: `isAbsLike`).

core transpile:
- Per-unit emit state: the five module-level mutable counters/stacks in
  `stmt/statement.ts` (`switchBodySeq` / `switchBreakSeq` /
  `curSwitchBreakLabel` / `forInRecvSeq` / `forLoopVarSeq`) moved into
  `TranspileOptions.stmtEmit` (`StmtEmitState`), created fresh per
  transpile unit. Fixes cross-unit counter bleed: transpiling the same
  source twice in one process now yields byte-identical output (was 5/6
  samples drifting on second pass). Single-module first-transpile output
  byte-identical vs HEAD (6-sample corpus, `cmp` clean; `__nudoLv*` /
  `__nudoSw*` / `__fir*` / `__swBody*` base names unchanged).
- PrivateName key extraction unified: new `privateNameKeyOf` (bare `#name`
  or null) is the single extraction point; `privateNameKeySrc` builds on
  it. The three inlined copies (`expr/call.ts`, `expr/optional-chain.ts`,
  `class-emit.ts` `keyOf`) now call it. The dead `|| undefined` branch in
  optional-chain (`#${… ?? ""}` is always truthy) deleted.
- `transpile/stmt-predicates.ts` → `transpile/stmt/predicates.ts`
  (statement-domain file now lives under `stmt/`).
- `userIdentCache`: whole-table clear at 64 → `BoundedLruMap(64)`.

core runtime:
- `isAbsLike` (shape+conf) added to `abs.ts`, exported via
  `@nudojs/core/internal`; DEC-006 fail-closed fallback table documented
  at the definition. ~40 inline `"shape" in …` guards across exec/**
  replaced (branch bodies and fallbacks verbatim); `check-may-throw.ts`'s
  local `isAbsVal` re-definition now aliases it. Behavior delta (bugfix):
  host objects that merely carry a `shape` data property are no longer
  misdetected as Abs values — they now take the host branch as DEC-006
  intends. The one inline check inside `run.ts:712` generated-code string
  is intentionally kept (not a TS-surface check; changing it would alter
  the runtime injection face).
- Collector dual-track residue closed: `yieldStack` / `genPathSensitive`
  / `genJoinOverride` (`runtime/control.ts`) and `callLocStack` /
  `absOrigins` (`member-diag.ts`) migrated to `createScopedSlot` +
  `registerCollectorScopeParticipant`; module-global fallback behavior
  unchanged (generator evaluation is synchronous, push/pop paired).
- `$assumeAnchor` (≈80 lines) moved out of `runtime/ops.ts` into
  `runtime/assume.ts`; ops.ts back to pure arithmetic delegation.
  Export surface unchanged.
- `runtime/containers.ts` is a pure re-export barrel again: the five
  isomorphic guard wrappers (`$idx`/`$idxSet`/`$get`/`$set`/
  `$iterCheck`) collapsed into `guarded-entry.ts`'s `guardedEntry`
  factory (BUG-173 this-access gate / BUG-217 accessor split / BUG-215
  iterator-slot guard moved verbatim).

service:
- Three hand-rolled LRU caches (`analysis-file-cache.ts`,
  `fn-analysis-cache.ts`, eval-run's `evalRunByFile`) replaced with
  `BoundedLruMap`; the three "matches BoundedLruMap.set" sync comments
  deleted. Key semantics (stablePathKey / fn-cache prefix / file×mode
  slot keys) unchanged.
- Dead dual-engine capability flag removed: `absModulesOk` (constant
  true since the single-engine merge) deleted from
  `analyzer-abs-eval.ts` and the `@nudojs/service` export face; its four
  call sites constant-folded. **This is the only public-API removal in
  this batch.**
- Parallel assembly sequences unified: `buildEvalInjection`'s
  graph-assembly segment (the historical 5→2 leftover) now parameterizes
  and calls `composeEvalModules`; the real differences (mock seeds enter
  the graph on the analyzer face vs runtime injection on the inject
  face, fileDirectives vs from-source, structured `mockModuleErrors`)
  are explicit parameters. Deep-structure probe diff vs HEAD: zero.
- `eval-run.ts` (922 lines) split: env/harvest merging → `env-modules.ts`
  (pure data face), eval LRU + fingerprints → `eval-cache.ts`; eval-run
  keeps `tryRunEval`/`tryEvalCall*`/cjs dispatch + re-exports. Public
  face unchanged (no package imports eval-run directly outside service).
- Mock fingerprint write-side single source: `mockFingerprint(kind,
  payload)` factory in `mock-abs.ts`; all five stamping sites go through
  it, seed-fn entries now stamped too; the reader (`absSeedPart`)
  consumes `impl.fingerprint` only (single `"nofp"` marker when absent,
  no format-string reconstruction). Cache keys change once (harmless
  miss).
