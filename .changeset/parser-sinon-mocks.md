---
"@nudojs/parser": minor
---

Improve `@nudo:mock` parsing for sinon-style stubs and share parse/strip with core.

- Support `stub().onFirstCall()`, `stub().callsFake(fn)`, and `sinon.`-prefixed chains as the same MockHelper shape TypeValue/Abs already consume.
- Drop the unused `ReturnsDirective` / `@nudo:returns` directive type (contracts use `@nudo:refine`).
- `parse()` now strips types unconditionally via core `parseSource` (shared AST cache).
