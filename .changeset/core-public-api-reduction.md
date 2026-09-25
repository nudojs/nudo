---
"@nudojs/core": major
---

Reduce `@nudojs/core` public export surface (breaking).

Engine machinery is no longer re-exported from `.` or `./exec`. Hosts that
need leak/call-budget/hash/derivation/inlay/template/language/scan extras or
may-throw · member-diag collectors import `@nudojs/core/internal` instead.

- `@nudojs/core` (`.`) keeps the product face only (Abs, check, format,
  projections, contract builders, B-path `$op` runtime + transpile).
- New subpath `@nudojs/core/internal` (minor-escape hatch; no SemVer promise).
- `packages/core/PUBLIC_API.md` + `public-api.snapshot.json` updated; freeze
  test also asserts product face does not leak internal names.

Product CLI faces (`check` / `test` / `contract` / `export` / `health`) are
unchanged. `@nudojs/service` / `@nudojs/lsp` already retargeted.
