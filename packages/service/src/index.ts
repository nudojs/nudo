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
  getCompletionsAtPosition,
  getCasesForFile,
  buildModuleGraph,
  type ModuleGraphCache,
  computeDirtySet,
  topoSortDirty,
} from "./analyzer.ts";

export {
  typeValueToTSType,
  generateDts,
  generateFunctionDtsLines,
} from "./dts-generator.ts";

export { typeValueToZodSchema } from "./schema-generator.ts";
export { generateGuardFunction } from "./guard-generator.ts";

export {
  serializeCaseArg,
  buildCaseDirective,
  stripGeneratedCaseDirectives,
  insertGeneratedCaseDirectives,
  unifiedDiff,
  type EmitSkipReason,
  type EmitResult,
} from "./case-emitter.ts";
