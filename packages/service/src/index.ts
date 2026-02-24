export {
  type AnalysisResult,
  type FunctionAnalysis,
  type CaseResult,
  type CaseInfo,
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticTag,
  type SourceLocation,
  type BindingInfo,
  type CompletionItem,
  analyzeFile,
  getTypeAtPosition,
  getCompletionsAtPosition,
  getCasesForFile,
} from "./analyzer.ts";

export {
  typeValueToTSType,
  generateDts,
} from "./dts-generator.ts";
