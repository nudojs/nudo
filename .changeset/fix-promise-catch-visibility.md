---
"@nudojs/lsp": patch
"nudojs": patch
---

Stop silently swallowing business-Promise failures. `nudo check/test --watch`
incremental rounds died silently when the round body threw outside the
per-file try (`buildModuleGraph` / `evictForDependents` / `topoSortDirty`) —
the screen just froze on the previous round's results; the error is now
printed (`nudo <label> incremental failed: …`), mirroring the existing
first-round BUG-023 handling. In the LSP server, `validateDocument` (didOpen /
didChange debounce) and `handleNudoDepFileChanged` (didOpen / didChange /
watched-files) rejections were discarded with an empty catch — a file throwing
in the analyzer produced no diagnostics and no trace, forever; failures are
now logged to stderr as `[nudo-lsp] …` lines. Best-effort client capability
requests (`DiagnosticRefresh` / `CodeLensRefresh` / inlay-hint refresh) keep
their intentional silent catch.
