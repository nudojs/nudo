/**
 * analyzer 薄 facade：原 ~2737 行 god-file 机械拆分后的统一导出面。
 *
 * 拆分模块（语义未改，仅搬家 + 类型收口）：
 * - analyzer-types.ts      共享类型
 * - analyzer-module-load.ts  resolveModule / import 图 / 脏集 / 拓扑
 * - analyzer-ast.ts          函数收集 / 定位 / 节点 Abs 表
 * - analyzer-diagnose.ts     mock 校验 / unreachable / 跨文件 call@ 合成
 * - analyzer-cache.ts        整文件 memo 键 + 克隆/行号平移
 * - analyzer-abs-eval.ts     Abs 重求值 / intension / CallRecord 转换
 * - analyzer-orchestrate.ts  analyzeFile / analyzeFileAsync / collectCallRecords
 *
 * 对外导出名与拆分前一致（lsp/cli/index 依赖面不破坏）。
 */

export {
  type SourceLocation,
  type DiagnosticSeverity,
  type DiagnosticTag,
  type Diagnostic,
  type CaseResult,
  type FunctionAnalysis,
  type BindingInfo,
  type CaseHint,
  type AnalysisResult,
  type CompletionItem,
  type SymbolInfo,
  type ReferenceInfo,
  type SymbolTable,
  type AnalyzeLoadModule,
  type DirectiveCaseMode,
} from "./analyzer-types.ts";

export {
  resolveModule,
  type ModuleGraphCache,
  buildModuleGraph,
  computeDirtySet,
  topoSortDirty,
} from "./analyzer-module-load.ts";

export {
  locFromNode,
  extractParamNames,
  resolveFunctionNode,
  fnNameLoc,
  collectTopLevelFunctions,
  findSingleModuleExportsFunction,
  collectBindings,
  buildNodeTypeMap,
} from "./analyzer-ast.ts";

export {
  validateMockDirectives,
  findCommonUnreachable,
  dedupeCallRecords,
  synthesizeExternalFunctions,
  findModuleImportLoc,
  DEFAULT_CALLSITE_BUDGET,
  COLLAPSE_LITERAL_THRESHOLD,
} from "./analyzer-diagnose.ts";

export {
  analysisFileCacheKey,
  cloneAnalysisResult,
  cloneFunctionAnalysis,
  shiftSourceLoc,
  shiftDiagnosticLines,
  shiftCallRecordLines,
} from "./analyzer-cache.ts";

export {
  buildAbsImportLocalMap,
  callRecordFromAbsCall,
  tryEvalAbsRaw,
  tryEvalAbsFull,
  tryEvalEntryAbs,
  tryAttachIntension,
  attachHofSnapshot,
  attachAbsToIntension,
  absIsBetter,
  isSelfContainedSource,
  absModulesOk,
} from "./analyzer-abs-eval.ts";

export {
  collectEnvNames,
  analyzeFileAsync,
  analyzeFile,
  collectCallRecords,
} from "./analyzer-orchestrate.ts";

export { clearFnAnalysisCache } from "./fn-analysis-cache.ts";
export type { CallRecord } from "./evaluator/evaluator-api.ts";
