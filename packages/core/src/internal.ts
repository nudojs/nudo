// Explicit re-exports only — do not add export *. New symbols → @nudojs/core/internal
// or an explicit list reviewed with PUBLIC_API.md + public-api.snapshot.json.
/**
 * @nudojs/core/internal — engine machinery for monorepo hosts (service / lsp).
 *
 * NOT a product face. Names here may change in minor. Prefer `@nudojs/core`
 * (`.`) for anything a user or published tool should depend on.
 * See ../PUBLIC_API.md.
 */

// 诊断码注册表（`nudo:*` 码单一真理源；core 内部走 ./algebra/diag-codes.ts 相对 import）
export { CHECK_FACE_DIAG_CODES, DIAG, type DiagCode } from "./algebra/diagnostics/diag-codes.ts";

// BUG-021/199：调用点观测拓宽（emit 写盘面与 contract-drift 对账面共用）
export { isPointConstraint, widenObservationAbs } from "./algebra/widen-observation.ts";

// leak / budgets / memo keys
export {
  stripCommentsAndStrings, stripStringsKeepComments,
  maskCommentsAndStrings, scanStringLiterals,
  type StringLiteralSpan,
  sourceHasRequireCall,
  sourceHasModuleDependency, sourceHasCjsExports
} from "./algebra/format/code-text.ts";
export {
  type LeakBudget, defaultLeakBudget, exceedsBudget,
  termDepth, termNodes
} from "./algebra/diagnostics/leak.ts";
export {
  type ProjectionStopReason, PROJECTION_MAX_DEPTH, ProjectionBudget,
} from "./algebra/contract/projection-budget.ts";
export {
  type AbsBudgetStats, FORK_TRUNCATION_LABEL, HOST_EFFECT_LABEL_PREFIX, MAX_EVAL_TOTAL_FORKS,
  MAX_CALL_DEPTH, MAX_TOTAL_CALLS, PROMISE_MICRO_ERROR_LABEL, PROMISE_MICRO_OVERFLOW_LABEL,
  bumpEvalForkBudget, callBudgetKey,
  enterCall, exitCall, getAbsCallBudgetStats, getEvalForkBudgetLimit,
  getEvalForkCount, noteAbsTruncation, noteEvalForkTruncation, noteHostEffectBlocked,
  resetAbsCallBudget, resetEvalForkBudget, setAbsTruncationCollector,
  setEvalForkBudgetLimit, stableCallId, truncatedAbs, withFnBudgetOverride
} from "./algebra/call-budget.ts";
export {
  // budget 归因段构建器（check / health 两面共用，#health-budget 单一实现）
  budgetAttributionSegs,
  // CheckJson issue 可选字段单一真源（序列化 ↔ nudojs 缓存反序列化共用）
  CHECK_ISSUE_OPTIONAL_KEYS,
  // 分析器诊断 → CheckIssue 映射（nudojs check-json-map 与 lsp agent-tools
  // 共用；Bug 632 / 1038 手抄漂移的闭合点）
  checkIssuesFromDiagnostics,
  type AnalyzerDiagnosticLike,
  // 截断 suggestion 具体修值单源（core check 面 + service analyzer 截断臂
  // 共用——analyz器面不得手写第二份公式）
  suggestedForkCeiling, suggestedDepthCeiling, suggestedCallsCeiling,
} from "./algebra/check/check-report.ts";
export {
  MAX_PROMISE_MICROS, getPromiseMicrosLength
} from "./algebra/builtins/promise.ts";
export {
  clearPureCallMemo,
  enterEvalCallBudgetSession, exitEvalCallBudgetSession, getEvalCallBudgetState,
  withEvalBudgetOverride
} from "./algebra/exec/calls.ts";
export {
  clearPureMemo
} from "./algebra/exec/call.ts";
export {
  // Bug ②：ESM live import 刷新注册表生命周期（evalAbsModuleGraph 入口清空）
  clearLiveImportRefreshers
} from "./algebra/exec/live-imports.ts";
export {
  type CollectorScopeParticipant, type ScopedSlot,
  createScopedSlot, registerCollectorScopeParticipant, runWithCollectorScope,
} from "./algebra/collector-scope.ts";
export {
  type DiagChannel, type ScopedDiagChannel,
  createDiagChannel, createScopedDiagChannel,
} from "./algebra/diagnostics/diag-channel.ts";
export {
  hashSource, resetHashSourceCache
} from "./algebra/key/hash-source.ts";
export {
  stableAnalyzeKeySource
} from "./algebra/key/stable-source-key.ts";
export {
  type FnFp, canSkipLiteralCallScan, fnFingerprints,
  generalizeSourceKeyPart, getFnNameAndBodies, resetFnFpCache
} from "./algebra/key/fn-fp.ts";
export {
  type LoadDepsFingerprint, extractAllLoadSpecs, loadModuleDepsFingerprint,
  beginDepFingerprintEpoch, endDepFingerprintEpoch,
  normPath, resolveDepPath, sidecarSpecsOf, stablePathKey, stablePathKeyGraph
} from "./algebra/key/load-deps-fp.ts";
export {
  // DESIGN-003：sidecar 契约身份=导出名；emit 层据此把 `export { _c as class }`
  // 的本地名归一到导出名（engine machinery——产品面走 localNamedExports）
  exportedNameOfLocal
} from "./algebra/contract/contract.ts";

// derivation sessions + rendering experiments
export {
  type ArgDerivation, type DerivationNode, abortDerivationSession,
  beginDerivationSession, derivationChain, endDerivationSession,
  getDerivation, hasDerivationSession, noteDerivationAdd,
  noteDerivationJoin, projectDerivationDsl, setDerivation,
  setDerivationCollector, tagDerivationRoot, termKey
} from "./algebra/derivation.ts";
export {
  type AbsInlay, type CollectAbsInlaysOpts, collectAbsInlays
} from "./algebra/format/inlay.ts";
export {
  type TemplateMeta, type TemplatePartDesc, type TemplatePartView,
  type TemplatePredicateDecision, absTemplateViews, allFixedTextOfViews,
  concatString, createTemplateAbs, decideEndsWith, decideIncludes,
  decideStartsWith, fixedLengthOfViews, formatTemplateNameViews,
  isTemplateLike, knownPrefixOfViews, knownSuffixOfViews,
  mergeAdjacentFixedViews, templateMatchesValue, templatePartsOf,
  viewTemplateParts
} from "./algebra/template.ts";
export {
  denoteGuard
} from "./algebra/denote.ts";
export {
  escapeTemplateTypeFixed, formatObjectKey, isJsBindingIdent, isJsIdent,
  safeMemberAccess, sanitizeCommentText, toJsBindingIdent
} from "./algebra/format/codegen-escape.ts";
export {
  type ClassDef, type MethodDef, getClassChain, wrapPromise
} from "./algebra/language.ts";

// scan extras used by service (rest of scan stays check-internal)
export {
  type InjectedDomainEvidenceOpts, type InjectedDomainRecord,
  checkInjectedDomainEvidence, listTopFunctions
} from "./algebra/scan/scan.ts";

// evaluator collectors (not the $op runtime)
export {
  $tryDigestSoft, $tryMarkSoft, $tryReleaseSoft, ERROR_FAMILY,
  type MayThrowEffect, errorTypeAbs, filterDeclaredThrows,
  filterGateThrows, filterIgnoredThrows, flushMayThrowEffects,
  formatThrowsAbs, getMayThrowCollector, isThrowsIgnored,
  mayThrowEffectsToAbs, orphanMayThrowEffects, popMayThrowFrame,
  pushMayThrowFrame, recordMayThrow, runWithMayThrowSession,
  setMayThrowCollector, throwAbsToKinds, throwsKindCovered
} from "./algebra/exec/may-throw.ts";
export {
  type EvalFallbackStats, getEvalFallbackStats, resetEvalFallbackStats
} from "./algebra/exec/run.ts";
export {
  type EvalMemberDiag, OBJECT_PROTO_NAMES, anyMemberResult,
  definitelyUncallableMember, getAbsOrigin, isEvalMissingSlotEnabled,
  isNullishAbs, noteAnyMemberMayThrow, noteMemberDispatchMiss,
  noteNullishMemberThrows, noteObjSlotMissing, notePrimMemberMissing,
  noteUnknownMemberMissing, popCallLoc, pushCallLoc, recordMemberDiag,
  runWithEvalMissingSlot, setEvalMissingSlotEnabled,
  setMemberDiagCollector, tagAbsOrigin
} from "./algebra/exec/member-diag.ts";
export {
  // 字面量助手：env 声明（es/node/web 内建折叠）+ harvester .d.ts 物化共享
  absLit, absNumLit, absStrLit, allAbsStr,
  // 统一非-Abs 守卫（exec 域 ~30 处内联 "shape" in 判定的单源化；
  // DEC-006 退路表见 algebra/abs.ts）
  isAbsLike
} from "./algebra/abs.ts";
export { type AssumeSeg, extractAssumeSegs } from "./algebra/refine.ts";
export { LOOP_TRUNCATION_LABEL } from "./algebra/exec/runtime/loop-budget.ts";
// Bug 103：service 入口兜底为 rest 形参构造符号 rest 哨兵（`$restBind` 直通
// 开放数组），避免把「一个位置数组值」当 rest 数组造成返回值多一层元组。
export { makeSymbolicRestAbs } from "./algebra/exec/runtime/containers/arr-make.ts";

// ── 跨包共享原语（service / harvester / parser 复用；此前各包留拷贝靠手工同步） ──
export { BoundedLruMap } from "./algebra/key/lru-map.ts";
export {
  collectNestedBodyRanges,
  // `@nudo:case` 标签扫描骨架（CASE_TAG_REGEX 循环 + inCaseArgs 跳过 +
  // separator/rest 提取）——core 诊断面与 parser fn-directives 的
  // scanMalformedCaseNames 共用；Bug 978 / 合法形态分支留消费侧
  iterCaseTags,
} from "./algebra/directive-scan.ts";
export {
  collectDependencySpecs,
  collectDependencySpecsWithMode,
  type DependencySpecEntry, type DependencySpecMode,
} from "./algebra/scan/scan-deps.ts";
export {
  collectIdentNames,
  isGeneratedMarkerLine,
  sectionChainIndices,
  sectionChainList,
  type ProgramStmts,
} from "./algebra/scan/scan-named-exports.ts";
// 字符串感知扫描（check 面与 parser 指令面共用；Bug 1009 拷贝漂移的闭合点）
export {
  findTopLevelChar, findTopLevelColon, splitTopLevelArgs, stripJsdocContinuation,
  walkTopLevelChars,
} from "./algebra/format/text-scan.ts";
// 源 AST 的 ESM 语法判定（service abs-modules-graph 的 strict 判定复用；
// 此前 service 内嵌逐字拷贝）
export { isEsmProgram } from "./algebra/exec/transpile/meta.ts";
// TS 声明类型文本 → Abs 形状（service 的 dts 产物面复用；此前复刻同表靠
// drift-gate 测试互钉，见 ts-annotation-core-drift.test.ts 的历史头注释）
export { absShapeForTsTypeText } from "./algebra/contract/ts-type-shape.ts";
// check 签名面的形参类型文本（`nudo check` 与 lsp hover 的形参行同口径；
// 此前 LSP 侧留同公式拷贝 formatEntryParamShapeLike 靠手工同步）
export { formatEntryParamShape } from "./algebra/check/check-signatures.ts";
// JS Error 家族构造器名（service 补全近似表 builtin-prototype 的错误类
// 判定复用；此前 8 名复刻 BUILTIN_ERROR_CLASSES 靠"保持同步"注释互钉）
export { ERROR_CTOR_NAMES } from "./algebra/diagnostics/error-names.ts";
