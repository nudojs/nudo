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
  getTypeAtPosition,
  getTypeAtPositionAsync,
  getCompletionsAtPosition,
  getCasesForFile,
  buildModuleGraph,
  computeDirtySet,
  topoSortDirty,
} from "./analyzer.ts";

export {
  typeValueToTSType,
  generateDts,
} from "./dts-generator.ts";

export { typeValueToZodSchema } from "./schema-generator.ts";
export { generateGuardFunction } from "./guard-generator.ts";
