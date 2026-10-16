/**
 * Error 家族 + evalBuiltinNew / evalBuiltinInstanceMethod + 命名空间分派
 * （facade 保持原导入面不变）。
 *
 * 按域拆分：
 * - namespace    命名空间静态分派总入口（Map.groupBy/URL.canParse/
 *                ArrayBuffer.isView/BigInt.asIntN·asUintN）
 * - error-family Error 家族 brand/构造 + 宿主构造器实参校验谓词（prim 成员/
 *                nullish 字面量/CanBeHeldWeakly 弱键）+ Proxy
 * - binary       ArrayBuffer/SAB/DataView/TypedArray 构造与 ToIndex 机制 +
 *                TA from/of 静态面 + set-like 实参校验
 * - web          URL / TextDecoder / URLSearchParams
 * - boxed        Number/String/Boolean 装箱 brand（[[PrimitiveValue]] 槽）
 * - intl         Intl.NumberFormat/DateTimeFormat 子构造器（BCP47 校验）
 * - misc-ctor    动态 Function / WeakRef / FinalizationRegistry
 * - iterator     Map/Set/Array 集合迭代器协议对象
 * - dispatch     evalBuiltinNew / evalBuiltinInstanceMethod 总分派 +
 *                DataView/TA 实例方法族
 */
export { evalNamespaceCall } from "./error/namespace.ts";
export {
  isErrorCtorName,
  errorBrandAbs,
  sumHasPrimMember,
  makeProxyAbs,
} from "./error/error-family.ts";
export {
  makeArrayBufferAbs,
  makeSharedArrayBufferAbs,
  makeDataViewAbs,
  makeTypedArrayAbs,
  evalTypedArrayStatic,
} from "./error/binary.ts";
export {
  makeUrlAbs,
  makeTextDecoderAbs,
  makeUrlSearchParamsAbs,
} from "./error/web.ts";
export {
  noteBoxedCtorArg,
  BOXED_PRIMITIVE_SLOT,
  makeBoxedAbs,
  boxedPrimitiveValue,
} from "./error/boxed.ts";
export {
  makeIntlCtorAbs,
  makeIntlFormatAbs,
  type IntlSubCtor,
} from "./error/intl.ts";
export {
  makeDynamicFunctionAbs,
  makeWeakRefAbs,
  makeFinalizationRegistryAbs,
} from "./error/misc-ctor.ts";
export {
  collectionIteratorAbs,
  abstractSeqIteratorAbs,
} from "./error/iterator.ts";
export {
  evalBuiltinNew,
  evalBuiltinInstanceMethod,
} from "./error/dispatch.ts";
