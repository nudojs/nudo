---
"@nudojs/core": patch
---

Refactor: engine review follow-up — file reorganization and naming hygiene, zero behavior change.

- transpile: rename `emitArrMutatorRebinds` (historical name; array-mutator / defineProperty / delete rebinds have all moved off the statement pass — `$invoke` in-place mutation under Bug 49/51, expression-position self-contained IIFEs) to `emitStmtWritebackRebinds`; its sole remaining duty is the Bug 96 statement-position RegExp state write-back (`$reStateCall`). Split `transpile/helpers.ts` (2016 lines) into domain leaf files under `transpile/helper/` behind the unchanged `helpers.ts` facade barrel (all existing import paths keep working).
- class: split `class/declare.ts` into definition-time (`$class` spec + registration) and construction/lookup-time (`$new` / `constructClass` / `findMethod` family) modules; lift the ten duplicated `validateCallableArg(args[0], …)` preflight checks in `invoke-arr.ts` callback-family methods into one shared wrapper with byte-identical diagnostics; fix the stale `registerClassDecl` reference in the class-registry header comment (current names: `$class` / `registerEvalClass`).
- runtime: extract the brand static tables (`BUILTIN_BRAND_METHODS`, typed-array / iterable / accessor tables, proto brand key faces) from `runtime/members.ts` into `runtime/brand-tables.ts` with re-exports preserving the import face.
- deprecations: `registerEvalClass` on the public face is marked `@deprecated` — the registry is internal machinery (core consumers import `exec/class-registry.ts` directly); the public export is retained for compatibility only.
- docs: kernel-merge.md collector-scope table — classify the synchronous save/restore-paired flags `awaitUnsettledHit` and `loopSignalFromAbstractArm` under the retained row (finally-restored before any await window, no cross-analysis leak).
