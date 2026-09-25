/**
 * Abs 侧常用 builtin：shape 级运算，不依赖 TypeValue host 库。
 * 覆盖 Math / Object / JSON / Number / 全局转换函数的常见面。
 *
 * 实现按 API 域拆在 builtins/*.ts；本文件是 re-export facade，
 * 对外符号面保持不变（algebra/index.ts `export * from "./builtins.ts"`）。
 */
export {
  type ExtState,
  type PropFlags,
  markExtState,
  extStateOf,
  getPropFlags,
  setPropFlags,
  migrateInvariants,
} from "./builtins/invariants.ts";
export { evalMathMethod } from "./builtins/math.ts";
export { assignSourceSlots, evalObjectMethod } from "./builtins/object.ts";
export { evalJsonMethod } from "./builtins/json.ts";
export { evalNumberStatic } from "./builtins/number.ts";
export { evalGlobalFn } from "./builtins/global.ts";
export { makeArrayCtorAbs, evalArrayStatic } from "./builtins/array.ts";
export { evalDateCtor, evalDateStatic, evalDateMethod } from "./builtins/date.ts";
export {
  evalRegExpCtor,
  regexBrandAbsFrom,
  tryMakeRegexAbs,
  evalRegExpMethod,
} from "./builtins/regexp.ts";
export {
  builtinCtorAbs,
  builtinCtorNameOf,
  hostBuiltinCtorName,
  ctorNameOfRecv,
  protoBrandAbs,
  protoOfRecv,
} from "./builtins/ctor.ts";
export {
  enterPromiseExecutorScope,
  leavePromiseExecutorScope,
  notePromiseExecutorFork,
  queuePromiseMicro,
  drainPromiseMicros,
  evalPromiseCtor,
  evalPromiseMethod,
  evalPromiseStatic,
} from "./builtins/promise.ts";
export {
  evalNamespaceCall,
  isErrorCtorName,
  errorBrandAbs,
  evalBuiltinNew,
  evalBuiltinInstanceMethod,
} from "./builtins/error.ts";
export { evalStringStatic } from "./builtins/string.ts";
export {
  makeSymbolAbs,
  isSymbolAbs,
  evalSymbolCtor,
  stringOfSymbol,
  symbolIdOf,
  symbolDescriptionAbs,
} from "./builtins/symbol.ts";
export {
  OBJECT_PROTO_METHOD_NAMES,
  objectProtoBrand,
  isObjectProtoBrand,
} from "./builtins/ctor.ts";
export {
  evalObjectProtoMethod,
  objectProtoMethodAbs,
} from "./builtins/object-proto.ts";
