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
  getTypeAtPosition,
  getCompletionsAtPosition,
  getCasesForFile,
} from "./analyzer.ts";

export {
  typeValueToTSType,
  generateDts,
} from "./dts-generator.ts";
