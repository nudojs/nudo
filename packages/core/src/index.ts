// Explicit re-exports only — do not add export *. New symbols → @nudojs/core/internal
// or an explicit list reviewed with PUBLIC_API.md + public-api.snapshot.json.
/**
 * @nudojs/core — 唯一类型系统。
 *
 * 内涵（algebra）：Abs = shape × term × pred × conf，类型即计算。
 */

export {
  type Environment, createEnvironment
} from "./environment.ts";

export {
  type MockHelper, mock, spy, stub
} from "./mock-helpers.ts";

export {
  stripTypes
} from "./strip-types.ts";

export {
  getParseSourceCacheSize, parseSource, resetParseSourceCache
} from "./algebra/parse-source.ts";

// --- 内涵：类型即计算 ---
// parseSource / resetParseSourceCache / getParseSourceCacheSize are re-exported
// above (host-documented face); omitted here to avoid duplicate identifiers.
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
  $unknown, $ushr, $while, $whileSeq, $yield, type Abs,
  type AbsAssignRecord, type AbsCallRecord, type AbsFnImpl,
  type AbsModuleExports, type AbsSigImpl, type AstEnv,
  type BAbsAssignRecord, type BCallRecord, type BClassSpec,
  type BPathFallback, type CheckAction, type CheckIssue, type CheckJson,
  type CheckJsonMulti, type CheckOptions, type CheckReport,
  type Confidence, type ConstraintBuilder, DEFAULT_MAX_LOOP_ITERS,
  type Diagnostic, type EffectiveInterface, type EffectiveInterfaceOpts,
  type ExtState, type FnAbs, type FormalParam, type FormatOptions,
  type GitlabCodeQualityIssue, type HofCollectCtx, type HofSite,
  type ImplicationOracle, type InterfaceDiag, type InterfaceSource,
  type InterfaceTierInfo, type InterfaceTierOpts, type LeqResult,
  type LiteralValue, MAX_B_CALL_DEPTH, MAX_B_TOTAL_CALLS, type NamedImport,
  type NudoConstraint, type NudoField, type NudoFnConstraint,
  NudoLoopSignal, NudoReturn, NudoSidecarError, type NudoSig, NudoThrow,
  NudoUnsupportedError, OBJECT_PROTO_METHOD_NAMES, type ObjShape, type Phi,
  type PolyFn, type Pred, type PrimName, type PropFlags, RUNTIME_IMPORT_RE,
  type RefineDiag, type RefineEntry, type RefineResolveOpts,
  type RelSource, type RunTranspiledOptions, SELF, type Shape, type Slot,
  TYPEOF_NAMES, type Term, type TranspileOptions,
  type TranspiledCallResult, type TypeParam, type TypeofName, abs,
  absFunction, absShapeKey, absToConstraint, absToString, actionsForIssue,
  add, alphaOf, and, andC, any, anyAbs, anyVar, app, applyCallbackAbs,
  applyCallbackValue, array, asAbs, asAbsVal, assignSourceSlots,
  attachFnImpl, beginCollectionFork, betaOf, bigintLit, bindImports,
  bindingsOf, bitandAbs, bitnotAbs, bitorAbs, bitxorAbs, bool, boolLit,
  boolean, buildArgsFromAssume, builtinCtorAbs, builtinCtorNameOf,
  callAbsMethod, callAtFunctionBoundary, callTranspiledExport,
  callTranspiledExportFull, canonicalArrayIndex, checkArg, checkCall,
  checkSource, clearBClasses, clearCollectionTables, clearStaleTermPred,
  cmp, collectAbsExports, collectAbsFreeVars, collectionElementJoin,
  collectionExactLen, confJoin, constraintToEntryAbs, contractParamNameSet,
  createHofCollectCtx, ctorArgDefinitelyInvalid, ctorNameOfRecv,
  currentExecPhi, currentPhi, definitelyNotNullishShape, describePhi, div,
  drainPromiseMicros, effectiveInterface, emptyEnv, emptyPhi,
  endCollectionFork, enterPromiseExecutorScope, eq, errorBrandAbs,
  evalArrayStatic, evalBuiltinInstanceMethod, evalBuiltinNew, evalDateCtor,
  evalDateMethod, evalDateStatic, evalExprAbs, evalGlobalFn,
  evalJsonMethod, evalMathMethod, evalNamespaceCall, evalNumberStatic,
  evalObjectMethod, evalObjectProtoMethod, evalPromiseCtor,
  evalPromiseMethod, evalPromiseStatic, evalRegExpCtor, evalRegExpMethod,
  evalStringStatic, evalSymbolCtor, evictCheckSourceMemoForPaths,
  evictGeneralizeMemoForPaths, execNudoModule, extStateOf,
  extractDeclaredThrows, extractFn, extractNudoImports,
  extractRefineReturnFromSource, extractRefinesFromSource, falseConstraint,
  fillTuple, fn, fnConstraintToEntryReqs, fnOf, foldRequireSpecArg,
  foldStaticStringExpr, formalParamDisplayNames, formalParamsFromNodes,
  formatAbs, formatAbsMultiline, formatCheckReport, formatConstraint,
  formatDiagnostics, formatEffectiveInterfaceDisplay,
  formatGithubAnnotations, formatGitlabCodeQuality,
  formatInterfaceTierLine, formatShape, formatShapeSlot, ge, geNum,
  generalizeAll, generalizeFromAst, generatedExportNames, getAbsProperty,
  getBCallCollector, getBClass, getFnImpl, getGeneralizeMemoSize,
  getImplicationOracle, getPropFlags, getSlot,
  getTerm, gt, gtNum, hostBuiltinCtorName, implies, instantiateConstraint,
  instantiateReturn, interfaceDiagCount, interfaceSourceOf,
  interfaceTierOf, isArrMutator, isBigPrim, isDefinitelyFalse,
  isDefinitelyTrue, isErrorCtorName, isExactLit, isIntFlag, isMapAbs,
  isNodeModulesPath, isNudoBreak, isNudoConstraint, isNudoContinue,
  isNudoReturn, isNudoThrow, isNullProtoObj, isNullishLitAbs, isNumPrim,
  isObj, isObjectProtoBrand, isRelFn, isSetAbs, isStrPrim, isSymbolAbs,
  joinAbs, joinFunctions, joinObjects, joinThenProject, joinValues, le,
  leNum, leavePromiseExecutorScope, lenTerm, leqAbs, listFunctionNames,
  lit, litC, litTruth, litValue, literalMeetsConstraint, localNamedExports,
  locateContractParam, lookupObjAccessor, looseEqAbs, lt, ltNum,
  makeArrayCtorAbs, makeMapAbs, makeSetAbs, makeSum, makeSymbolAbs,
  mapClearEntries, mapDeleteEntry, mapElementFallback, mapEntriesAbs,
  mapGetEntry, mapHasEntry, mapSetEntry, mapSizeAbs, mapValuesAbs,
  markExtState, markNullProtoObj, markPureFn, matchRelIdentLit,
  mergeCollectionArms, migrateInvariants, migrateNullProto, mod, mul,
  namespaceNameOf, ne, negAbs, negatePred, never, not, notAbs,
  noteBCallRecord, noteBPathFallback, noteCollectionWrite,
  notePromiseExecutorFork, num, numLit, numVar, number, obj, objOf,
  objectProtoBrand, objectProtoMethodAbs, omit, or, pFalse, pTrue,
  partial, phiAnd, pick, popCollectionArm, popPhi, powAbs,
  predEquals, predToString, predVars, primToTypeof, projectFlatMapResult,
  promoteParamShape, protoBrandAbs, protoOfRecv, ptypeof, pureFnNameOf,
  pushCollectionArm, pushLoopExit, pushPhi, pushThrowExit,
  queuePromiseMicro, refineAbsForRelTrue, refineDiagCount,
  refineToIndexedFull, regexBrandAbsFrom, registerBClass,
  relationFingerprint, relationFn, requiredFnArity, resetBCallBudget,
  resetCheckSourceMemo, resetGeneralizeMemo, resetNudoModuleExecCache,
  resetPhi, runTranspiled,
  runTranspiledOptionsMemoKey, runWithLoopExits, runtimeImportOf,
  serializeCheckJson, serializeCheckJsonMulti, setAddEntry,
  setApplyCallbackHost, setBAssignCollector, setBBindingSink,
  setBCallCollector, setBPathFallbackCollector, setClearEntries,
  setDeleteEntry, setElementsAbs, setHasEntry, setImplicationOracle,
  setInterfaceDiagCollector, setPropFlags, setRefineDiagCollector,
  setSizeAbs, shape, shapeOfTerm, shapeOnlyFn, shapeToString, shlAbs,
  shrAbs, sidecarClosureFingerprint, sidecarPathOf, simplifyTerm,
  snapshotAbs, spread, str, strLit, strictEqAbs, string, stringOfSymbol,
  sub, substAbs, substPred, substPredAbs, symbolDescriptionAbs, symbolIdOf,
  takeInterfaceDiags, takeInterfaceDiagsSince, takeLoopExits,
  takeRefineDiags, takeRefineDiagsSince, takeThrowExits, termEquals,
  termToString, throwConstraintToKinds, toNumberAbs, transpile,
  transpileBodyNode, transpileExpression, transpileFile, transpileSource,
  trueConstraint, tryMakeRegexAbs, tryPromoteDirectCall,
  tryPromoteForOfIteratee, tryPromoteHofCallback, tryPromoteReceiverAsArr,
  tryRunTranspiled, typeofAbs, undefAbs, union, unknown, ushrAbs, v,
  withExecPhi, withPhiConstraint, withVar
} from "./algebra/index.ts";

