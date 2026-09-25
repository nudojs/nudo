/**
 * `@nudojs/service` — full barrel (stable public surface).
 *
 * Production analysis is Abs-native (shape × term × pred × conf) via the
 * B-path evaluator (`evalAbsModuleGraph` + `runTranspiled`). Prefer the
 * focused subpaths for new consumers:
 *
 * - `@nudojs/service/analysis`  — file analysis + Abs-native module-graph eval
 * - `@nudojs/service/interface` — interface / contract product
 * - `@nudojs/service/dts`       — dts / schema / standard / guard projections
 * - `@nudojs/service/case`      — debug case reports + case directive emit
 * - `@nudojs/service/lsp`       — IDE surface (hover / completions / tokens)
 * - `@nudojs/service/harvest`   — `@types` → Abs env harvesting
 * - `@nudojs/service/evaluator` — host API surface (env/config/CallRecord)
 *
 * This `.` entry re-exports everything below and is kept for compatibility.
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

// ─── Interface（contract 侧车 / draft / emit / derive） ──────────────
export {
  interfaceSurface,
  formatInterfaceSurfaceLine,
  type InterfaceSurfaceEntry,
  type InterfaceSurfaceOpts,
} from "./interface-surface.ts";

export {
  emitInterface,
  formatEmitSummary,
  type EmitInterfaceOpts,
  type EmitInterfaceResult,
  type EmitInterfaceSkipReason,
} from "./interface-emitter.ts";

export {
  draftInterface,
  formatDraftModule,
  formatDraftSummary,
  sidecarDraftPath,
  writeInterfaceDraft,
  collectParamBodyAccesses,
  isDraftableEntry,
  type DraftEvidence,
  type InterfaceDraftEntry,
  type InterfaceDraftOpts,
  type InterfaceDraftResult,
  type WriteDraftResult,
} from "./interface-draft.ts";

// Phase 2：root 驱动契约下行（design-refine-derivation §4.2 / §7.3）
export {
  deriveFromRoot,
  emitDerivedFromRoot,
  extractFnConstraintSources,
  formatDerivedSection,
  type ConstraintSourceExpr,
  type DerivedExport,
  type DerivedParam,
  type EmitDerivedResult,
  type RootDeriveOpts,
  type RootDeriveResult,
} from "./interface-derivation.ts";

// AI3：what-if 绑定注入（CLI / LSP 同构）
export {
  injectBindings,
  typeExprToDirective,
  type TypeBinding,
} from "./what-if.ts";

// ─── DTS / Schema / Guard（外延投影，单向） ─────────────────────────
export {
  generateDts,
  generateFunctionDtsLines,
  absToTSType,
} from "./dts-generator.ts";

export {
  absToSchemaSource,
  absToSchemaNode,
  constraintToSchemaNode,
  projectAbsToSchema,
  schemaNodeToZod,
  type SchemaDialect,
  type SchemaNode,
  type SchemaProjection,
  type SchemaRefinement,
} from "./schema-generator.ts";

export {
  absToStandardSchema,
  absToStandardSchemaModule,
  validateSchemaNode,
  type StandardSchemaIssue,
  type StandardSchemaModuleProjection,
  type StandardSchemaResult,
} from "./standard-schema.ts";

export { generateGuardFunction, generateGuardFunctionFromAbs } from "./guard-generator.ts";

// ─── Case（debug 见证 / CaseJson / case 注入，非接口产品） ───────────
export {
  serializeCaseJson,
  type CaseJson,
  type CaseJsonCase,
  type CaseJsonFunction,
} from "./case-json.ts";

export {
  serializeCaseArg,
  buildCaseDirective,
  stripGeneratedCaseDirectives,
  insertGeneratedCaseDirectives,
  unifiedDiff,
  type EmitSkipReason,
  type EmitResult,
} from "./case-emitter.ts";

// ─── LSP surface（hover / completions / inlay / semantic tokens） ────
export {
  type CaseInfo,
  getTypeAtPosition,
  getTypeAtPositionAsync,
  getAbsAtPosition,
  getAbsAtPositionAsync,
  getHoverAtPosition,
  type HoverInfo,
  getCompletionsAtPosition,
  getCasesForFile,
} from "./lsp-surface.ts";

export {
  buildSemanticTokens,
  encodeSemanticTokens,
  interfaceTierModifierBit,
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
  type SemanticToken,
  type BuildSemanticTokensOpts,
} from "./semantic-tokens.ts";

// ─── Harvest（@types → Abs env；非 CLI 动词） ───────────────────────
export {
  harvestPackage,
  collectDtsFromEntry,
  formatHarvestSummary,
  lookupHarvested,
  resolvePackageRoot,
  type PackageHarvest,
} from "./harvest-package.ts";

export {
  barePackageName,
  collectBarePackages,
  autoHarvestModules,
  harvestPackageCached,
  clearHarvestCache,
  getHarvestCacheSize,
} from "./harvest-auto.ts";

export {
  depsCacheRoot,
  dtsClosureHash,
  harvestPackageWithDisk,
  loadHarvestEnvFromDisk,
  readHarvestDisk,
  writeHarvestDisk,
} from "./harvest-disk.ts";

export {
  absToHarvestSig,
  harvestSigToAbs,
  serializeHarvestJson,
  materializeHarvestJson,
  harvestCacheKey,
  type HarvestJson,
  type HarvestSig,
} from "./harvest-json.ts";

export {
  harvestToAbsModules,
  packageHarvestToAbsModules,
  bareSpecToAbsModules,
  harvestedValueToAbs,
} from "./harvest-to-abs.ts";

export {
  harvestNodeTypes,
  handwrittenNodeEnv,
  summarizeNodeEnv,
  clearNodeHarvestCache,
  getNodeHarvestCacheSize,
  isHarvestNodeDisabled,
  HARVEST_NODE_DEFAULT_MAX_FILES,
  HARVEST_NODE_DEFAULT_MAX_MS,
  type NodeEnvResult,
  type HarvestNodeStats,
} from "./harvest-node.ts";

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
