// Explicit re-exports only — do not add export *. New symbols → @nudojs/core/internal
// or an explicit list reviewed with PUBLIC_API.md + public-api.snapshot.json.
/**
 * @nudojs/core/internal — engine machinery for monorepo hosts (service / lsp).
 *
 * NOT a product face. Names here may change in minor. Prefer `@nudojs/core`
 * (`.`) for anything a user or published tool should depend on.
 * See ../PUBLIC_API.md.
 */

// leak / budgets / memo keys
export {
  type LeakBudget, defaultLeakBudget, exceedsBudget, leakIfNeeded,
  maybeLeak, resetLeakCounter, termDepth, termNodes
} from "./algebra/leak.ts";
export {
  type AbsBudgetStats, FORK_TRUNCATION_LABEL, MAX_B_TOTAL_FORKS,
  MAX_CALL_DEPTH, MAX_TOTAL_CALLS, bumpBForkBudget, callBudgetKey,
  enterCall, exitCall, getAbsCallBudgetStats, getBForkBudgetLimit,
  getBForkCount, noteAbsTruncation, noteBForkTruncation,
  resetAbsCallBudget, resetBForkBudget, setAbsTruncationCollector,
  setBForkBudgetLimit, stableCallId, truncatedAbs
} from "./algebra/call-budget.ts";
export {
  hashSource, resetHashSourceCache
} from "./algebra/hash-source.ts";
export {
  stableAnalyzeKeySource
} from "./algebra/stable-source-key.ts";
export {
  type FnFp, canSkipLiteralCallScan, fnFingerprints,
  generalizeSourceKeyPart, getFnNameAndBodies, resetFnFpCache
} from "./algebra/fn-fp.ts";
export {
  type LoadDepsFingerprint, extractAllLoadSpecs, loadModuleDepsFingerprint,
  normPath, resolveDepPath, sidecarSpecsOf
} from "./algebra/load-deps-fp.ts";

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
} from "./algebra/inlay.ts";
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
  type ClassDef, type MethodDef, awaitAbs, classChainNames,
  classFromMethods, coerceAsyncReturn, defineClass, getClass,
  getClassChain, instanceOf, instantiateClass, lookupMethod,
  lookupMethodWithOwner, lookupSuperMethod, projectBrand, superNameOf,
  wrapPromise
} from "./algebra/language.ts";

// scan extras used by service (rest of scan stays check-internal)
export {
  type InjectedDomainEvidenceOpts, type InjectedDomainRecord,
  checkInjectedDomainEvidence, listTopFunctions
} from "./algebra/scan.ts";

// B-path collectors (not the $op runtime)
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
  type BMemberDiag, OBJECT_PROTO_NAMES, anyMemberResult,
  definitelyUncallableMember, getAbsOrigin, isEvalMissingSlotEnabled,
  isNullishAbs, noteAnyMemberMayThrow, noteMemberDispatchMiss,
  noteNullishMemberThrows, noteObjSlotMissing, notePrimMemberMissing,
  noteUnknownMemberMissing, popCallLoc, pushCallLoc, recordMemberDiag,
  runWithEvalMissingSlot, setEvalMissingSlotEnabled,
  setMemberDiagCollector, tagAbsOrigin
} from "./algebra/exec/member-diag.ts";
