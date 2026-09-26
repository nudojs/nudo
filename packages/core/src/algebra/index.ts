// Explicit re-exports only — do not add export *. New symbols → @nudojs/core/internal
// or an explicit list reviewed with PUBLIC_API.md + public-api.snapshot.json.
// @public — Abs core (shape × term × pred × conf). See ../PUBLIC_API.md.

export {
  type LiteralValue, type Term, app, lit, simplifyTerm, termEquals,
  termToString, v
} from "./term.ts";

export {
  type ImplicationOracle, type Phi, type Pred, type PrimName, TYPEOF_NAMES,
  type TypeofName, and, emptyPhi, eq, ge, geNum, getImplicationOracle, gt,
  gtNum, implies, le, leNum, lt, ltNum, ne, negatePred, not, or, pFalse,
  pTrue, phiAnd, predEquals, predToString, predVars, primToTypeof, ptypeof,
  setImplicationOracle, substPred
} from "./pred.ts";

export {
  currentPhi, describePhi, popPhi, pushPhi, resetPhi, withPhiConstraint
} from "./phi.ts";

export {
  type Abs, type Confidence, type Shape, abs, absToString, anyAbs, anyVar,
  bigintLit, bool, boolLit, confJoin, isBigPrim, isExactLit, isNumPrim,
  isStrPrim, litValue, never, num, numLit, numVar, obj, shapeOfTerm,
  shapeToString, str, strLit, unknown
} from "./abs.ts";

export {
  type AbsFnImpl, type AbsSigImpl, absFunction, attachFnImpl, getFnImpl,
  markPureFn, pureFnNameOf, relationFingerprint, relationFn, shapeOnlyFn
} from "./abs-fn.ts";

export {
  type HofCollectCtx, type HofSite, type RelSource, alphaOf,
  applyCallbackAbs, applyCallbackValue, asAbs, betaOf, createHofCollectCtx,
  instantiateReturn, isRelFn, mapElementFallback, projectFlatMapResult,
  promoteParamShape, setApplyCallbackHost, snapshotAbs, substAbs,
  substPredAbs, tryPromoteDirectCall, tryPromoteForOfIteratee,
  tryPromoteHofCallback, tryPromoteReceiverAsArr, undefAbs
} from "./hof.ts";

export {
  add, cmp, div, falseConstraint, matchRelIdentLit, mod, mul,
  refineAbsForRelTrue, sub, trueConstraint
} from "./arithmetic.ts";

export {
  bitandAbs, bitnotAbs, bitorAbs, bitxorAbs, definitelyNotNullishShape,
  isNullishLitAbs, looseEqAbs, negAbs, notAbs, powAbs, shlAbs, shrAbs,
  strictEqAbs, toNumberAbs, typeofAbs, ushrAbs
} from "./surface.ts";

export {
  type ExtState, OBJECT_PROTO_METHOD_NAMES, type PropFlags,
  assignSourceSlots, builtinCtorAbs, builtinCtorNameOf, ctorNameOfRecv,
  drainPromiseMicros, enterPromiseExecutorScope, errorBrandAbs,
  evalArrayStatic, evalBuiltinInstanceMethod, evalBuiltinNew, evalDateCtor,
  evalDateMethod, evalDateStatic, evalGlobalFn, evalJsonMethod,
  evalMathMethod, evalNamespaceCall, evalNumberStatic, evalObjectMethod,
  evalObjectProtoMethod, evalPromiseCtor, evalPromiseMethod,
  evalPromiseStatic, evalRegExpCtor, evalRegExpMethod, evalStringStatic,
  evalSymbolCtor, extStateOf, getPropFlags, hostBuiltinCtorName,
  isErrorCtorName, isObjectProtoBrand, isSymbolAbs,
  leavePromiseExecutorScope, makeArrayCtorAbs, makeSymbolAbs, markExtState,
  migrateInvariants, notePromiseExecutorFork, objectProtoBrand,
  objectProtoMethodAbs, protoBrandAbs, protoOfRecv, queuePromiseMicro,
  regexBrandAbsFrom, setPropFlags, stringOfSymbol, symbolDescriptionAbs,
  symbolIdOf, tryMakeRegexAbs
} from "./builtins.ts";

export {
  callAbsMethod, getAbsProperty
} from "./methods.ts";

export {
  type FnAbs, type ObjShape, type Slot, absShapeKey, canonicalArrayIndex,
  fnOf, getSlot, isNullProtoObj, isObj, joinAbs, joinFunctions,
  joinObjects, joinValues, makeSum, markNullProtoObj, migrateNullProto,
  objOf, spread
} from "./objects.ts";

export {
  beginCollectionFork, clearCollectionTables, collectionElementJoin,
  collectionExactLen, ctorArgDefinitelyInvalid, endCollectionFork,
  isMapAbs, isSetAbs, makeMapAbs, makeSetAbs, mapClearEntries,
  mapDeleteEntry, mapEntriesAbs, mapGetEntry, mapHasEntry, mapSetEntry,
  mapSizeAbs, mapValuesAbs, mergeCollectionArms, noteCollectionWrite,
  popCollectionArm, pushCollectionArm, setAddEntry, setClearEntries,
  setDeleteEntry, setElementsAbs, setHasEntry, setSizeAbs
} from "./collections.ts";

export {
  type LeqResult, leqAbs, requiredFnArity
} from "./leq.ts";

export {
  type AstEnv, emptyEnv, withVar
} from "./ast-env.ts";

export {
  type AbsAssignRecord, type AbsCallRecord
} from "./ast-records.ts";

export {
  type FormatOptions, formatAbs, formatAbsMultiline, formatShape,
  formatShapeSlot
} from "./format.ts";

export {
  type PolyFn, type TypeParam, buildArgsFromAssume, collectAbsFreeVars,
  evictGeneralizeMemoForPaths, extractFn, generalizeAll, generalizeFromAst,
  getGeneralizeMemoSize, listFunctionNames, resetGeneralizeMemo
} from "./generalize.ts";

export {
  type FormalParam, contractParamNameSet, formalParamDisplayNames,
  formalParamsFromNodes, locateContractParam
} from "./param-surface.ts";

export {
  type Diagnostic, checkArg, checkCall, formatDiagnostics
} from "./diagnostics.ts";

export {
  getParseSourceCacheSize, parseSource, resetParseSourceCache
} from "./parse-source.ts";

export {
  type CheckOptions, checkSource, evictCheckSourceMemoForPaths,
  resetCheckSourceMemo
} from "./check.ts";

export {
  type CheckAction, type CheckIssue, type CheckJson, type CheckJsonMulti,
  type CheckReport, type GitlabCodeQualityIssue, type NudoSig,
  actionsForIssue, formatCheckReport, formatGithubAnnotations,
  formatGitlabCodeQuality, serializeCheckJson, serializeCheckJsonMulti
} from "./check-report.ts";

export {
  type NamedImport, NudoSidecarError, type RefineDiag, type RefineEntry,
  type RefineResolveOpts, execNudoModule, extractDeclaredThrows,
  extractNudoImports, extractRefineReturnFromSource,
  extractRefinesFromSource, refineDiagCount, refineToIndexedFull,
  resetNudoModuleExecCache, setRefineDiagCollector, takeRefineDiags,
  takeRefineDiagsSince
} from "./refine.ts";

export {
  type ConstraintBuilder, type NudoConstraint, type NudoField,
  type NudoFnConstraint, SELF, andC, any, array, boolean,
  constraintToEntryAbs, fn, fnConstraintToEntryReqs, getTerm,
  instantiateConstraint, isIntFlag, isNudoConstraint, lenTerm, litC,
  number, omit, partial, pick, shape, string, throwConstraintToKinds,
  union
} from "./constraint.ts";

export {
  literalMeetsConstraint
} from "./domain-membership.ts";

export {
  type AbsModuleExports, bindImports, collectAbsExports
} from "./abs-modules.ts";

export {
  $add, $arguments, $arr, $arrMutContainer, $arrRest, $arrWithHoles,
  $assignRecord, $async, $asyncReturn, $await, $bitand, $bitnot, $bitor,
  $bitxor, $call, $callNamed, $catchVal, $class, $classExpr,
  $collectionForEach, $concat, $copy, $del, $delRes, $div, $dynamicImport,
  $elems, $eq, $eqLoose, $fnVal, $for, $forInKeys, $forIter, $forOf, $fork,
  $ge, $gen, $get, $gt, $idx, $idxSet, $importMeta, $in, $instanceof,
  $instanceofNonIdent, $invoke, $invokeSuper, $isBreakTo, $isForkExit,
  $join, $le, $len, $lit, $loopBreak, $loopContinue, $loopReturn, $lt,
  $mod, $mul, $ne, $neLoose, $neg, $new, $not, $nullishTest, $obj,
  $objAccessor, $objRest, $optionalGet, $optionalInvoke, $orDefault, $pow,
  $pushLoopExit, $rawThis, $reStateCall, $recordBinding, $regex,
  $rethrowIfNudoReturn, $set, $setKey, $shl, $shr, $spread, $staticInvoke,
  $sub, $super, $switch, $thisGet, $thisSet, $throw, $toNumber,
  $tryCurrentMark, $tryDetachSoftCatch, $tryDigestSoftCatch,
  $tryDiscardSoft, $tryMark, $tryOrphanSoft, $tryPopMark,
  $tryReleaseSoftCatch, $tryReleaseSoftOut, $tryTakeSince, $typeof,
  $unknown, $ushr, $while, $whileSeq, $yield, type BAbsAssignRecord,
  type BCallRecord, type BClassSpec, type BPathFallback,
  DEFAULT_MAX_LOOP_ITERS, MAX_B_CALL_DEPTH, MAX_B_TOTAL_CALLS,
  NudoLoopSignal, NudoReturn, NudoThrow, NudoUnsupportedError,
  RUNTIME_IMPORT_RE, type RunTranspiledOptions, type TranspileOptions,
  type TranspiledCallResult, asAbsVal, bindingsOf, callAtFunctionBoundary,
  callTranspiledExport, callTranspiledExportFull, clearBClasses,
  clearStaleTermPred, currentExecPhi, evalExprAbs, fillTuple,
  foldRequireSpecArg, foldStaticStringExpr, getBCallCollector, getBClass,
  isArrMutator, isDefinitelyFalse, isDefinitelyTrue, isNudoBreak,
  isNudoContinue, isNudoReturn, isNudoThrow, litTruth, lookupObjAccessor,
  namespaceNameOf, noteBCallRecord, noteBPathFallback, pushLoopExit,
  pushThrowExit, registerBClass, resetBCallBudget, runTranspiled,
  runTranspiledOptionsMemoKey, runWithLoopExits, runtimeImportOf,
  setBAssignCollector, setBBindingSink, setBCallCollector,
  setBPathFallbackCollector, takeLoopExits, takeThrowExits, transpile,
  transpileBodyNode, transpileExpression, transpileFile, transpileSource,
  tryRunTranspiled, withExecPhi
} from "./exec/index.ts";

export {
  type EffectiveInterface, type EffectiveInterfaceOpts, type InterfaceDiag,
  type InterfaceSource, type InterfaceTierInfo, type InterfaceTierOpts,
  effectiveInterface, formatConstraint, formatEffectiveInterfaceDisplay,
  formatInterfaceTierLine, generatedExportNames, interfaceDiagCount,
  interfaceSourceOf, interfaceTierOf, isNodeModulesPath, localNamedExports,
  setInterfaceDiagCollector, sidecarClosureFingerprint, sidecarPathOf,
  takeInterfaceDiags, takeInterfaceDiagsSince
} from "./interface.ts";

export {
  absToConstraint, joinThenProject
} from "./projection.ts";

// modules/fs/path belong to the host (service/cli), not the algebra.
// Engine machinery (leak / call-budget / hash / derivation / inlay / template /
// language / scan extras / may-throw collectors) is @nudojs/core/internal —
// see ../internal.ts and ../PUBLIC_API.md §3.
