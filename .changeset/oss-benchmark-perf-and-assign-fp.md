---
"@nudojs/core": patch
"@nudojs/service": patch
---

Fix the OSS real-package benchmark regressions (perf) and the `nudo:assign-mismatch` false positive.

**Perf** — the analysis pipeline repeated whole-file work per candidate:

- `localNamedExports` (source → local export-name table) is now memoized per source text and computed **once** per candidate loop instead of once per candidate. It parses with `errorRecovery`, which deliberately bypasses the AST LRU ⇒ a single-file analysis re-parsed the whole file **5 151 times** (451 MB of repeated parsing; the TS strip pass alone 36.6 s). A single `commander/lib/command.js` analysis went from **59.2 s → 4.1 s**.
- Function-directive scopes (`listFnDirectiveScopes`) are memoized per AST object (the scope walk was repeated per function × per refine site).
- The source-level lexer scan (`scanSource`) and the file-level directive gate ranges (`bodyGateRanges`) are memoized per source text — the three file-level directive extractors each re-walked the whole AST.
- The TS strip pass is skipped for JS-mode sources: the `jsx`-only plugin set cannot produce TS-only nodes, so the pass was a structural no-op that still paid two full AST walks per parse.
- The `@nudo:` directive count inside the strip pass now runs only when the caller asks for a report (it was dead work on every parse).

**Fix** — `nudo:assign-mismatch` no longer fires on **function parameter** reassignment. A JS parameter has no declared type: the analysed "previous value" is the shape of the actual argument at that call site, so normalising a parameter (`global(globals) { globals = [].concat(globals); … }` in yargs) was reported as `arr ⊭ prim string` — a false positive on the OSS corpus. The check keeps its obligation for bindings with a declared value (`let n = 1; n = "str"` still reports).
