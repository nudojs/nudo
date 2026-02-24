export {
  type AnalysisResult,
  type FunctionAnalysis,
  type CaseResult,
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticTag,
  type SourceLocation,
  type BindingInfo,
  type CompletionItem,
  analyzeFile,
  getTypeAtPosition,
  getCompletionsAtPosition,
} from "./analyzer.ts";

export {
  typeValueToTSType,
  generateDts,
} from "./dts-generator.ts";
