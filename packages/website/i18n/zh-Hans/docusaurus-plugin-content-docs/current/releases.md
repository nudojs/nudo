---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.2.0 |
| `@nudojs/service` | 1.2.0 |
| `nudojs (CLI)` | 1.0.5 |
| `@nudojs/parser` | 1.1.5 |
| `@nudojs/lsp` | 1.1.5 |
| `@nudojs/env` | 0.4.7 |
| `@nudojs/harvester` | 0.2.13 |
| `vite-plugin-nudo` | 0.4.8 |
| `nudo-vscode` | 0.3.12 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.2.0 {#pkg-core}

## 1.2.0

### Minor Changes

- 5ff4202: refactor!: rename B-path / BPath engine identifiers to eval / evaluator
  
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

### Patch Changes

- 5ff4202: fix(core): more JS semantics soundness — Array.of / .at() / postfix ++-- / ToPrimitive
  
  - `Array.of` packs arguments into a tuple, not an array of the first element
  - `.at()` honors ToIntegerOrInfinity (string.at + array.at index)
  - postfix `++`/`--` writes back inside the expression
  - `+` honors ToPrimitive/ToString for arrays, objects, undefined
  - drop dead duplicate `case "promise"` in checkNode

更早版本（15）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.2.0 {#pkg-service}

## 1.2.0

### Minor Changes

- 5ff4202: refactor!: rename B-path / BPath engine identifiers to eval / evaluator
  
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

### Patch Changes

- 5ff4202: fix(core): more JS semantics soundness — Array.of / .at() / postfix ++-- / ToPrimitive
  
  - `Array.of` packs arguments into a tuple, not an array of the first element
  - `.at()` honors ToIntegerOrInfinity (string.at + array.at index)
  - postfix `++`/`--` writes back inside the expression
  - `+` honors ToPrimitive/ToString for arrays, objects, undefined
  - drop dead duplicate `case "promise"` in checkNode
- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/env@0.4.7
  - @nudojs/harvester@0.2.13
  - @nudojs/parser@1.1.5

更早版本（17）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.0.5 {#pkg-nudojs}

## 1.0.5

### Patch Changes

- 5ff4202: refactor!: rename B-path / BPath engine identifiers to eval / evaluator
  
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
- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/service@1.2.0
  - @nudojs/harvester@0.2.13
  - @nudojs/parser@1.1.5

更早版本（14）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.1.5 {#pkg-parser}

## 1.1.5

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0

更早版本（15）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.1.5 {#pkg-lsp}

## 1.1.5

### Patch Changes

- 5ff4202: refactor!: rename B-path / BPath engine identifiers to eval / evaluator
  
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
- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/service@1.2.0
  - @nudojs/parser@1.1.5

更早版本（18）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.7 {#pkg-env}

## 0.4.7

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0

更早版本（14）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.2.13 {#pkg-harvester}

## 0.2.13

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/env@0.4.7
  - @nudojs/parser@1.1.5

更早版本（14）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.8 {#pkg-vite-plugin}

## 0.4.8

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/service@1.2.0

更早版本（17）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.12 {#pkg-vscode}

## Unreleased

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
