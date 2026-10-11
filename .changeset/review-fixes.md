---
"@nudojs/core": patch
"@nudojs/service": patch
"@nudojs/lsp": patch
---

fix: review hardening — Map.groupBy empty-reduce crash, Bug 1 early-exit relational narrowing, fs-error graph-edge degradation, agent tool module graph, brand presence for URLSearchParams/TextDecoder/Intl, generator side-table $copy migration

- `Map.groupBy` / `Object.groupBy`: shadow-domain join no longer bare-`reduce`s an empty unkeyed list (raw host `TypeError: Reduce of empty array with no initial value` escaped module evaluation → fail-closed unknown exports when the callback folds a literal key over arr/abstract-string-prim items); empty fold degrades to `unknown`.
- Early-exit lift path (if-return followed by non-tail statements) now applies the same relational-arm narrowing as the regular IfStatement path (`narrowRelArmThunk`), fixing false positives like `if (x >= 0) return x; console.log(x); return 1;` under `@nudo:contract return nonNeg`.
- `extractImportEdges` skips import edges whose target resolution throws `ModuleReadError` (EACCES/ESTALE, #135) instead of crashing module-graph construction (CLI watch start, incremental rebuild false-green rounds, LSP validation).
- `new Function(...)` / `new Function("a", "b", ...)` validate every argument for the L2 may-throw gate, not just the first.
- Brand presence tables: URLSearchParams (methods + `size`), TextDecoder (`decode` + accessors), Intl.NumberFormat/DateTimeFormat (`format`/`formatRange`/parts/`resolvedOptions`); URLSearchParams joins ITERABLE_BRANDS (@@iterator → function).
- `$copy` snapshots migrate generator/match side tables (genDeferred throws, genIter/matchAll elements), so fork/switch-arm rebinding no longer silently drops deferred generator throws.
- LSP agent tools (check/hover) build the module graph like the CLI and LSP validation do, fixing cross-module unknown collapse (E5 parity).
