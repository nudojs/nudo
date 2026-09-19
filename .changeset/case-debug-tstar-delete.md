---
"@nudojs/parser": major
"@nudojs/service": major
"@nudojs/cli": major
"@nudojs/lsp": major
"@nudojs/core": minor
---

Align product surface with interface-first design: `@nudo:case` is debug / `nudo test` only, and the `T.*` directive grammar is removed.

- Directive type expressions accept constraint builders (`number()`, `lit()`, `shape()`, `union()`, `array()`, `any()`, …) and concrete literals only. Bare `T.*` parses as unknown; `parseTypeValueExpr` is no longer exported — use `parseCaseArgExpr`.
- `serializeCaseArg` / `--emit-cases` emit builders (`number()`, `union(…)`) instead of `T.*`.
- LSP `typeExprToDirective` emits builders (`number()`, `union(…)`, `any()`).
- CLI `infer` reports call-site facts (`call@L…`) and `debug "name"` witnesses with `Observed:` joins — not `Case "…"` / `Combined:` as the type product. Contracts stay on `*.nudo.js` / `@nudo:refine`.
- Constraint builders accept concrete nested literals so directive grammar round-trips.
