export {
  type AnalysisResult,
  type FunctionAnalysis,
  type CaseResult,
  type CaseInfo,
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
  getTypeAtPosition,
  getTypeAtPositionAsync,
  getHoverAtPosition,
  type HoverInfo,
  getCompletionsAtPosition,
  getCasesForFile,
  buildModuleGraph,
  type ModuleGraphCache,
  computeDirtySet,
  topoSortDirty,
} from "./analyzer.ts";

export { collectAbsInlays, type AbsInlay } from "@nudojs/core";

export {
  serializeInferJson,
  type InferJson,
  type InferJsonCase,
  type InferJsonFunction,
} from "./infer-json.ts";

export { isNudoTargetPath } from "./target-path.ts";
export { defaultLoadModule, type LoadModule } from "./load-module.ts";
export {
  collectStaticImports,
  analyzeExportsFromSource,
  collectDependencySpecs,
  type ModuleExports,
} from "./static-imports.ts";
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
} from "./harvest-auto.ts";
export {
  evalAbsModuleGraph,
  evalProgramAbsWithModules,
  defaultAbsLoadModule,
  type AbsModuleGraphResult,
  type AbsGraphOptions,
} from "./abs-modules-graph.ts";
export {
  harvestToAbsModules,
  packageHarvestToAbsModules,
  bareSpecToAbsModules,
  harvestedValueToAbs,
} from "./harvest-to-abs.ts";
export {
  isBPathCapable,
  tryRunBPath,
  tryBPathCall,
  type BPathRunResult,
} from "./bpath-run.ts";
export {
  harvestNodeTypes,
  summarizeNodeEnv,
  type NodeEnvResult,
} from "./harvest-node.ts";

export {
  buildSemanticTokens,
  encodeSemanticTokens,
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
  type SemanticToken,
} from "./semantic-tokens.ts";

export {
  typeValueToTSType,
  generateDts,
  generateFunctionDtsLines,
} from "./dts-generator.ts";

export { typeValueToZodSchema } from "./schema-generator.ts";
export { generateGuardFunction, generateGuardFunctionFromAbs } from "./guard-generator.ts";

export {
  serializeCaseArg,
  buildCaseDirective,
  stripGeneratedCaseDirectives,
  insertGeneratedCaseDirectives,
  unifiedDiff,
  type EmitSkipReason,
  type EmitResult,
} from "./case-emitter.ts";

export { mockDirectivesToAbsSeeds, type AbsMockSeeds } from "./mock-abs.ts";
