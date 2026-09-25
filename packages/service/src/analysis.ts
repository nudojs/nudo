/**
 * `@nudojs/service/analysis` — analyzer face.
 *
 * File analysis (`analyzeFile`), call-site discovery, and the Abs-native
 * module-graph evaluation that production analysis actually runs
 * (`evalAbsModuleGraph` + B-path `runTranspiled`; the old TypeValue
 * `evaluateProgram` / `evalProgramAbs` paths are gone).
 */
export {
  type AnalysisResult,
  type FunctionAnalysis,
  type CaseResult,
  type CaseHint,
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticTag,
  type SourceLocation,
  type BindingInfo,
  type CompletionItem,
  type SymbolInfo,
  type ReferenceInfo,
  type SymbolTable,
  analyzeFile,
  analyzeFileAsync,
  collectCallRecords,
  type CallRecord,
  buildModuleGraph,
  type ModuleGraphCache,
  type DirectiveCaseMode,
  computeDirtySet,
  topoSortDirty,
} from "./analyzer.ts";

export {
  evalAbsModuleGraph,
  collectAbsBindingsFromGraph,
  defaultAbsLoadModule,
  clearAbsModuleCache,
  evictAbsModuleCacheFiles,
  getAbsModuleCacheSize,
  type AbsModuleGraphResult,
  type AbsGraphOptions,
  type AbsModuleLoadIssue,
  type AbsModuleCacheEntry,
} from "./abs-modules-graph.ts";

export {
  isBPathCapable,
  tryRunBPath,
  tryBPathCall,
  tryBPathCallFull,
  clearBPathCache,
  evictBPathCacheForFiles,
  trimBPathCache,
  getBPathCacheSize,
  type BPathRunResult,
} from "./bpath-run.ts";

export {
  shouldAnalyzeFile,
  hasNudoDirectives as sourceHasNudoDirectives,
  filterDiagnosticsByLevel,
  diagnosticsLevelForFile,
} from "./analysis-scope.ts";
