---
"@nudojs/core": minor
"@nudojs/parser": minor
"@nudojs/service": minor
"nudojs": minor
"@nudojs/lsp": patch
"@nudojs/env": patch
"@nudojs/harvester": patch
"vite-plugin-nudo": patch
---

fix: repository-scale bug hunt — algebra, CLI, IDE, cache, release hardening

Correctness (core algebra / check):
- `Symbol() < 1` now TypeError (cmp relational ops); `eq`/`ne` unchanged
- bare prim contracts reject obj/arr/tuple/fn/brand/eff returns
- `lit(undefined)` is a real literal (`LitValueResult {ok,value}` tagged path)
- empty-sum reduce guards (DEC-006); explicit re-exports win over `export *`
- projection fidelity: tuple holes, tuple-rest parens, schema eq-app anchoring

Design refactors (additive public API):
- `LitValueResult` + bigint in `LiteralValue`
- `AbsApplyResult {abs,throws}` + `callTranspiledExportApply` (sole wrap point) + `$call` throws routing
- `directive-scan` single-source extractors; directives bind AST nearest Function (nested/class/object methods)
- `stablePathKey` / `stablePathKeyGraph` for L0/LSP/CLI/disk path identity

Product / CLI / migrate:
- `check --json` path errors enter the CheckJson envelope (`pathErrors`, `ok:false`); ok↔exit single source
- migrate: missing paths error (no parent `package.json` fallthrough); retire is atomic with rollback; rewritten paths are single-quoted
- malformed directives warn instead of silent drop; `@nudo:skip` requires explicit types

Service / cache:
- disk-cache atomic write + portable path keys (incl. maxForks in cache key)
- pure memo replays may-throw; bounded memo maps; sidecar EACCES ≠ missing

IDE / extension:
- LSP path-key unify (Windows drive forms); directive diag watermark; hover follows G2 scope
- VS Code client catches start/sendRequest; selectCase rollback

Release / CI supply chain:
- `gen-llms` confines slug writes under build root (path-escape fix)
- gate-major: 2.x / major jumps / first 1.0.0 need `confirm_major`; 1.x train auto-publishes
- release: quoted secrets, tag whitelist + semver precedence incl. prerelease, pinned website actions
