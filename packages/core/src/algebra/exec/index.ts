// Explicit re-exports only — do not add export *. New symbols → @nudojs/core/internal
// or an explicit list reviewed with PUBLIC_API.md + public-api.snapshot.json.

export {
  $add, $absVal, $arguments, $arr, $arrMutContainer, $arrRest, $arrWithHoles, $restBind,
  $assumeAnchor,
  $async, $await, $bitand, $bitnot, $bitor, $bitxor,
  $catchReturn, $catchVal, $classExpr, $collectionForEach, $concat, $copy, $del, $delRes,
  $div, $dynamicImport, $elems, $eq, $eqLoose, $fnKindStamp, $fnVal, $for, $forInKeys,
  $forOf, $fork, $ge, $gen, $get, $gt, $idx, $idxSet, $iterCheck,
  $importMeta, $in, $instanceof, $instanceofNonIdent, $isBreakTo,
  $isForkExit, $join, $le, $len, $lit, $litTruth, $loopBreak, $loopContinue,
  $loopReturn, $lt, $mod, $mul, $ne, $neLoose, $neg, $narrowMemberEq, $narrowTypeOf, $not, $nullishTest, $newTarget,
  $obj, $objAccessor, $objAccessorKey, $objRest, $pow, $pushLoopExit, $rawThis, $regex, $refineRel,
  $removeMemberNullish, $removeNull, $removeNullish, $removeUndefined, $rethrowIfNudoReturn, $set, $setProto, $shl, $shr, $spread, $sub, $switch, $throw,
  $throwConstAssign, $throwFreeArguments,
  $toNumber, $toNumeric, $toStr, $tpl, $updateAdd, $updateSub, $tryCurrentMark, $tryDetachSoftCatch, $tryDigestSoftCatch,
  $tryDiscardSoft, $tryMark, $tryOrphanSoft, $tryPopMark,
  $tryReleaseSoftCatch, $tryReleaseSoftOut, $tryTakeSince, $typeof,
  $unknown, $ushr, $whileSeq, $yield, $yieldStar, DEFAULT_MAX_LOOP_ITERS,
  NudoLoopSignal, NudoReturn, NudoThrow, asAbsVal, callAtFunctionBoundary,
  clearStaleTermPred, currentAssumePremises, currentExecPhi, fillTuple,
  isArrMutator,
  isDefinitelyFalse, isDefinitelyTrue, isNudoBreak, isNudoContinue,
  isNudoReturn, isNudoThrow, litTruth, lookupObjAccessor, namespaceNameOf,
  pushLoopExit, pushThrowExit, runWithLoopExits, takeLoopExits,
  takeThrowExits, withAssumePremises, withExecPhi
} from "./runtime.ts";

// Bug 201：async 体的生成器驱动。转译产物按名 import `$asyncGen`，因此它
// 必须能从 `@nudojs/core/exec` 具名导入——否则 transpileSource 产物作为
// 真实 ESM 装载时缺符号。runtime.ts facade 刻意不含它（facade 只再导出
// 既有公开面），此处直接给具名导出，不进 other subpath。
export { $asyncGen } from "./runtime/async.ts";

export {
  type TranspileOptions, foldRequireSpecArg, foldStaticStringExpr,
  runtimeImportOf, transpile, transpileBodyNode, transpileExpression,
  transpileFile, transpileSource
} from "./transpile.ts";

export {
  $call, clearPureMemo, routeApplyThrows
} from "./call.ts";

export {
  $class, $invoke, $invokeKey, $optionalInvokeKey, $invokeSuper, $invokeSuperObj, $new, $optionalGet, $optionalInvoke,
  $orDefault, $reStateCall, $setKey, $invokeSuperKey, $super, $getSuper,
  $getSuperObj, $setSuper, $setSuperObj, $setSuperStatic, $staticSuperInvoke,
  type EvalClassSpec, clearBClasses, getEvalClass, registerEvalClass
} from "./class.ts";

export {
  $assignRecord, $callNamed, $recordBinding, type EvalAbsAssignRecord,
  type EvalCallRecord, MAX_EVAL_CALL_DEPTH, MAX_EVAL_TOTAL_CALLS, clearPureCallMemo,
  getEvalCallBudgetState,
  getEvalCallCollector, enterEvalCallBudgetSession, exitEvalCallBudgetSession,
  noteEvalCallRecord, resetEvalCallBudget, setEvalAssignCollector, setEvalBindingSink,
  setEvalCallCollector, withEvalBudgetOverride,
  $nodoPos, setPosCollector, getPosCollector, type EvalPosRecord
} from "./calls.ts";

export {
  type EvalFallback, type EvalFallbackStats, RUNTIME_IMPORT_RE, type RunTranspiledOptions,
  type TranspiledCallResult, bindingsOf, callTranspiledExport,
  callTranspiledExportApply, callTranspiledExportFull, evalExprAbs, getEvalFallbackStats, isAbsVal, noteEvalFallback,
  resetEvalFallbackStats, runTranspiled,
  runTranspiledOptionsMemoKey, setEvalFallbackCollector, tryRunTranspiled,
  isCjsMainRun
} from "./run.ts";

export {
  NudoUnsupportedError
} from "./unsupported.ts";

// may-throw collectors live in @nudojs/core/internal (host plumbing, not $op runtime)
