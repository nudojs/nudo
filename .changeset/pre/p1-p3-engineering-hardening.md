---
"@nudojs/cli": minor
"@nudojs/core": patch
"@nudojs/parser": minor
"@nudojs/service": minor
"@nudojs/lsp": minor
"vite-plugin-nudo": patch
"nudojs": patch
---

P1–P3 engineering hardening (review follow-ups) — no product-face breaks

- **@nudojs/parser**: export typed Babel AST narrowers (`ast-guards.ts`); service `analyzer-ast` / lsp `symbols` no longer use `as any` on nodes.
- **@nudojs/cli**: extract pure decision modules (`check-gate-config`, `check-json-map`, `check-ci-flags`, `export-format`) and cover them with in-process unit tests; per-package coverage floors raised.
- **@nudojs/service**: host cache-invalidation contract documented (`docs/design/cache-invalidation.md`) + C1–C8 regression tests; LSP targeted eviction now clears path-env and abs-module cache for changed deps.
- **@nudojs/lsp**: `server.ts` split into watch/commands/navigation/code-actions/ide modules (public API unchanged); path-env clear on dependent eviction.
- **@nudojs/service**: `interface-derivation` / `analyzer-orchestrate` split into cohesion modules with stable facades.
- Docs: trust-boundary note in Quick Start, version narrative consistency, env mock-boundary checklist, CheckJson `actions[]` field table.
- vite-plugin: named `logAnalysisSummary` helper (logging surface unchanged).
