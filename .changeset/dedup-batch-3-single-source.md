---
"@nudojs/core": minor
"@nudojs/parser": patch
"@nudojs/service": minor
"nudojs": patch
"@nudojs/lsp": patch
"@nudojs/harvester": patch
---

Dedup batch 3 (jscpd + dead-export + doc-drift audit): single-source the
remaining cross-package and in-package copies, remove dead exports, and fix
doc drift.

Single-sourcing (comment-pinned manual-sync pairs now share one
implementation):

- env WHATWG globals: new `env/src/whatwg.ts` shared factory consumed by both
  `node.ts` and `web.ts` (Headers/FormData/URLPattern/Blob/stream
  readers/writers/DisposableStack family). Byte-identical parity verified via
  before/after brand-slot dumps; intentionally divergent declarations
  (Request/Response/fetch/…, see whatwg.ts header) stay per-env with pointer
  comments.
- atomic writes: new `@nudojs/service` `writeFileAtomic` (randomBytes tmp
  suffix) replaces 6 hand-copied variants across lsp/nudojs (contract-emit,
  migrate) / service (emit ×2, disk-cache).
- analyzer-diagnostics → CheckIssue mapping: core
  `checkIssuesFromDiagnostics` (+`AnalyzerDiagnosticLike`) via
  `@nudojs/core/internal`; nudojs keeps a `domainIssuesFromDiagnostics`
  alias, lsp `agent-tools` drops its copy (Bug 632/1038 drift class closed).
- ESM AST detection: core `isEsmProgram` exported via internal; service
  `abs-modules-graph` deletes its verbatim copy.
- dependency collection: core `collectDependencySpecsWithMode` (import/require
  mode labels, Bug 238) replaces service's `importSpecs`/`collectRequireSpecs`
  copy; `collectDependencySpecs` stays a thin shell.
- string-aware scan skeleton: core `text-scan` grows `findTopLevelChar` /
  `walkTopLevelChars` primitives; parser `findReplaceSeparator` /
  `literalNestingDepth` / `outerParensWrapAll` / `findTrailingCommentStart`
  consume them (Bug 1009 copy-drift class).
- core arithmetic: bigint mixed-operand tail shared via coerce.ts helpers
  (Bug 946 matrix re-verified); sub/mul/div/mod numeric tail shared via
  `arithmetic/shared.ts` `numericOpTail`; AST walk skeleton unified in
  `algebra/ast-walk.ts` (skip-key differences parameterized);
  `errorTypeAbs` leaf module (`algebra/error-type-abs.ts`) breaks the fake
  cycle that forced `super-access.ts` to keep a copy; brand slot reads shared
  via `builtins/brand-slot.ts`.
- harvester: `dts-contract-draft` memberKey delegates to exported
  `computedMemberName`.
- LSP stdio framing: shared `scripts/lib/lsp-framing.mjs` frame reader for
  both smoke scripts.

Dead exports removed (zero product consumers): `bodyReadFieldsFor`
(service-emit), `paramName` (parser ast-guards), `loadHarvestEnvFromDisk` /
`harvestToAbsModules` / `summarizeNodeEnv` (harvester), plus `streamOptions`
dead block in env node.ts; service-emit
barrel narrowed to externally-consumed symbols (16 removals, api docs
regenerated en+zh). `generateDts` stays exported (cross-package test use).

Docs: `api/harvester.md` (en+zh) no longer claims `autoHarvestModules` /
`harvestNodeTypes` are exported from `@nudojs/service` (they live in
`@nudojs/harvester`).
