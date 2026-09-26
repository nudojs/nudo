/**
 * `@nudojs/service` — analysis core (stable public surface).
 *
 * Production analysis is Abs-native (shape × term × pred × conf) via the
 * B-path evaluator (`evalAbsModuleGraph` + `runTranspiled`). Prefer the
 * focused subpaths for new consumers:
 *
 * - `@nudojs/service/analysis`  — file analysis + Abs-native module-graph eval
 * - `@nudojs/service/evaluator` — host API surface (env/config/CallRecord)
 *
 * Emit products (interface/dts/case) live in `@nudojs/service/emit`; IDE surface in
 * `@nudojs/lsp`; `@types` harvest in `@nudojs/harvester`. This `.` entry
 * re-exports the analysis face below.
 */

// ─── Analyzer（文件分析 / 诊断 / 调用点） ────────────────────────────
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
  analysisFileCacheKey,
  resolveModule,
  locFromNode,
  collectEnvNames,
} from "./analyzer.ts";

export {
  shouldAnalyzeFile,
  hasNudoDirectives as sourceHasNudoDirectives,
  filterDiagnosticsByLevel,
  diagnosticsLevelForFile,
} from "./analysis-scope.ts";

export {
  collectStaticImports,
  analyzeExportsFromSource,
  collectDependencySpecs,
  type ModuleExports,
} from "./static-imports.ts";

export {
  detectEntryVariantsFromPackageJson,
  entryVariantForFile,
  entryVariantIssueForFile,
  findOwningPackage,
  type EntryVariantInfo,
  type EntryVariantIssue,
} from "./entry-variants.ts";

export { collectSkipReturns } from "./skip-directives.ts";
// AI3：what-if 绑定注入（CLI / LSP 同构；emit 的 interface 面再导出）
export {
  injectBindings,
  typeExprToDirective,
  type TypeBinding,
} from "./what-if.ts";
export { defaultLoadModule, type LoadModule } from "./load-module.ts";
export { collectLoadDepContents, type DepContent } from "./dep-contents.ts";

// ─── Evaluator（Abs-native B-path：evalAbsModuleGraph / runTranspiled） ─
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
  collectBPathReplacements,
  collectEnvGlobals,
  collectEnvModules,
  mergeHarvestUnderEnv,
  setEnvHarvestConflictCollector,
  getEnvHarvestConflictCollector,
  type EnvHarvestConflict,
  type MergeHarvestOptions,
  type BPathRunResult,
} from "./bpath-run.ts";

export {
  collectBPathDiagnostics,
  type BPathDiagnostics,
  type BPathUnreachable,
  type BPathBuiltinUnknown,
} from "./bpath-diagnostics.ts";

export {
  mockDirectivesToAbsSeeds,
  mockSeedsToAbsMocks,
  mockSeedsForSource,
  type AbsMockSeeds,
} from "./mock-abs.ts";

export {
  applyMockModuleDirectives,
  applyMockModuleDirectivesFromSource,
  type MockModuleApplyResult,
} from "./mock-module.ts";

// ─── Config / session / cache ───────────────────────────────────────
// check/LSP 执法路径的 autoBind / L2 entry-throws 接线
export {
  findProjectConfig,
  interfaceConfig,
  analysisConfig,
  checkConfig,
  diskCacheRoot,
  matchesEmitAllowlist,
  applyBForkBudgetFromConfig,
  currentBForkBudgetLimit,
  DEFAULT_ANALYSIS_MODE,
  type NudoConfig,
  type InterfaceConfig,
  type AnalysisConfig,
  type CheckConfig,
  type AnalysisMode,
  type DiagnosticsLevel,
} from "./evaluator/config.ts";

export { clearPathEnvCaches, getPathEnvCacheSizes } from "./evaluator/env-loader.ts";

export {
  getAnalysisSession,
  setAnalysisSession,
  type AnalysisSession,
} from "./analysis-session.ts";

export {
  clearAnalysisFileCache,
  getAnalysisFileCacheSize,
  evictAnalysisFileCacheForFiles,
  trimAnalysisFileCache,
} from "./analysis-file-cache.ts";

export {
  clearFnAnalysisCache,
  evictFnAnalysisCacheForFiles,
  trimFnAnalysisCache,
  getFnAnalysisCacheSize,
} from "./fn-analysis-cache.ts";

export {
  evictAnalysisCachesForFiles,
  clearAnalysisSessionCaches,
  resetAllAnalysisCaches,
  applySessionCacheConfig,
} from "./session-cache.ts";

export {
  getSessionCacheLimits,
  setSessionCacheLimits,
  setSessionCacheFromProject,
  resetSessionCacheLimitState,
  DEFAULT_SESSION_CACHE_LIMITS,
  type SessionCacheLimits,
} from "./session-cache-limits.ts";

export {
  DiskCache,
  checkCacheKey,
  ifaceCacheKey,
  sha256Hex,
  relativizePath,
  extractNudoImportSpecs,
  ANALYSIS_ABI,
  type DiskCacheOptions,
} from "./disk-cache.ts";

// ─── Paths / watch / env-deps ───────────────────────────────────────
export { isNudoTargetPath } from "./target-path.ts";
export {
  isSidecarPath,
  isProjectConfigPath,
  isWatchRelevantPath,
  ambientSourcesOfSidecar,
} from "./watch-paths.ts";
export {
  noteEnvPathDeps,
  envPathDependents,
  clearEnvPathDeps,
  isEnvTemplatePath,
  getEnvPathDepsSize,
} from "./env-path-deps.ts";
