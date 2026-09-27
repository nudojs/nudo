---
"@nudojs/core": minor
"@nudojs/service": minor
"@nudojs/lsp": patch
"nudojs": patch
---

refactor!: rename B-path / BPath engine identifiers to eval / evaluator

The AST-walk interpreter is long gone, so the dual-engine campaign name
"B-path" no longer means anything and forced a glossary entry just to
explain itself. The single production evaluation engine is now simply
the **evaluator** (mechanism: transpile → `new Function` on Abs).

Breaking renames (no major bump — package has no external users yet):

| Old | New |
|---|---|
| `tryBPathCall` / `tryBPathCallFull` | `tryEvalCall` / `tryEvalCallFull` |
| `tryRunBPath` | `tryRunEval` |
| `isBPathCapable` | `isEvalCapable` |
| `clearBPathCache` / `trimBPathCache` / `getBPathCacheSize` | `clearEvalCache` / `trimEvalCache` / `getEvalCacheSize` |
| `evictBPathCacheForFiles` | `evictEvalCacheForFiles` |
| `collectBPathDiagnostics` / `collectBPathReplacements` | `collectEvalDiagnostics` / `collectEvalReplacements` |
| `BPathRunResult` / `BPathDiagnostics` / `BPathFallback` / … | `EvalRunResult` / `EvalDiagnostics` / `EvalFallback` / … |
| `BCallRecord` / `setBCallCollector` / `getBCallCollector` | `EvalCallRecord` / `setEvalCallCollector` / `getEvalCallCollector` |
| `noteBPathFallback` / `setBPathFallbackCollector` | `noteEvalFallback` / `setEvalFallbackCollector` |
| `MAX_B_CALL_DEPTH` / `MAX_B_TOTAL_CALLS` / `MAX_B_TOTAL_FORKS` | `MAX_EVAL_CALL_DEPTH` / `MAX_EVAL_TOTAL_CALLS` / `MAX_EVAL_TOTAL_FORKS` |
| `maxBRuns` (sessionCache) | `maxEvalRuns` |
| `NUDO_CACHE_MAX_BRUNS` | `NUDO_CACHE_MAX_EVALRUNS` |

Source files `bpath-run.ts` / `bpath-diagnostics.ts` / `bpath-*.test.ts`
are now `eval-run.ts` / `eval-diagnostics.ts` / `eval-*.test.ts`.
Docs no longer introduce a "B-path" term or explain why the engine is
called B. Historical CHANGELOG / releases-history keep the old name.
