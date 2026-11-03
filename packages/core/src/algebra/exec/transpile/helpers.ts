/**
 * transpile 共享 AST 工具 — **facade barrel**：实现按域拆在 ./helper/ 叶文件
 * （param-face=函数节点静态面、directive-match=@nudo:as/replace 匹配、
 * static-fold=静态折叠/键计算、scope-collect=作用域收集、tmp-names=临时名/
 * this 载体/语句发射状态）。本文件只做 re-export——既有 import 面
 * `"./helpers.ts"` / `"../helpers.ts"` 零改动。
 *
 * 分层约束（新增代码先读这里）：
 * - 叶文件只 import types.ts / ops.ts / intrinsics.ts / member-key.ts 等既有
 *   叶子与包内基础模块（param-surface / lru-map / unsupported /
 *   transpile-dispatch），**不得 import 本 facade、不得互相 import**——
 *   跨域调用的函数必须合入同一叶；
 * - 模块级可变状态各归唯一叶：fnFacetsCache（param-face）、replacingNodes
 *   （directive-match）、constFnScopeTable / freeAssignedCache /
 *   mutatorRecvCache（scope-collect）、userIdentCache / DEFAULT_STMT_EMIT
 *   （tmp-names）——分裂成两份会让缓存 / 计数器各自为政（同源不同产物）。
 */
export {
  paramDisplayNames,
  paramOptionalFlags,
  nativeParamArity,
  fnKindSrc,
  fnKindOf,
  methodBindNames,
  finalizerBits,
  fnBodyHasThis,
  fnBodyHasOwnArguments,
  fnBodyIsEffectFree,
  getFnFacets,
  fnBodyIsClosed,
} from "./helper/param-face.ts";
export type {
  FnFacets,
} from "./helper/param-face.ts";

export {
  matchAsOverride,
  normWs,
  matchReplacement,
} from "./helper/directive-match.ts";

export {
  indent,
  litToStringOf,
  foldStaticStringExpr,
  foldRequireSpecArg,
  staticKeyOf,
  symbolKeyOf,
  isExpression,
  privateNameKeyOf,
  privateNameKeySrc,
  withClassNameHint,
} from "./helper/static-fold.ts";

export {
  collectAssignedIds,
  FUNCTION_SCOPE_TYPES,
  collectPatternNames,
  collectDeclaredBindingNames,
  shadowedIntrinsicsOf,
  collectVarHoistNames,
  collectExportVarNames,
  collectLoopBodyTopLevelDeclNames,
  computeConstScope,
  copyConstScope,
  registerConstFnScope,
  constFnNamesOf,
  isConstAssignTarget,
  freeAssignedCache,
  mutatorRecvCache,
  collectFreeAssignedNames,
  collectForkBindingNames,
  collectScopeShadowNames,
  leadingConstAliasGroups,
  filterAliasGroups,
  mergeAliasGroups,
  expandAliasNames,
  collectArrMutatorReceiversUncached,
  collectArrMutatorReceivers,
} from "./helper/scope-collect.ts";
export type {
  IdentNode,
} from "./helper/scope-collect.ts";

export {
  userIdentInfo,
  bumpDestrTmpSeq,
  tmpSeqMaxOf,
  userIdentInfoOf,
  safeTmpName,
  internalTmpName,
  thisCarrierOf,
  internalTmpNameSet,
  newStmtEmitState,
  stmtEmitStateOf,
} from "./helper/tmp-names.ts";
export type {
  UserIdentInfo,
} from "./helper/tmp-names.ts";
