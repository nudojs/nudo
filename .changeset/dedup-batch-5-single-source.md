---
"@nudojs/core": minor
"@nudojs/parser": patch
"@nudojs/service": patch
"@nudojs/lsp": patch
"nudojs": patch
---

Dedup batch 5 (jscpd `--min-tokens 70` audit of code-level clones; website
EN↔zh mirrors and CHANGELOGs excluded as mechanism products): close the four
remaining comment-pinned manual-sync obligations and the seven whole-function
twins. Pure refactor — outputs byte-identical (vitest --changed 16815 passed,
verify:examples 251 checks, lint + lint:tests clean).

Comment-confessed sync pairs now single-sourced:

- transpile `stmt/statement.ts` yield try-context bits (raw `1|4|8` / `& 2` /
  `~(16|32|64)` literals pinned by a "钉死同步" comment to runtime
  `control.ts` YIELD_* constants) → new zero-dependency leaf
  `exec/yield-bits.ts`; runtime (`control.ts` re-export removed, `async.ts`)
  and transpile (`statement.ts`) both import the named constants.
- parser `case-arg.ts` `TYPE_EXPR_CHAIN_METHODS` hand-maintained chain-method
  whitelist ("须与 core makeBuilder 同步") → core exports
  `CONSTRAINT_CHAIN_METHOD_NAMES` (public barrel, next to
  `CONSTRAINT_BUILDER_NAMES`); parity pinned by
  `constraint-chain-methods.test.ts` (method-face drift ⇒ CI red).
- service `builtin-prototype.ts` `BUILTIN_ERROR_CLASSES` verbatim 8-name copy
  of core `ERROR_CTOR_NAMES` → imported via `@nudojs/core/internal` (the dead
  module-level re-export is removed; no public face change).
- core `promise.ts` `aggregateErrorAbs` local error-brand construction (cycle:
  error-family.ts imports promise.ts, so no direct import) stays local but is
  now drift-gated in `eval-bug-293-promise-combinator-settle.test.ts`
  (slot-key set / non-enumerable flags / inherited name vs `errorBrandAbs`).

Whole-function twins single-sourced:

- core `builtins/error/binary.ts` `makeArrayBufferAbs` /
  `makeSharedArrayBufferAbs` → parameterized `makeBufferAbs` (brand name,
  resizable/growable slot key, diagnostic labels; slot insertion order
  preserved).
- core `transpile/member-path.ts` `memberWriteIfe` / `memberWriteRootIfe` →
  shared `memberWriteIfeImpl` (only real difference: return written value vs
  new root).
- nudojs `version.ts` three walk-up-to-package.json loops →
  `findPkgDirUpwards` + `readVersionAt`.
- nudojs `migrate.ts` `planWorkflowRewrites` → delegates to
  `planWorkflowRewritesIn(findWorkflowDir(from))`; `readPackageJsonDetailed` /
  `readMarkerFile` → shared `readJsonObjectDetailed(path, label)` (missing /
  invalid / unreadable / ok grading unchanged).
- service `emit/quickfix-edits.ts` `sidecarClearsEntryThrow` /
  `sidecarClearsConstraintViolation` → shared `sidecarClearsDiags(input,
  codes)` (Bug 556 dual-code gate preserved).
- core `generalize.ts` `ctorParamCountOf` / `ctorFormalsOf` twin class-ctor
  walkers → single `ctorParamNodesOf` walker (Bug 1031 null-declaration skip
  lives once; count still raw param length, formals still
  `formalParamsFromNodes` — the `this`-param skip semantics unchanged).
- lsp `server-commands.ts` `handleSelectCase` / `handleSelectContract`
  ~20-line resolve→read→caseTargets→knownFunctionNames preamble →
  `resolveCaseTarget` (error strings byte-identical).
