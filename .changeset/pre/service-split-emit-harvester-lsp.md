---
"@nudojs/service": major
"@nudojs/harvester": major
"@nudojs/lsp": major
"nudojs": patch
---

Split the `@nudojs/service` god package: harvest → `@nudojs/harvester`, IDE surface → `@nudojs/lsp`, emit products consolidated under `@nudojs/service/emit`.

**BREAKING** for `@nudojs/service` subpath consumers:

| Removed subpath | Migrate to |
|---|---|
| `@nudojs/service/interface` | `@nudojs/service/emit` |
| `@nudojs/service/dts` | `@nudojs/service/emit` |
| `@nudojs/service/case` | `@nudojs/service/emit` |
| `@nudojs/service/lsp` | `@nudojs/lsp` (library entry — no server side effects) |
| `@nudojs/service/harvest` | `@nudojs/harvester` |

`@nudojs/service` keeps `.`, `./analysis`, `./evaluator`, `./emit`. The language server moves to `@nudojs/lsp/server` (bin `nudo-lsp` unchanged); `@nudojs/lsp` is now a side-effect-free library entry re-exporting the IDE surface.

No dependency cycles: `lsp → service`, `harvester` stays independent of `service`. Emit is a service subpath (same package). Public function signatures and diagnostic codes are unchanged.
