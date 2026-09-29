// Explicit re-exports only — do not add export *. New symbols → @nudojs/core/internal
// or an explicit list reviewed with PUBLIC_API.md + public-api.snapshot.json.

export {
  $add, $arguments, $arr, $arrMutContainer, $arrRest, $arrWithHoles,
  $async, $asyncReturn, $await, $bitand, $bitnot, $bitor, $bitxor,
  $catchVal, $classExpr, $collectionForEach, $concat, $copy, $del, $delRes,
  $div, $dynamicImport, $elems, $eq, $eqLoose, $fnVal, $for, $forInKeys,
  $forIter, $forOf, $fork, $ge, $gen, $get, $gt, $idx, $idxSet,
  $importMeta, $in, $instanceof, $instanceofNonIdent, $isBreakTo,
  $isForkExit, $join, $le, $len, $lit, $loopBreak, $loopContinue,
  $loopReturn, $lt, $mod, $mul, $ne, $neLoose, $neg, $not, $nullishTest,
  $obj, $objAccessor, $objRest, $pow, $pushLoopExit, $rawThis, $regex,
  $rethrowIfNudoReturn, $set, $setProto, $shl, $shr, $spread, $sub, $switch, $throw,
  $toNumber, $toNumeric, $updateAdd, $updateSub, $tryCurrentMark, $tryDetachSoftCatch, $tryDigestSoftCatch,
  $tryDiscardSoft, $tryMark, $tryOrphanSoft, $tryPopMark,
  $tryReleaseSoftCatch, $tryReleaseSoftOut, $tryTakeSince, $typeof,
  $unknown, $ushr, $while, $whileSeq, $yield, DEFAULT_MAX_LOOP_ITERS,
  NudoLoopSignal, NudoReturn, NudoThrow, asAbsVal, callAtFunctionBoundary,
  clearStaleTermPred, currentExecPhi, fillTuple, isArrMutator,
  isDefinitelyFalse, isDefinitelyTrue, isNudoBreak, isNudoContinue,
  isNudoReturn, isNudoThrow, litTruth, lookupObjAccessor, namespaceNameOf,
  pushLoopExit, pushThrowExit, runWithLoopExits, takeLoopExits,
  takeThrowExits, withExecPhi
} from "./runtime.ts";

export {
  type TranspileOptions, foldRequireSpecArg, foldStaticStringExpr,
  runtimeImportOf, transpile, transpileBodyNode, transpileExpression,
  transpileFile, transpileSource
} from "./transpile.ts";

export {
  $call
} from "./call.ts";

export {
  $class, $invoke, $invokeSuper, $new, $optionalGet, $optionalInvoke,
  $orDefault, $reStateCall, $setKey, $staticInvoke, $super, $thisGet,
  $thisSet, type EvalClassSpec, clearBClasses, getEvalClass, registerEvalClass
} from "./class.ts";

export {
  $assignRecord, $callNamed, $recordBinding, type EvalAbsAssignRecord,
  type EvalCallRecord, MAX_EVAL_CALL_DEPTH, MAX_EVAL_TOTAL_CALLS, getEvalCallBudgetState,
  getEvalCallCollector, enterEvalCallBudgetSession, exitEvalCallBudgetSession,
  noteEvalCallRecord, resetEvalCallBudget, setEvalAssignCollector, setEvalBindingSink,
  setEvalCallCollector, withEvalBudgetOverride
} from "./calls.ts";

export {
  type EvalFallback, type EvalFallbackStats, RUNTIME_IMPORT_RE, type RunTranspiledOptions,
  type TranspiledCallResult, bindingsOf, callTranspiledExport,
  callTranspiledExportFull, evalExprAbs, getEvalFallbackStats, noteEvalFallback,
  resetEvalFallbackStats, runTranspiled,
  runTranspiledOptionsMemoKey, setEvalFallbackCollector, tryRunTranspiled
} from "./run.ts";

export {
  NudoUnsupportedError
} from "./unsupported.ts";

// may-throw collectors live in @nudojs/core/internal (host plumbing, not $op runtime)
