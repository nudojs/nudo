---
"@nudojs/core": minor
"@nudojs/parser": minor
"@nudojs/service": minor
"@nudojs/harvester": minor
"@nudojs/lsp": minor
"nudojs": minor
---

security: AST whitelist for `@nudo:case`/`@nudo:as` type expressions (RCE block); correctness: tuple rest across leq/widen/runtime/projections, `x++`/`x--` constraint propagation, `-0`/`0` key channels, prototype-chain own-property reads, health/migrate gate unification, parser directive diagnostics, session cache limits + transitive content fingerprints; design: projection budget (cycle/depth), sidecar identity/export-name decoupling with safe alias bindings.
