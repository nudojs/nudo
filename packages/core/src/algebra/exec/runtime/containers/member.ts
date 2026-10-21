/**
 * 成员读写与派发：$get/$set + 命名空间身份路由 + 原型方法值读。
 *
 * Invariants:
 * - protoMethodDispatch 是 `var`（非 let）：exec/class 模块加载期经循环
 *   import 回调 setProtoMethodDispatch 时提升为 undefined 也安全（let
 *   会 TDZ 崩加载序）。
 * - 类方法一等值按（定义类 spec, kind, 键）驻留：同条目重复读返回同一
 *   Abs 引用（=== 折 true）；跨 run last-wins 重注册换新 spec 对象，
 *   驻留随旧 spec 回收失效。
 * - 闭 shape 字面量 key miss → 精确 undefined（键确定不存在）；open
 *   shape / 抽象键 → 并 unknown（键可能存在）；已知原型访问器名槽面
 *   未建模 → 诚实 unknown（不得 wrong-exact undefined）。
 * - Bug 149：符号投影键（"[Symbol.X]" → "@@X"）在 **Proxy 陷阱边界**还原成
 *   真 symbol（规范 PropertyKey）；字面量串键 "@@X" 不带标记，仍是字符串键。
 * - Bug 218：prim（number/boolean/bigint/symbol）读**确定不存在**的成员 →
 *   undefined 字面量（原生语义），不是 unknown——unknown 接收者不记
 *   may-throw，会让后续读该值的 TypeError 丢失（L2 门禁假绿）。
 * - Bug 219：symbol prim 的 toString/toLocaleString/valueOf 走
 *   **Symbol.prototype 自己的面**（toString/valueOf 带 brand check——
 *   借用调用非 symbol 接收者定抛 TypeError），不落 Object.prototype 泛型版。
 * - Bug 206/225：类值写面的两个原生「不可写」——`A.prototype = v` 与
 *   getter-only 静态访问器的写，都定抛 strict TypeError（例外：引擎内部
 *   defineProperty 对原型的就地改写回装）。
 * - Bug 234：类值的 `constructor` = 内建 Function（原生继承自
 *   Function.prototype），不是「以类名命名的内建构造器」。
 * - Bug 235：Proxy 无 get 陷阱时转发 `target.[[Get]](key, Receiver)`——
 *   Receiver 必须是 proxy 自己（靶上 getter 的 this = receiver，不是靶）。
 * - Bug 210：Proxy **get 陷阱**返回值过 [[Get]] 规范不变量（state.ts 的
 *   enforceProxyGetInvariant）——靶上自有属性不可配置且不可写时，陷阱值
 *   须 SameValue 靶值，否则原生定抛 TypeError（此前直接返陷阱值，假绿）。
 * - Bug 209：Proxy **set 陷阱**返回值按规范 ToBoolean 判定——falsy（0 / "" /
 *   null / undefined / false）→ strict TypeError（只认字面量 false 会漏）。
 * - Bug 197：[[Set]] 写门——receiver **无自有该键**时沿 [[Prototype]] 链
 *   上溯（OrdinarySet）：访问器（无 setter）→ strict TypeError；带 setter
 *   → 派发 setter；数据属性 writable:false / frozen 原型 → strict
 *   TypeError；链上无人持该键 → receiver 建自有属性。fn 臂 / 静态类值臂 /
 *   数组下标臂另查 defineProperty 的 writable:false（见 proto-set.ts）。
 *   **类实例面**同走该门（原型 = `A.prototype`，proto-set.ts 经
 *   protoOfRecv 解析类注册表）——此前类实例未登记 protoTable ⇒ 门恒 allow
 *   ⇒ 原型上动态装的只读属性 / getter-only 被静默写穿。
 * - Bug 223/231：数组 length 写门——域判定走 ToNumber（具体非数值
 *   undefined / {} / "abc" 定抛 RangeError，Symbol 抛 TypeError）；sealed
 *   数组 length **截断**写要删不可配置元素 → strict TypeError（增长合法；
 *   preventExtensions 不冻结元素 → 截断不抛）。见 array-length.ts。
 * - Bug 198（S20）：内建 brand 实例上的 `@@iterator` 读值 = **原型上同一个
 *   函数对象**（原生 m[Symbol.iterator] === Map.prototype[Symbol.iterator]）
 *   ⇒ 走符号成员表（builtinSymbolMemberAbs），不得给 no-op fn——no-op fn 被
 *   调用折 <abs:never>（自信的错值：原生返回集合迭代器）。Map/Set 的该成员
 *   产出 **live 视图**集合迭代器（collectionIteratorFor），投影口径同原生：
 *   Map → [k,v] 元组（entries），Set → 元素本身（values，非 [el,el]）。
 * - Bug 291：fn 臂的**不变性写门**与 obj 臂同款——frozen 全写 strict
 *   TypeError；sealed/nonext 新键 TypeError（函数亦是不可扩展对象）。
 * - Bug 315：本模块向 builtins/object-proto.ts 注册**接收者 toString 解析
 *   钩子**（Object.prototype.toLocaleString 委派 this.toString()）——注册式
 *   注入断开 builtins↔exec 的 import 环（同 protoMethodDispatch 口径）。
 * - Bug 325：fn impl 的 kind 值域含 "async-generator"（与 "generator" 同有
 *   原生 prototype）——prototype 面读该戳。
 */
import type { Abs } from "../../../abs.ts";
import { abs, boolLit, confJoin, litValue, numLit, str, strLit, unknown } from "../../../abs.ts";
import { lit } from "../../../term.ts";
import { absFunction, hostFnCtorFacet, getFnImpl } from "../../../abs-fn.ts";
import {
  joinAbs,
  isObj,
  objOf,
  type ObjShape,
  type Slot,
  isNullProtoObj,
  getSlot,
  setSlot,
  canonicalArrayIndex,
} from "../../../objects.ts";
import {
  mapSizeAbs,
  setSizeAbs,
} from "../../../collections.ts";
import { TUPLE_MATERIALIZE_CAP } from "../../../containers.ts";
import { TYPED_ARRAY_ELEMENT } from "../../../builtins/shared.ts";
import { proxyPartsOf, proxyTrapOf } from "../../match-iter.ts";
import {
  evalNamespaceCall,
  extStateOf,
  getPropFlags,
  setPropFlags,
  regexBrandAbsFrom,
  objectProtoMethodAbs,
  isObjectProtoBrand,
  OBJECT_PROTO_METHOD_NAMES,
  isSymbolAbs,
  symbolDescriptionAbs,
  stringOfSymbol,
  evalObjectProtoMethod,
  objectProtoBrand,
  builtinCtorAbs,
  ctorNameOfRecv,
  protoBrandAbs,
  protoOfRecv,
  functionProtoAbs,
  collectionIteratorAbs,
  makeIntlCtorAbs,
} from "../../../builtins.ts";
import { arrayMethodAbs } from "../../../builtins/array.ts";
// Bug 315：接收者 toString 解析钩子注册（直连 builtins/object-proto.ts，
// 不经 barrel——barrel 未导出该注册函数，且本分片不改 barrel；同下方
// collectionIteratorFor / isMatchArrayView 的直连口径）。
import { setReceiverToStringResolver } from "../../../builtins/object-proto.ts";
// Bug 198（S20）：集合迭代器的 **live 视图** 构造器（collectionIteratorFor）——
// 直连 builtins/error/iterator.ts，不经 barrel（与 iterate.ts 同款口径；barrel
// 未导出该函数，且本分片不改 barrel）。
import { collectionIteratorFor } from "../../../builtins/error/iterator.ts";
import { urlSearchParamsSizeAbs } from "../../../builtins/error/web.ts";
// Bug 195：数组视图标注（模板对象 / RegExp exec 结果——原生都是**数组 exotic**）
// 判身份；直连 builtins/regexp.ts 不经 barrel（与 iterate.ts 同款口径）。
import { isMatchArrayView } from "../../../builtins/regexp.ts";
import {
  noteUnknownMemberMissing,
  noteObjSlotMissing,
  noteAnyMemberMayThrow,
  noteNullishMemberThrows,
  isNullishAbs,
  anyMemberResult,
  STRING_METHODS,
  NUMBER_PROTO_METHODS,
  BOOLEAN_PROTO_METHODS,
  SYMBOL_PROTO_METHODS,
  BIGINT_PROTO_METHODS,
  ARRAY_PROTO_METHOD_NAMES,
  OBJECT_PROTO_NAMES,
} from "../../member-diag.ts";
import { errorTypeAbs, recordMayThrow } from "../../may-throw.ts";
import { getEvalClass, lookupClassValue, fnProtoOf, type EvalClassSpec } from "../../class-registry.ts";
import { classNameOfValue, markClassValue } from "../../../class-mark.ts";
import { markFreshInstance, freshInstanceIdOf } from "../../../instance-id.ts";
import {
  NudoThrow,
  undef,
  isOobUndef,
  throwStrictWrite,
  clearStaleTermPred,
  asAbsVal,
  $lit,
  $fnVal,
  noBody,
  enforceProxyGetInvariant,
} from "../state.ts";
import { $typeof } from "../ops.ts";
import { symbolAbsForSlotKey, hostSymbolForSlotKey } from "../symbol-key.ts";
import { findClassAccessor, findStaticClassAccessor, $in, BUILTIN_BRAND_METHODS, BUILTIN_BRAND_ACCESSORS, ITERABLE_BRANDS, evalClassChain, builtinSuperCtorOf, chainProtoSlotOf, classChainHasHole, chainHasOpaqueFnParent, openIndexValueOf } from "../members.ts";
import { protoChainSetVerdict } from "../proto-set.ts";
import { lengthToNumber } from "../array-length.ts";
import { lookupObjAccessor } from "../../../accessors.ts";
import { $call } from "../../call.ts";
import { privateNameGuard, $setProto } from "./obj.ts";
import { widenTupleToArr } from "./arr-make.ts";
import { $len } from "./arr-index.ts";

/**
 * Bug 90：spec 记录读点的 own-property 判定——spec.methods[key] 等原型链
 * 取值会把宿主 Object.prototype 继承名（constructor/toString/__proto__…）
 * 当类成员值读（c.constructor === C 折假 false 的根因之一）。registry 记录
 * 已在 declare.$class 统一换 null 原型容器；此处双保险覆盖手写/mock spec
 * 注册面。
 */
function ownRecValue<T>(rec: Record<string, T> | undefined, key: string): T | undefined {
  return rec !== undefined && Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/**
 * 命名空间身份表：transpile 后 `Math.max(0, x)` 的接收者是宿主 JS 全局对象
 * （非 Abs）。按对象身份识别命名空间，路由到 Abs builtin 表。
 *
 * 表内名字与 transpile/intrinsics.ts 的 ENV_SHADOW_SKIP_GLOBALS（去
 * HOST_INTRINSIC_NAMES 后）1:1 手工同步：路由名必须 env-skip（否则注入遮蔽
 * 身份路由，issue #87），skip 名必须有路由收益（否则用户代码退化）。
 * parity 由 __tests__/env-shadow-parity.test.ts 钉住。
 */
export const NAMESPACE_GLOBALS: ReadonlyArray<readonly [string, unknown]> = [
  ["Math", Math],
  ["Number", Number],
  ["JSON", JSON],
  ["Object", Object],
  ["Array", Array],
  ["String", String],
  ["Date", Date],
  ["Promise", Promise],
  ["BigInt", BigInt],
  // Bug 19/43：此前缺项 → Reflect.get(1,"a") / Symbol.for(Symbol()) 折
  // unknown + throws=never（原生 TypeError 定抛被吞）
  ["Reflect", Reflect],
  ["Symbol", Symbol],
  // Bug 24：URL 静态面（canParse）派发——URL.canParse 折 unknown 的根因
  // 是 URL 不在身份路由表（构造面 new URL 经 clsName 派发不受影响）
  ["URL", URL],
  // Bug 56：X.prototype.<method> 值读——Map/Set/WeakMap/WeakSet/Boolean 的
  // prototype 成员读此前落宿主 unknown（.method 级联假 undefined + .call
  // 假 TypeError）；入表后 $get(ns, "prototype") → protoBrandAbs，
  // 原型方法表派发（Map.prototype.has.call(m, k) 等）
  ["Map", Map],
  ["Set", Set],
  ["WeakMap", WeakMap],
  ["WeakSet", WeakSet],
  ["Boolean", Boolean],
  ["RegExp", RegExp],
  ["Error", Error],
  // Bug 68：Error 家族七子类进路由表——`X.prototype` 读走 protoBrandAbs(X)
  //（.constructor === X / X.prototype.toString 借用调用的家族派发），
  // 此前落宿主 fn 通用通道的匿名闭 obj（constructor 假 Object、toString
  // 假派 Object.prototype.toString）
  ["TypeError", TypeError],
  ["RangeError", RangeError],
  ["ReferenceError", ReferenceError],
  ["SyntaxError", SyntaxError],
  ["EvalError", EvalError],
  ["URIError", URIError],
  ["AggregateError", AggregateError],
  // Bug 44：Intl 命名空间身份路由——typeof Intl 折 object（ops.$typeof）、
  // 成员读投影（NumberFormat/DateTimeFormat 为带 locale 校验的构造器值，
  // 其余成员走通用 fn 投影）；入表同时 env-skip（intrinsics 同步）
  ["Intl", Intl],
  // Bug 27：TypedArray 全家（12 家族，TYPED_ARRAY_ELEMENT 单一事实源）——
  // 此前 `Uint8Array.from` 成员读落宿主函数通用通道 → unknown + 零校验；
  // 入表后静态面经 evalNamespaceCall → evalTypedArrayStatic（from 的
  // ToObject / of 的逐项元素转换校验），BYTES_PER_ELEMENT 等常量成员折
  // 宿主真值；构造面 new <TA>(len) 走 clsName 派发（Bug 21）不受影响
  ["Int8Array", Int8Array],
  ["Uint8Array", Uint8Array],
  ["Uint8ClampedArray", Uint8ClampedArray],
  ["Int16Array", Int16Array],
  ["Uint16Array", Uint16Array],
  ["Int32Array", Int32Array],
  ["Uint32Array", Uint32Array],
  // Node <24 无 Float16Array 全局（V8 13.x 引入）；engines 声明 node>=22，
  // 模块级表裸读会让 CLI 在声明下限上启动即 ReferenceError。运行时不存在
  // 该全局时如实不注册（无值可路由，namespaceNameOf 也无对应值可撞）。
  ...(typeof Float16Array !== "undefined" ? ([["Float16Array", Float16Array]] as const) : []),
  ["Float32Array", Float32Array],
  ["Float64Array", Float64Array],
  ["BigInt64Array", BigInt64Array],
  ["BigUint64Array", BigUint64Array],
  // Bug 40：二进制缓冲/视图 + 弱引用家族进路由表——`.prototype` 成员读
  //（typeof ArrayBuffer.prototype.slice / WeakRef.prototype.deref）此前落
  // 宿主 fn 通用通道的空闭 obj → wrong-exact "undefined"；入表后
  // $get(ns,"prototype") → protoBrandAbs，经 BUILTIN_BRAND_METHODS 派发。
  // new X(…) 走 clsName（宿主 fn.name）派发不受影响。
  ["ArrayBuffer", ArrayBuffer],
  ["SharedArrayBuffer", SharedArrayBuffer],
  ["DataView", DataView],
  ["WeakRef", WeakRef],
  ["FinalizationRegistry", FinalizationRegistry],
];

export function namespaceNameOf(v: unknown): string | undefined {
  if (typeof v !== "object" && typeof v !== "function") return undefined;
  for (const [name, host] of NAMESPACE_GLOBALS) {
    if (v === host) return name;
  }
  return undefined;
}

/** 正则字面量 → RegExp brand（source/flags/lastIndex 进 slots，供 exec/test 精确执行） */
export function $regex(pattern: string, flags = ""): Abs {
  return regexBrandAbsFrom(pattern, flags);
}

// ARRAY_PROTO_METHOD_NAMES 已上移 member-diag.ts（$in tuple 臂共用；避免
// members ↔ containers 循环 import）

/** Bug 114：原生带 @@species 静态访问器的内建构造器（Array/Promise/RegExp/
 *  Map/Set/AB/SAB 自有 + TA 全家自 %TypedArray% 继承 getter，node 实测）——
 *  宿主通道按字符串键 "@@species" 裸读是 undefined，须折构造器 fn 面
 *  （typeof "function"）；Date/DataView/WeakMap/Error 等原生 undefined。 */
const BUILTIN_SPECIES_CTORS: ReadonlySet<string> = new Set([
  "Array", "Promise", "RegExp", "Map", "Set", "ArrayBuffer", "SharedArrayBuffer",
  ...Object.keys(TYPED_ARRAY_ELEMENT),
]);

/** Bug 93：宿主 generator 函数判定——真 generator（env 泄漏/内建宿主值，
 *  原型链 constructor 名可判）或 transpile 去种类化的 generator 声明（宿主
 *  体首语句 `return $gen(…)`；async 声明是 `return $async(…)`——两者共享
 *  __nudoNonCtor 标记，按源形区分，漏判安全降级为「无 prototype」旧口径）。 */
function isHostGeneratorFn(v: Function): boolean {
  const protoCtor = Object.getPrototypeOf(v)?.constructor?.name;
  if (protoCtor === "GeneratorFunction" || protoCtor === "AsyncGeneratorFunction") return true;
  if ((v as { __nudoNonCtor?: unknown }).__nudoNonCtor !== 1) return false;
  try {
    return /^\s*(?:export\s+)?function\s*[\w$]*\s*\([^)]*\)\s*\{\s*(?:const\s+[\w$]+\s*=\s*\$restBind\(arguments,\s*\d+\);\s*)?return\s+\$gen\(/.test(String(v));
  } catch {
    return false;
  }
}

/** Bug 93：generator 函数 prototype 的可辨 brand——按宿主 fn 驻留（原生每
 *  fn 唯一共享 prototype）。名不走 ".prototype" 后缀：protoOfRecv 会把该
 *  后缀品牌的 [[Proto]] 折 owner extends / Object.prototype，而 generator
 *  prototype 的 [[Proto]] 是 %GeneratorFunction.prototype%.prototype
 * （`Object.getPrototypeOf(g.prototype) === Object.prototype` 原生 false）。
 *  constructor 无槽 → 折 builtinCtorAbs 面（typeof "function"，
 *  `g.prototype.constructor === g` 折 false——原生 generator prototype 的
 *  constructor 不回指 g）。 */
const genProtoByFn = new WeakMap<object, Abs>();
let genProtoSeq = 0;
function generatorProtoBrandOf(v: Function | Abs): Abs {
  let p = genProtoByFn.get(v as object);
  if (p === undefined) {
    const rawNm = typeof v === "function" ? v.name : (v.shape as { name?: string }).name;
    const nm = typeof rawNm === "string" && rawNm ? rawNm : `anonymous${++genProtoSeq}`;
    p = abs(
      { k: "brand", name: `${nm}.generatorProto`, shape: objOf({}) },
      undefined,
      undefined,
      "exact",
    );
    genProtoByFn.set(v as object, p);
  }
  return p;
}

/** Bug 92：Function.prototype 的 fn 面由 ctor.ts 的 functionProtoAbs()
 *  单一驻留（protoOfRecv 与本处 .prototype 成员读同引用——=== 恒等）。 */

function isPossiblyProtoMemberKey(key: string): boolean {
  return (
    OBJECT_PROTO_METHOD_NAMES.has(key) ||
    ARRAY_PROTO_METHOD_NAMES.has(key) ||
    key === "constructor" ||
    // Bug 17：__proto__ 是 Object.prototype 访问器（读 [[Prototype]]），
    // 不得在 tuple/字符串 prim 的非下标键兑底折 undef
    key === "__proto__" ||
    key.startsWith("@@")
  );
}

/** Bug 49/56：prim 原型专有方法表（值读投影用；String 用 STRING_METHODS
 *  ——与「确定缺失」诊断同源，漏列会误 undef 合法方法值读） */
const PRIM_PROTO_METHOD_NAMES: Record<string, ReadonlySet<string>> = {
  string: STRING_METHODS,
  number: NUMBER_PROTO_METHODS,
  boolean: BOOLEAN_PROTO_METHODS,
  symbol: SYMBOL_PROTO_METHODS,
  bigint: BIGINT_PROTO_METHODS,
};

/** Bug 56：X.prototype.<method> 值读的构造器→方法表（prim 包装构造器 +
 *  内建 brand；用户/未知构造器不在此列——保守落内层 miss）。
 *  brand 臂延迟解析：BUILTIN_BRAND_METHODS 经 members.ts 循环 import，
 *  模块加载期该绑定可能尚未初始化（首用时已必然就绪）。 */
const PROTO_PRIM_METHOD_NAMES: Record<string, ReadonlySet<string>> = {
  Array: ARRAY_PROTO_METHOD_NAMES,
  String: STRING_METHODS,
  Number: NUMBER_PROTO_METHODS,
  Boolean: BOOLEAN_PROTO_METHODS,
  Symbol: SYMBOL_PROTO_METHODS,
  BigInt: BIGINT_PROTO_METHODS,
};

function protoBrandMethodNames(ctorName: string): ReadonlySet<string> | undefined {
  return (
    PROTO_PRIM_METHOD_NAMES[ctorName] ??
    BUILTIN_BRAND_METHODS[ctorName as keyof typeof BUILTIN_BRAND_METHODS]
  );
}

/**
 * Bug 204/207/237/243：内建 **brand 面**的成员模型（表键 = owner 名）。
 *
 * 内建成员面有两类 brand 名：实例 brand（"Map"）与原型对象 brand
 * （"Map.prototype"）——读面先把 brand 名归一到 owner（去 ".prototype"
 * 后缀）再查表。此前两张内建表（BUILTIN_BRAND_METHODS /
 * BUILTIN_BRAND_ACCESSORS）都按**实例** brand 名建键 ⇒ 原型对象的成员读
 * 必然查不到 → 落「内层闭 obj 槽 miss」折 **exact undefined**
 * （wrong-exact：原生要么有值、要么定抛）。
 *
 * 四张表各自的原生依据：
 * - BUILTIN_SYMBOL_MEMBERS（Bug 204）：原生是 **symbol 键**的自有成员
 *   （Map.prototype[Symbol.toStringTag] === "Map"、
 *   Array.prototype[Symbol.unscopables] 是 16 键对象）。引擎内部把 symbol
 *   键投影成 "@@X" 槽键 ⇒ 与字符串键表平行的一张符号键表。
 * - BUILTIN_PROTO_VALUES（Bug 237）：原型对象**自有数据属性**的取值，与
 *   实例面不同（RegExp.prototype.source === "(?:)"、flags === ""、
 *   Error.prototype.name === "Error"、message === ""）。
 * - BUILTIN_PROTO_METHODS（Bug 237）：原型对象上的**自有方法**
 *   （Intl.NumberFormat.prototype.resolvedOptions 等）。
 * - BUILTIN_PROTO_BRAND_CHECK（Bug 243）：原生 getter 内做 brand check
 *   （RequireInternalSlot(this, …)）——在**原型对象**上读即**定抛
 *   TypeError**（this 不是实例）。折 exact undefined ⇒ 引擎判「读到
 *   undefined 且不抛」⇒ L2 门禁假绿（原生必抛 vs 引擎判不抛）。
 */
type BuiltinSymbolMember =
  | { k: "fn" }
  | { k: "str"; v: string }
  | { k: "obj"; slots: Record<string, Slot> };

/** Bug 204：Array.prototype[Symbol.unscopables] 的 16 个自有键（原生全 true）。 */
const ARRAY_UNSCOPABLES_SLOTS: Record<string, Slot> = Object.fromEntries(
  [
    "at", "copyWithin", "entries", "fill", "find", "findIndex", "findLast",
    "findLastIndex", "flat", "flatMap", "includes", "keys", "toReversed",
    "toSorted", "toSpliced", "values",
  ].map((k) => [k, { value: boolLit(true) }]),
);

const BUILTIN_SYMBOL_MEMBERS: Record<string, Record<string, BuiltinSymbolMember>> = {
  Map: { "@@toStringTag": { k: "str", v: "Map" }, "@@iterator": { k: "fn" } },
  Set: { "@@toStringTag": { k: "str", v: "Set" }, "@@iterator": { k: "fn" } },
  WeakMap: { "@@toStringTag": { k: "str", v: "WeakMap" } },
  WeakSet: { "@@toStringTag": { k: "str", v: "WeakSet" } },
  Promise: { "@@toStringTag": { k: "str", v: "Promise" } },
  Symbol: { "@@toStringTag": { k: "str", v: "Symbol" }, "@@toPrimitive": { k: "fn" } },
  Date: { "@@toPrimitive": { k: "fn" } },
  Array: {
    "@@iterator": { k: "fn" },
    "@@unscopables": { k: "obj", slots: ARRAY_UNSCOPABLES_SLOTS },
  },
  String: { "@@iterator": { k: "fn" } },
  RegExp: {
    "@@match": { k: "fn" },
    "@@matchAll": { k: "fn" },
    "@@replace": { k: "fn" },
    "@@search": { k: "fn" },
    "@@split": { k: "fn" },
  },
  ArrayBuffer: { "@@toStringTag": { k: "str", v: "ArrayBuffer" } },
  SharedArrayBuffer: { "@@toStringTag": { k: "str", v: "SharedArrayBuffer" } },
  DataView: { "@@toStringTag": { k: "str", v: "DataView" } },
  URLSearchParams: { "@@iterator": { k: "fn" } },
  "Intl.NumberFormat": { "@@toStringTag": { k: "str", v: "NumberFormat" } },
  "Intl.DateTimeFormat": { "@@toStringTag": { k: "str", v: "DateTimeFormat" } },
  "Intl.Collator": { "@@toStringTag": { k: "str", v: "Collator" } },
  "Intl.Locale": { "@@toStringTag": { k: "str", v: "Locale" } },
  "Intl.ListFormat": { "@@toStringTag": { k: "str", v: "ListFormat" } },
  "Intl.RelativeTimeFormat": { "@@toStringTag": { k: "str", v: "RelativeTimeFormat" } },
  "Intl.Segmenter": { "@@toStringTag": { k: "str", v: "Segmenter" } },
  "Intl.PluralRules": { "@@toStringTag": { k: "str", v: "PluralRules" } },
  "Intl.DisplayNames": { "@@toStringTag": { k: "str", v: "DisplayNames" } },
  "Intl.DurationFormat": { "@@toStringTag": { k: "str", v: "DurationFormat" } },
};

/** Bug 237：内建原型对象**自有数据属性**的取值（与实例面不同）。 */
const BUILTIN_PROTO_VALUES: Record<string, Record<string, Abs>> = {
  RegExp: {
    source: strLit("(?:)"),
    flags: strLit(""),
    global: undef(),
    ignoreCase: undef(),
    multiline: undef(),
    dotAll: undef(),
    sticky: undef(),
    unicode: undef(),
    unicodeSets: undef(),
    hasIndices: undef(),
  },
  Error: { name: strLit("Error"), message: strLit("") },
  TypeError: { name: strLit("TypeError"), message: strLit("") },
  RangeError: { name: strLit("RangeError"), message: strLit("") },
  ReferenceError: { name: strLit("ReferenceError"), message: strLit("") },
  SyntaxError: { name: strLit("SyntaxError"), message: strLit("") },
  URIError: { name: strLit("URIError"), message: strLit("") },
  EvalError: { name: strLit("EvalError"), message: strLit("") },
  AggregateError: { name: strLit("AggregateError"), message: strLit("") },
  Array: { length: numLit(0) },
  String: { length: numLit(0) },
};

/** Bug 237：内建原型对象上的**自有方法**（原生是普通方法，非 brand getter）。 */
const BUILTIN_PROTO_METHODS: Record<string, ReadonlySet<string>> = {
  "Intl.NumberFormat": new Set([
    "resolvedOptions", "formatToParts", "formatRange", "formatRangeToParts",
  ]),
  "Intl.DateTimeFormat": new Set([
    "resolvedOptions", "formatToParts", "formatRange", "formatRangeToParts",
  ]),
  "Intl.Collator": new Set(["resolvedOptions"]),
  "Intl.Locale": new Set([
    "toString", "maximize", "minimize", "getCalendars", "getCollations",
    "getHourCycles", "getNumberingSystems", "getTimeZones", "getTextInfo",
    "getWeekInfo",
  ]),
  "Intl.ListFormat": new Set(["resolvedOptions", "format", "formatToParts"]),
  "Intl.RelativeTimeFormat": new Set(["resolvedOptions", "format", "formatToParts"]),
  "Intl.Segmenter": new Set(["resolvedOptions", "segment"]),
  "Intl.PluralRules": new Set(["resolvedOptions", "select", "selectRange"]),
  "Intl.DisplayNames": new Set(["resolvedOptions", "of"]),
  "Intl.DurationFormat": new Set(["resolvedOptions", "format", "formatToParts"]),
};

/**
 * Bug 243：内建原型对象上的 **brand check 访问器**——原生 getter 内
 * RequireInternalSlot(this, …)（this 不是实例）⇒ 读即**定抛 TypeError**。
 * 与 members.ts 的 BUILTIN_PROTO_BRAND_GUARDS（Symbol/Map/Set）同口径，
 * 本表覆盖 Intl 家族（其 .prototype 此前连 brand 都不是，读面连访问器
 * 落点都没有 ⇒ 折 exact undefined 且不记 throws）。
 */
const BUILTIN_PROTO_BRAND_CHECK: Record<string, ReadonlySet<string>> = {
  "Intl.NumberFormat": new Set(["format"]),
  "Intl.DateTimeFormat": new Set(["format"]),
  "Intl.Collator": new Set(["compare"]),
  "Intl.Locale": new Set([
    "language", "script", "region", "baseName", "calendar", "caseFirst",
    "collation", "firstDayOfWeek", "hourCycle", "numeric", "numberingSystem",
  ]),
};

/**
 * Bug 243：Intl 子构造器名（原生 Intl.<Sub> 是构造器，.prototype 是带
 * brand 的原型对象——其上的 brand check 访问器才有「读即定抛」的落点）。
 */
const INTL_SUB_CTORS: ReadonlySet<string> = new Set([
  "NumberFormat", "DateTimeFormat", "Collator", "Locale", "ListFormat",
  "RelativeTimeFormat", "Segmenter", "PluralRules", "DisplayNames",
  "DurationFormat",
]);

/**
 * Bug 195：**数组视图对象**（标签模板对象 / RegExp exec 结果）——原生两者
 * 都是**数组 exotic**（CreateArrayFromList / RegExpExecArray）⇒ 继承
 * Array.prototype ⇒ 数组原型方法（join / indexOf / concat / map / slice…）
 * 可派发。
 *
 * 引擎把这类对象建模成 obj 形状（自有下标槽 "0".."n-1" + length 槽）⇒
 * 数组方法面（只认 tuple/arr 形状）落空 → 方法读折 exact undefined ⇒ 调用
 * **假抛 TypeError**。修法：按自有下标槽 + length 槽投影成**等值 tuple**，
 * 派发时把接收者换成该 tuple → 走既有数组派发面（不另造数组语义）。
 */
function arrayViewTuple(a: Abs): Abs | undefined {
  if (a.shape.k !== "obj") return undefined;
  const slots = (a.shape as ObjShape).slots;
  const lenSlot = getSlot(slots, "length");
  const lenR = lenSlot ? litValue(lenSlot.value) : undefined;
  if (!lenR?.ok || typeof lenR.value !== "number" || !Number.isInteger(lenR.value)) return undefined;
  const els: Abs[] = [];
  for (let i = 0; i < lenR.value; i++) {
    const slot = getSlot(slots, String(i));
    if (!slot) return undefined;
    els.push(slot.value);
  }
  return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
}

/** 数组视图对象上的数组原型方法值（调用时按 tuple 投影接收者）。 */
function arrayViewMethodAbs(key: string): Abs {
  return absFunction([], {
    body: noBody,
    apply: (args, thisVal) => {
      const recv = thisVal;
      const tup = recv ? arrayViewTuple(recv) : undefined;
      if (!tup) return unknown;
      return protoMethodDispatch?.("Array", key, tup, args) ?? unknown;
    },
  }, { ctor: false });
}

/**
 * 表项**自有**取（表是普通对象字面量——继承名 "constructor" / "toString" /
 * "valueOf" 等不是表项；裸 `table[k]` 会把宿主 Object.prototype 的成员当表项
 * 命中 ⇒ 原型对象的 "constructor" 读会折成宿主 Object 函数（自信的错值）。
 */
function ownTableEntry<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * Bug 207：内建 owner 沿**类链**解析——派生类实例（class M extends Set）的
 * brand 名是派生类名（graft 产物），内建方法/访问器表按**内建**名建键 ⇒
 * 直查落空 → 折 exact undefined（与 `"add" in s` 折 true 自相矛盾：读面
 * 缺席、in 面说有）。沿 evalClassChain 找首个内建 owner（与 $in 面
 * brandHasProtoMember 同口径——两面必须一致）。
 */
function builtinOwnerOf(brandName: string): string | undefined {
  for (const n of evalClassChain(brandName)) {
    if (ownTableEntry(BUILTIN_BRAND_METHODS, n)) return n;
    if (ownTableEntry(BUILTIN_BRAND_ACCESSORS, n)) return n;
    if (ownTableEntry(BUILTIN_SYMBOL_MEMBERS, n)) return n;
    if (ownTableEntry(BUILTIN_PROTO_VALUES, n)) return n;
    if (ownTableEntry(BUILTIN_PROTO_METHODS, n)) return n;
    if (ownTableEntry(BUILTIN_PROTO_BRAND_CHECK, n)) return n;
    if (ownTableEntry(PROTO_PRIM_METHOD_NAMES, n)) return n;
  }
  return undefined;
}

/**
 * Bug 207：派生类链上**用户定义的同名成员**优先（原生派生类覆盖内建
 * 成员：class M extends Set { add(x){…} } → s.add 是用户方法，不是内建
 * 方法）。仅在链上确有用户定义时才让用户面赢。
 */
function userChainHasMember(brandName: string, key: string, upto: string): boolean {
  for (const n of evalClassChain(brandName)) {
    if (n === upto) return false;
    const spec = getEvalClass(n);
    if (spec && ownRecValue(spec.methods, key) !== undefined) return true;
    if (spec && ownRecValue(spec.accessors, key) !== undefined) return true;
  }
  return false;
}

/** Bug 204：符号成员模型 → Abs 值（@@toStringTag 字符串 / 方法 / 对象）。 */
function builtinSymbolMemberAbs(
  owner: string,
  key: string,
  m: BuiltinSymbolMember,
): Abs {
  if (m.k === "str") return strLit(m.v);
  if (m.k === "obj") return objOf(m.slots);
  if (key === "@@iterator" && owner === "String") {
    // Bug 204：String 原型的 @@iterator 借调（String.prototype
    // [Symbol.iterator].call("ab")）原生返回**码点迭代器**（.next().value
    // 是单字符）——走既有 collectionIteratorAbs 协议面。
    return absFunction([], {
      body: noBody,
      apply: (_args, thisVal) => {
        const recv = thisVal ?? $lit(undefined);
        const svR = litValue(recv);
        if (svR.ok && typeof svR.value === "string") {
          return collectionIteratorAbs(Array.from(svR.value, (c) => strLit(c)));
        }
        return unknown;
      },
    }, { ctor: false });
  }
  if (key === "@@iterator" && (owner === "Map" || owner === "Set")) {
    // Bug 204：Map/Set 原型的 @@iterator 借调（Map.prototype[Symbol.iterator]
    // .call(m)）原生返回**集合迭代器**（.next().value 是 [k,v] / 元素）——
    // 走既有 collectionIteratorAbs 协议面（next/@@iterator 槽），不另造
    // 迭代器形状。
    // Bug 198（S20）：改调 collectionIteratorFor——**live 视图**（原生迭代器
    // 持条目指针：迭代期间的增删可见）+ 同口径投影。此前直接吃**快照**
    // （mapEntriesAbs / setElementsAbs）⇒ 迭代期间的增删不可见。
    // 原生投影口径：Map 的 @@iterator === Map.prototype.entries（[k,v]
    // 元组）；Set 的 @@iterator === Set.prototype.values（**元素本身**，
    // 不是 [el,el] 条目元组——entries 才是）。
    return absFunction([], {
      body: noBody,
      apply: (_args, thisVal) => {
        const recv = thisVal ?? $lit(undefined);
        return collectionIteratorFor(recv, owner === "Map" ? "entries" : "values");
      },
    }, { ctor: false });
  }
  return protoMethodValueAbs(owner, key);
}




/**
 * Bug 49/56「方法值读」统一通道：原型方法的一等函数值。
 * - 值面：fn shape（typeof === "function"、=== undefined 折 false）；
 * - 调用面：apply 钩子把借用调用（v() / v.call(recv, …) / v.apply /
 *   v.bind）按 home 派发回**既有**方法调用机器（callAbsMethod 的 prim 面 /
 *   $invoke 的 brand·数组面）——不复制任何派发逻辑。
 * 与数组臂「不得挂空 body impl」的告诫不冲突：挂的是真 apply（转发派发），
 * $call 不会把 noBody 折成 undefined。
 */
/* var（非 let）：exec/class.ts 模块加载期经循环 import 回调本 setter 时，
 * let 声明仍在 TDZ（eval-empty-sum-reduce / env-shadow-parity 加载序崩溃）；
 * var 提升初始化为 undefined，注册先于本模块体完成也安全。 */
var protoMethodDispatch:
  | ((home: string, name: string, thisVal: Abs | undefined, args: Abs[]) => Abs)
  | undefined;

/** exec/class.ts 模块加载时注册（调用派发实现；与 state.ts 的
 *  setHostGlobalFnCall 桥同款注册式注入，避免 containers↔class import 环） */
export function setProtoMethodDispatch(
  d: (home: string, name: string, thisVal: Abs | undefined, args: Abs[]) => Abs,
): void {
  protoMethodDispatch = d;
}

/** P2a：类方法一等值驻留侧表——按（定义类 spec, kind, 成员键）驻留。
 *  原生：静态方法挂**定义类**构造器、实例方法挂定义类 .prototype——
 *  `B.m` 与 `A.m`（空派生类沿静态链解析到 A 的同一 spec 条目）是同一
 *  函数对象（=== true）；不同键 / 覆盖（不同定义类）是不同对象（=== false）。
 *  kind 前缀区分同名静态/实例方法（`A.m === new A().m` 原生 false）。
 *  按定义 spec 对象弱键驻留（protoBrandAbs 按名驻留 / instance-id 侧表
 *  同款思路）：同名类跨 run last-wins 重注册换新 spec 对象，驻留随旧 spec
 *  回收失效，不串旧值。驻留值打 fresh-instance id——两个不同驻留条目
 *  （A.m vs A.n / 覆盖 B.m vs A.m）原生必不同引用 → strictEqAbs 折 false；
 *  同条目重复读返回同一 Abs 引用 → 同 ref 臂折 true。 */
const classMethodValues = new WeakMap<EvalClassSpec, Map<string, Abs>>();

/**
 * Bug 325：类方法的函数种类戳（spec 下传）——实例方法取 methodKinds、
 * 静态方法取 staticMethodKinds；手写 spec（mock 等）无该字段 → undefined
 * （读取面按保守 "Function" 标签）。
 */
function fnKindOfSpec(
  spec: EvalClassSpec,
  kind: "static" | "inst",
  key: string,
): "function" | "async" | "generator" | "async-generator" | undefined {
  const table = kind === "static" ? spec.staticMethodKinds : spec.methodKinds;
  if (!table) return undefined;
  return table[key];
}

function classMethodValueAbs(
  spec: EvalClassSpec,
  kind: "static" | "inst",
  key: string,
  params: string[] | undefined,
): Abs {
  let byKey = classMethodValues.get(spec);
  if (!byKey) {
    byKey = new Map();
    classMethodValues.set(spec, byKey);
  }
  const memoKey = `${kind}:${key}`;
  const cached = byKey.get(memoKey);
  if (cached) return cached;
  // Bug 89：apply 钩子重入普通方法分派——借用调用（m.call(c) / m.apply /
  // m.bind / HOF 传递）此前对 noBody 无 apply 的值编译空 body，折
  // wrong-exact undefined。经 protoMethodDispatch 注册回调转发
  // $invoke(thisVal, key, args)（member↔class 模块环；实例接收者 →
  // findMethod、类值接收者 → findStaticMethod——静态/实例同一通道，thisVal
  // 由调用位给出）。kind:"protoMethod" 抑制 $invokeInner 尾部「属性上的
  // 可调用值」的无 receiver 再入（apply 已按接收者派发，回环会在
  // undefined 接收者上假定抛）。直接 c.m() 不经此值（registry 派发先行）。
  const fn = markFreshInstance(
    absFunction(params ?? [], {
      body: noBody,
      apply: (args, thisVal) =>
        protoMethodDispatch?.(spec.name, key, thisVal, args) ?? unknown,
      kind: "protoMethod",
      // Bug 325：类方法的**函数种类**戳（async × generator 四象限）——
      // 原生类方法标签面随种类变（"[object AsyncFunction]" 等）。种类从
      // spec 下传（methodKinds / staticMethodKinds；transpile 期记录）。
      // 与 impl.kind（派发角色维度）分开。
      ...(fnKindOfSpec(spec, kind, key) !== undefined
        ? { fnKind: fnKindOfSpec(spec, kind, key)! }
        : {}),
    }, { ctor: false }),
  );
  byKey.set(memoKey, fn);
  return fn;
}

export function protoMethodValueAbs(home: string, name: string): Abs {
  return absFunction([], {
    body: noBody,
    // 内建原型方法是内建函数，原生不可 new（Bug 9 口径）
    apply: (args, thisVal) =>
      protoMethodDispatch?.(home, name, thisVal, args) ?? unknown,
    // kind 标记：$invokeInner 的「属性上的可调用值」回退不得经此再入
    //（$invoke(recv, m) 未命中派发表时 $get 命中本值，$call 无 receiver
    // 回环成 $invoke(undefined, m)——copyWithin/splice 等未接管方法假定抛）
    kind: "protoMethod",
  }, { ctor: false });
}

/**
 * Bug 219：Symbol.prototype 的 toString / toLocaleString / valueOf 一等函数。
 * - toString / valueOf：Symbol.prototype **自有**方法（thisSymbolValue 的
 *   brand check——非 symbol 接收者定抛 TypeError：原生
 *   `Symbol().toString.call(1)` 抛）；valueOf 返回符号自身。
 * - toLocaleString：**不在** Symbol.prototype 上（继承自
 *   Object.prototype.toLocaleString → ToObject(this).toString()）——symbol
 *   接收者得 "Symbol(desc)"（无 brand check：借用调用合法）。
 * 此前三者都落 Object.prototype 泛型版 → 错值 "[object Number]" /
 * "[object Symbol]" 且 brand check 丢失（借用调用漏抛 TypeError）。
 */
function symbolProtoMethodAbs(name: "toString" | "toLocaleString" | "valueOf"): Abs {
  return absFunction([], {
    body: noBody,
    apply: (_args, thisVal) => {
      const recv = thisVal ?? $lit(undefined);
      if (isSymbolAbs(recv)) {
        if (name === "valueOf") return recv;
        return stringOfSymbol(recv);
      }
      // brand check：Symbol.prototype.toString / valueOf 只接受 symbol 接收者
      if (name !== "toLocaleString") throw new NudoThrow(errorTypeAbs("TypeError"));
      // toLocaleString 继承自 Object.prototype（ToObject(this).toString()）——
      // 非 symbol 接收者沿既有泛型投影（Object.prototype 面）
      return evalObjectProtoMethod("toLocaleString", recv, []) ?? unknown;
    },
  }, { ctor: false });
}

/**
 * Bug 149：Proxy 陷阱的 key 实参。符号投影键（转译期 "[Symbol.X]" → "@@X"）
 * 在**陷阱边界**还原成真 symbol——规范要求 trap 收到的 key 与读取时的 key
 * 相同；此前把内部槽键表示当 PropertyKey 传出 ⇒ 按 symbol 分派的 handler
 * 全部失灵（typeof k 得 "string"、k === Symbol.iterator 恒 false）。
 *
 * 普通字符串键（含用户字面量 "@@X"）原样传字符串——字面量串键与符号键是
 * 两个不同的 PropertyKey，不得混叠。
 */
function trapKeyAbs(slotKey: string, isSymbolKey: boolean | undefined): Abs {
  if (isSymbolKey) {
    const sym = symbolAbsForSlotKey(slotKey);
    if (sym) return sym;
  }
  return strLit(slotKey);
}

/** 成员读：obj.slots[key]；缺失 → undefined 字面量；brand 解包内层 */
export function $get(
  o: Abs,
  key: string,
  opts?: {
    /** 调用方已负责诊断（如 $invoke） */ silent?: boolean;
    /** Bug 149：键来自符号投影（"[Symbol.X]" → "@@X"）——陷阱边界还原真 symbol */
    symbolKey?: boolean;
  },
  /**
   * Bug 235：[[Get]] 的 **receiver**（规范 Proxy.[[Get]](P, key, Receiver)
   * 无 get 陷阱时转发 `target.[[Get]](key, Receiver)`）。缺省 = 接收者自身。
   * 只作用于本次读取的访问器 `this` 绑定——不向下递归传递（内层读取的
   * receiver 仍是它自己的接收者）。
   */
  receiver?: Abs,
): Abs {
  // 私有名（"#" 键）：foreign-receiver brand check——原生
  // PrivateFieldGet 要求接收者是声明类实例，否则 TypeError
  privateNameGuard(o, key);
  // 宿主 JS 对象（Math/JSON…）：属性按命名空间/真值投影
  if (!o || typeof o !== "object" || !("shape" in (o as object))) {
    // Object.prototype / Object.prototype.X（含 host 身份）
    if (o === Object.prototype) {
      if (OBJECT_PROTO_METHOD_NAMES.has(key)) return objectProtoMethodAbs(key);
      return unknown;
    }
    const ns = namespaceNameOf(o);
    if (key === "prototype") {
      if (ns === "Object") return objectProtoBrand();
      // Bug 92：prototype 是构造器自有属性——非构造命名空间（Math/JSON/
      // Reflect/Intl，宿主值 typeof "object"）原生无 prototype，折 exact
      // undefined（此前凭空捏 protoBrandAbs：typeof "object" wrong-exact、
      // 与 in/hasOwn 缺席口径矛盾、`Math.prototype.x` 假不抛）。构造命名
      // 空间（typeof "function"）维持原型 brand；非命名空间宿主函数不得
      // 在此返回——落穿到下方 Bug 9 宿主函数分支（transpile 函数声明 /
      // Function 本体），否则 f.prototype 误折 undefined。
      if (ns && typeof o !== "function") return undef();
      if (ns) return protoBrandAbs(ns);
    }
    // Bug 114：内建构造器的 @@species 静态符号键（BUILTIN_SPECIES_CTORS，
    // transpile 读侧 [Symbol.species] → "@@species" 投影）——宿主通道按
    // 字符串键裸读是 undefined；折构造器 fn 面（typeof "function"）。
    if (ns && key === "@@species" && BUILTIN_SPECIES_CTORS.has(ns)) {
      return protoMethodValueAbs(ns, "@@species");
    }
    // Bug 44：Intl 两个格式化构造器——带 locale 校验的构造器值（fn name
    // "Intl.<Sub>" → $new 按名派发 evalBuiltinNew；调用面 apply 同 builder）
    if (ns === "Intl" && (key === "NumberFormat" || key === "DateTimeFormat")) {
      return makeIntlCtorAbs(key);
    }
    // Bug 227：符号键投影（"@@X"）在**宿主对象**上须还原成**真 symbol**
    // 再读——Math / JSON / Reflect / Intl / Atomics 的 Symbol.toStringTag
    // 是 symbol 键的**自有数据属性**（原生 Math[Symbol.toStringTag] ===
    // "Math"）。按投影串（"@@toStringTag"）裸读宿主对象恒 undefined
    // （wrong-exact：自信的错值）。字面量串键 "@@X" 不带 symbolKey 标记，
    // 仍是字符串键（不误伤）。
    if (opts?.symbolKey) {
      const hostSym = hostSymbolForSlotKey(key);
      if (hostSym !== undefined) {
        try {
          return $lit((o as unknown as Record<symbol, unknown>)[hostSym]);
        } catch {
          return unknown;
        }
      }
    }
    if (ns) {
      try {
        const raw = (o as Record<string, unknown>)[key];
        if (typeof raw === "function") {
          // Bug 44：宿主成员函数的可构造性 facet 透传（hostFnCtorFacet）——
          // 成员值被 $new 时不再记假 may TypeError（Intl.Collator 等原生可
          // 构造成员；Math.max 等方法值原生确定不可构造 → ctor:false 定抛）
          const ctor = hostFnCtorFacet(raw);
          // Bug 243：Intl 子构造器（Intl.Collator / Intl.Locale …）的构造器
          // 值须带**名字**（"Intl.<Sub>"）——其 .prototype 是带 brand 的原型
          // 对象（brand check 访问器读即定抛 TypeError），需名字才能路由到
          // 原型 brand。普通命名空间成员（Math.max）**不带**名字：原生
          // Math.max.name 是 "max"，带 "Math.max" 会折成错值。
          const isIntlSub = ns === "Intl" && INTL_SUB_CTORS.has(key);
          return absFunction([`${ns}.${key}`], {
            body: noBody,
            // Bug 311：命名空间静态方法值被**单独读出再调用**时，this 绑定
            // 必须转发进静态派发（原生 Promise.resolve 是以 this 为接收者的
            // 普通函数——this 非构造器 ⇒ TypeError）。thisVal 缺席（JS
            // undefined）= 「this 是 undefined」——原生同样抛（this 非
            // 构造器）；直接命名空间调用（`Promise.resolve(1)`）走
            // $invoke → evalNamespaceCall 的**无 this** 通道，不经本钩子。
            apply: (args, thisVal) =>
              evalNamespaceCall(ns, key, args, thisVal ?? undef()) ?? unknown,
          }, {
            ...(ctor !== undefined ? { ctor } : undefined),
            ...(isIntlSub ? { name: `${ns}.${key}` } : undefined),
          });
        }
        return $lit(raw);
      } catch {
        return unknown;
      }
    }
    // Bug 9：非命名空间宿主函数（transpile 编译的函数声明绑定等）——
    // name/length/prototype 是宿主真值（v.name / v.length / v.prototype）；
    // call/apply/bind 一等读取（$invoke 转发面既有）
    if (typeof o === "function") {
      const fn = o as { name?: unknown; length?: unknown; prototype?: unknown };
      if (key === "name") {
        return typeof fn.name === "string" && fn.name ? strLit(fn.name) : str();
      }
      if (key === "length") {
        return numLit(typeof fn.length === "number" ? fn.length : 0);
      }
      if (key === "prototype") {
        // Bug 93：generator 函数「不可构造但有 prototype」（generator 实例
        // 原型，typeof "object"）——先于 ctor facet 合取：不可构造 ≠ 无
        // prototype，generator 两属性恰好分离（async/箭头/方法两者皆无）。
        // 可辨 brand（[[Proto]] 非 Object.prototype），不经 protoBrandAbs。
        if (isHostGeneratorFn(o as never)) return generatorProtoBrandOf(o as never);
        // 箭头/async（去种类化宿主函数）原生无 prototype → undefined
        if (fn.prototype === undefined || hostFnCtorFacet(o as never) === false) {
          return undef();
        }
        // Bug 92：Function.prototype 原生 callable（唯一 prototype 为函数的
        // 构造器）——protoBrandAbs 是 obj 面 brand（typeof "object"
        // wrong-exact），折 fn 面。
        if (typeof fn.prototype === "function") return functionProtoAbs();
        // Bug 64：宿主构造器（路由表外泄漏的全局/声明函数）的 prototype 带
        // owner 身份——protoBrandAbs（constructor 槽 + 按名驻留 === 恒等），
        // 不再捏匿名闭 obj（`X.prototype instanceof Super` 假精确 false）
        return typeof fn.name === "string" && fn.name
          ? protoBrandAbs(fn.name)
          : abs({ k: "obj", slots: {} }, undefined, undefined, "path");
      }
      if (key === "call" || key === "apply" || key === "bind") {
        return absFunction([], { body: noBody }, { ctor: false });
      }
      // Bug 9：Object.prototype 方法（f.toString / f.hasOwnProperty …）——
      // 宿主函数经原型链恒可用，一等 fn 读取（此前落 unknown）
      if (OBJECT_PROTO_METHOD_NAMES.has(key)) {
        return objectProtoMethodAbs(key);
      }
    }
    return unknown;
  }
  // Object.prototype 品牌：方法读取
  if (isObjectProtoBrand(o) && OBJECT_PROTO_METHOD_NAMES.has(key)) {
    return objectProtoMethodAbs(key);
  }
  // Symbol：.description（字面量或 undefined）
  if (isSymbolAbs(o) && key === "description") {
    return symbolDescriptionAbs(o) ?? unknown;
  }
  // Promise 实例方法一等读取（typeof p.then）
  if (o.shape.k === "eff" && o.shape.eff === "promise" && (key === "then" || key === "catch" || key === "finally")) {
    return absFunction([key === "then" ? "onFulfilled" : key === "catch" ? "onRejected" : "onFinally"], {
      body: noBody,
      // Bug 9：内建实例方法是内建函数，原生不可 new
    }, { ctor: false });
  }
  if (o.shape.k === "brand") {
    // Bug 116：strict 毒丸——arguments.callee 读定抛（seam 前缀恢复模块体
    // 严格性后，折叠面同样要抛；caller 读原生 undefined 不毒）
    if (o.shape.name === "Arguments" && key === "callee") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // Bug 57/71：Proxy——get 陷阱优先（handler 提供 → $call 派发，实参
    // (target, key, receiver)、this = handler）；无陷阱回退**靶读取**
    //（inner 即 target Abs——含靶原型链）；陷阱不可判/不可调用 → 诚实
    // unknown（原生是每次触达 TypeError，sound 降级）
    if (o.shape.name === "Proxy") {
      const parts = proxyPartsOf(o);
      if (parts) {
        // Bug 235：proxy 是**独立的创建事件**（原生 new Proxy 每次新对象，
        // 与靶必不同引用）——打新鲜实例标（懒打：首次经 Proxy 面读时），
        // 使 `p === t` / getter 内 `this === t` 折确定 false（此前不可判）。
        // 构造点（makeProxyAbs）打标更正确——越界（builtins/error/
        // error-family.ts），此处补最小可判面。
        if (freshInstanceIdOf(o) === undefined) markFreshInstance(o);
        const trap = proxyTrapOf(parts.handler, "get");
        if (trap.k === "fn") {
          // Bug 149：符号键的陷阱实参是真 symbol（规范 PropertyKey），不是 "@@X" 串
          const r = $call(trap.fn, [parts.target, trapKeyAbs(key, opts?.symbolKey), o], parts.handler);
          // Bug 210：Proxy [[Get]] 规范不变量（ES2024 10.5.4 step 6）——靶上该
          // 自有属性**不可配置且不可写**时，get 陷阱须返回该属性的实际值
          // （SameValue），否则原生定抛 TypeError。此前直接返回陷阱值（假绿）。
          enforceProxyGetInvariant(parts.target, key, r, { symbolKey: opts?.symbolKey });
          return r;
        }
        if (trap.k === "dead" || trap.k === "opaque") {
          recordMayThrow({ kind: "TypeError", cause: `Proxy get trap for '${key}' not callable / unknown` });
          return unknown;
        }
        // Bug 235：无 get 陷阱 → `target.[[Get]](key, Receiver)`——Receiver
        // 是 **proxy 自己**（规范 Proxy.[[Get]] 转发 Receiver 给靶）；此前
        // 直接读靶（丢掉 receiver）⇒ 靶上 getter 的 this 绑到 target 而非
        // proxy ⇒ `this === t` 自信折 true（原生 false）。
        return $get(parts.target, key, opts, receiver ?? o);
      }
      // 无侧表（退化副本）：沿通用 brand 内层（inner = target）路径
    }
    if (o.shape.name.endsWith(".prototype")) {
      const ctorName = o.shape.name.slice(0, -".prototype".length);
      // Bug 208（读面）：原型对象上的**自有槽优先于内建方法表**——原生属性
      // 查找序是 own → prototype：用户写在原型对象上的自有属性
      // （`Array.prototype.push = fn`）遮住内建同名实现。此前内建方法表
      // 命中即返回 ⇒ 读回内建实现（借用面 `Array.prototype.join.call(…)`
      // 拿到的也是内建版）。constructor 例外——原型对象的 constructor 槽
      // 是内建构造器名义面，类值的注册面优先（见下方 lookupClassValue）。
      if (key !== "constructor" && key !== "__proto__") {
        const protoInner = o.shape.shape;
        if (protoInner.shape.k === "obj") {
          const ownSlot = getSlot(protoInner.shape.slots, key);
          if (ownSlot && !ownSlot.optional) return ownSlot.value;
        }
      }
      // Bug 243：原生内建原型对象上的 **brand check 访问器**——getter 内
      // RequireInternalSlot(this, …)（this 是原型对象、不是实例）⇒ 读即
      // **定抛 TypeError**。此前该键在原型对象上既无值也无抛 ⇒ 折 exact
      // undefined 且不记 throws ⇒ L2 门禁假绿（原生必抛 vs 引擎判不抛）。
      // 先于方法表：brand check 访问器在原生上就是 getter（不是方法值）。
      if (ownTableEntry(BUILTIN_PROTO_BRAND_CHECK, ctorName)?.has(key)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 204：原型对象上的 well-known Symbol 成员（Map.prototype
      // [Symbol.toStringTag] === "Map"、Array.prototype[Symbol.unscopables]
      // 是 16 键对象…）——原生是 symbol 键的自有成员，引擎按 "@@X" 槽键
      // 寻址 ⇒ 与字符串键表平行的一张符号键表。
      const symTable = ownTableEntry(BUILTIN_SYMBOL_MEMBERS, ctorName);
      const symM = symTable ? ownTableEntry(symTable, key) : undefined;
      if (symM) return builtinSymbolMemberAbs(ctorName, key, symM);
      // Bug 237：原型对象**自有数据属性**的取值（RegExp.prototype.source
      // === "(?:)"、flags === ""、Error.prototype.name === "Error"、
      // message === ""）——与实例面不同，不可复用实例面的访问器名表。
      const protoTable = ownTableEntry(BUILTIN_PROTO_VALUES, ctorName);
      const protoVal = protoTable ? ownTableEntry(protoTable, key) : undefined;
      if (protoVal) return protoVal;
      // Array 三键维持既有精确面（arrayMethodAbs：bindThis 注入 receiver）
      if (ctorName === "Array" && (key === "toString" || key === "toLocaleString" || key === "join")) {
        return arrayMethodAbs(key === "join" ? "join" : key);
      }
      // Bug 56：X.prototype.<method> 值读泛化——按构造器查原型方法表，产
      // 带 apply 钩子的一等 fn（.call(recv,…) 借用调用转发既有方法派发）；
      // 表外键沿旧路径（内层仅 constructor 槽 → miss）。
      const protoMethods = protoBrandMethodNames(ctorName);
      if (protoMethods?.has(key)) {
        return protoMethodValueAbs(ctorName, key);
      }
      // Bug 237：内建原型对象上的**自有方法**（Intl.NumberFormat.prototype
      // .resolvedOptions / .formatToParts 等——原生是普通方法，读到函数值；
      // 与 brand check 访问器（读即定抛）分表）。
      if (ownTableEntry(BUILTIN_PROTO_METHODS, ctorName)?.has(key)) {
        return protoMethodValueAbs(ctorName, key);
      }
      // P3b：constructor → 注册类值优先（B.prototype.constructor === B 折
      // exact——protoBrandAbs 的 constructor 槽是 builtinCtorAbs 名义面，
      // 与 $class 类值不同引用）。类值/内建名未注册 → 沿旧口径。
      if (key === "constructor") {
        const cv = lookupClassValue(ctorName);
        if (cv) return cv;
      }
    }
    const isClassVal = classNameOfValue(o as object) === o.shape.name;
    // Bug 207：内建原型面按**类链**解析——派生类实例（class M extends Set）的
    // brand 名是派生类名（graft 产物），内建方法/访问器表按**内建**名建键
    // ⇒ 直查落空 → 折 exact undefined（与 `"add" in s` 折 true 自相矛盾：
    // 读面缺席、in 面说有）。沿 evalClassChain 找首个内建 owner（与 $in 面
    // brandHasProtoMember 同口径——两面必须一致）。
    const builtinOwner = isClassVal ? undefined : builtinOwnerOf(o.shape.name);
    const builtinHome = builtinOwner ?? o.shape.name;
    // 派生类链上**用户定义的同名成员**优先（原生派生类覆盖内建成员：
    // class M extends Set { add(x){…} } → s.add 是用户方法）——让用户面赢。
    const userOwnsKey =
      builtinOwner !== undefined && builtinOwner !== o.shape.name &&
      userChainHasMember(o.shape.name, key, builtinOwner);
    // 内建 brand 原型方法读取（typeof m.forEach / m[Symbol.iterator]）：
    // Bug 13：具名方法值走方法值读通道——protoMethodValueAbs 的 apply 钩子
    // 把借用调用（m.get.call(m,k) / .apply / .bind 产物）转发回 $invoke 既有
    // 派发；此前 no-op fn 被直接调用折精确 undefined。@@iterator 维持 no-op
    // 形状（迭代协议派发另走，与数组臂同口径）。
    // （class 声明值同名内建时不误伤：类方法走 registry）
    const builtinM = BUILTIN_BRAND_METHODS[builtinHome];
    // Bug 40：@@iterator 只对原生可迭代 brand（Map/Set/TA，ITERABLE_BRANDS）
    // 折函数——此前任意有表 brand（Date/WeakMap/Error…）都折 "function"，
    // 非可迭代 brand 原生 undefined（wrong-exact）。
    if (builtinM && !isClassVal && !userOwnsKey && (builtinM.has(key) || (key === "@@iterator" && ITERABLE_BRANDS.has(builtinHome)))) {
      if (key !== "@@iterator") return protoMethodValueAbs(builtinHome, key);
      // Bug 198（S20）：实例上的 @@iterator 与**原型上是同一个函数对象**
      // （原生 m[Symbol.iterator] === Map.prototype[Symbol.iterator]）⇒ 读值
      // 必须走符号成员表（builtinSymbolMemberAbs），不能给一个 no-op fn——
      // no-op fn 被调用折 <abs:never>（**自信的错值**：原生返回集合迭代器
      // [k,v] / 元素）。符号成员表无 @@iterator 条目者（TypedArray 家族）
      // 维持 no-op 形状（无协议面可折）。
      const instSymTable = ownTableEntry(BUILTIN_SYMBOL_MEMBERS, builtinHome);
      const instIter = instSymTable ? ownTableEntry(instSymTable, "@@iterator") : undefined;
      if (instIter) return builtinSymbolMemberAbs(builtinHome, "@@iterator", instIter);
      return absFunction([], { body: noBody }, { ctor: false });
    }
    // Bug 204：实例面上的 well-known Symbol 成员（new Map()[Symbol.toStringTag]
    // === "Map"、new Date()[Symbol.toPrimitive] 是函数）——原生是原型对象上
    // 的 symbol 键自有成员，实例经原型链继承。@@iterator 维持上方 ITERABLE
    // 臂的既有 no-op 形状（迭代协议派发另走），此处不夺。
    if (!isClassVal && !userOwnsKey && key !== "@@iterator" && builtinOwner !== undefined) {
      const instTable = ownTableEntry(BUILTIN_SYMBOL_MEMBERS, builtinOwner);
      const instSym = instTable ? ownTableEntry(instTable, key) : undefined;
      if (instSym) return builtinSymbolMemberAbs(builtinOwner, key, instSym);
    }
    // Bug 207：prim 包装构造器（Number / String / Boolean / Symbol /
    // BigInt）的**实例面**方法（PROTO_PRIM_METHOD_NAMES）——原生
    // `new Number(5).toFixed` 是函数（装箱对象继承原型方法）；此前实例
    // brand 面无此表 ⇒ 折 exact undefined（wrong-exact）。派生类
    // （class M extends Number）沿类链解析到同一 owner ⇒ 内建父子类面
    // 与内建父本身一致。
    if (!isClassVal && !userOwnsKey) {
      const primMethods = ownTableEntry(PROTO_PRIM_METHOD_NAMES, builtinHome);
      if (primMethods?.has(key)) return protoMethodValueAbs(builtinHome, key);
    }
    // JS Map/Set 的 size 是属性不是方法；brand 内层为空 obj，须在 $get 委托
    if (key === "size" && builtinHome === "Map") return mapSizeAbs(o);
    if (key === "size" && builtinHome === "Set") return setSizeAbs(o);
    // Bug 322：URLSearchParams 的 size 同款（原生是 getter）——条目数
    if (key === "size" && builtinHome === "URLSearchParams") return urlSearchParamsSizeAbs(o);
    const inner = o.shape.shape;
    // 自有数据属性优先于原型访问器（原生属性查找：own → prototype）
    // 必须 getSlot：constructor/toString 等键裸读会踩宿主 Object.prototype
    if (inner?.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      if (slot && !slot.optional) return slot.value;
    }
    // P3b：原型品牌的祖先数据槽（B.prototype.x ← Base/A.prototype.x）——
    // own 槽（上）后沿链原型对象读槽（注册类 protoBrand / fn 伪父 memo
    // prototype）。链洞（未注册父名）→ 缺席不可折（sound unknown；此前
    // 闭 obj miss 折 undefined 是 wrong-exact）。Object.prototype 成员
    // （hasOwnProperty/toString/…）恒经下方通用投影解析——不折 unknown。
    if (
      !isClassVal && o.shape.name.endsWith(".prototype") &&
      key !== "constructor" && key !== "__proto__" && !OBJECT_PROTO_NAMES.has(key)
    ) {
      const ancHit = chainProtoSlotOf(o.shape.name.slice(0, -".prototype".length), key, 1);
      if (ancHit !== undefined) return ancHit;
      if (classChainHasHole(o.shape.name.slice(0, -".prototype".length))) return unknown;
    }
    if (isClassVal) {
      const sacc = findStaticClassAccessor(o.shape.name, key);
      // Bug 235：receiver 优先（Proxy 转发读靶时，访问器的 this 是 receiver）
      if (sacc) return sacc.get ? sacc.get(receiver ?? o) : undef();
      // 类值上读实例访问器键 → 原生 undefined。length 例外：实例访问器挂
      // .prototype（不在构造器 [[Prototype]] 链上），遮不住构造器自有
      // length（P2b arity 臂，见下方）。
      if (key !== "length" && findClassAccessor(o.shape.name, key)) return undef();
      // 静态方法一等读取（typeof A.m / 高阶传递）：沿继承链在 registry 找
      // 未调用方法槽带 AST 形参展示名（不再假零参）。
      // N2：同级补祖先类值自有槽——继承静态字段（B.x ← A 的 static x）与
      // 动态写（A.y = …）：原生静态成员挂构造器 [[Prototype]] 链
      // （B.__proto__ = A），own 槽（上方）优先后逐级上溯；取**同一 Abs
      // 引用**（B.x === A.x 恒等保持）。name/prototype 是每个函数的自有
      // 属性——不经链继承；length 例外放行（静态方法/祖先静态槽可恰名为
      // length 覆盖构造器自有元数，链解析后落下方 arity 臂）。
      // P2a：驻留按（定义 spec, 键）——B.m 与 A.m 解析到同一 spec 条目
      // 返回同一函数 Abs（=== 折 true）。
      if (key !== "name" && key !== "prototype") {
        let level = 0;
        for (const n of evalClassChain(o.shape.name)) {
          const spec = getEvalClass(n);
          // Bug 90：own-property 取值——D.constructor / D.toString 值读不得
          // 命中宿主 Object.prototype 继承名
          if (spec && ownRecValue(spec.staticMethods, key) !== undefined) {
            return classMethodValueAbs(spec, "static", key, ownRecValue(spec.staticMethodParams, key));
          }
          if (level++ > 0) {
            const anc = lookupClassValue(n);
            const ancInner = anc && anc.shape.k === "brand" ? anc.shape.shape : undefined;
            if (ancInner?.shape.k === "obj") {
              const slot = getSlot(ancInner.shape.slots, key);
              if (slot && !slot.optional) return slot.value;
            }
            // P3b：fn 伪父的自有静态槽（Base.px = 5 → B.px）——fn 值一等
            // 对象的 expando 槽（$set fn 臂就地写，引用语义）。
            if (anc && anc.shape.k === "fn" && anc.shape.slots) {
              const fslot = getSlot(anc.shape.slots, key);
              if (fslot && !fslot.optional) return fslot.value;
            }
            if (!spec) break; // 链洞：槽面止步（宿主通道在下方）
          }
        }
      }
      // P2b：类值 length = 构造器元数（首个默认值/rest 形参前的形参数，
      // Bug 69 nativeParamArity 同口径；隐式 ctor 基类/派生恒 0——派生
      // 隐式是 constructor(...args){super(...args)}，不继承父元数）。
      // 自有静态字段槽（上方 own 槽）/ 静态访问器（sacc）优先，恰名为
      // length 的静态方法/祖先静态槽经上方链解析——都未命中才折元数。
      // transpile 期经 spec.ctorLength 通道记录；未记录通道（手写 spec /
      // mock）→ 诚实 unknown（不假 0）。
      if (key === "length") {
        const ownSpec = getEvalClass(o.shape.name);
        return ownSpec?.ctorLength !== undefined ? numLit(ownSpec.ctorLength) : unknown;
      }
      // 类值是 constructor 函数：prototype 对象与 Function.prototype 成员
      if (key === "prototype") {
        // Bug 64：类原型带 owner 身份——protoBrandAbs("X")（constructor 槽 +
        // 按名驻留；`X.prototype.hasOwnProperty("constructor")` 折 true、
        // instanceof 链走可解析名），不再捏匿名闭 obj（链身份全丢）
        return protoBrandAbs(o.shape.name);
      }
      if (key === "call" || key === "apply" || key === "bind") {
        return absFunction([], { body: noBody }, { ctor: false });
      }
      // N2：内建父构造器静态读（B extends Object → B.keys / E extends Error →
      // E.captureStackTrace）：宿主静态通道（$get 的 namespace 投影 / 宿主
      // 真值）。仅 superBuiltinHost 标记放行（真实宿主 extends；mock 同名
      // 父类无通道 → 落下方 unknown，不折 undefined）。name/length/prototype/
      // constructor 是每函数自有/共享面——不经链继承（排除；constructor 保
      // 留既有 ctorNameOfRecv 折叠口径）。
      if (key !== "name" && key !== "length" && key !== "prototype" && key !== "constructor") {
        const sup = builtinSuperCtorOf(o.shape.name);
        if (sup) return $get(sup.host as Abs, key, opts);
      }
    } else {
      const acc = findClassAccessor(o.shape.name, key);
      // Bug 235：receiver 优先（Proxy 转发读靶时，访问器的 this 是 receiver）
      if (acc) return acc.get ? acc.get(receiver ?? o) : undef();
      // 实例上读静态访问器键 → 原生 undefined（属性在构造器上）
      if (findStaticClassAccessor(o.shape.name, key)) return undef();
      // 实例方法读取（typeof a.m / 一等值）：沿继承链在 registry 找方法
      // 未调用方法槽带 AST 形参展示名（不再假零参）。
      // P2a：驻留按（定义 spec, 键）——a.m 与 b.m（跨实例/跨派生）解析到
      // 同一 spec 条目返回同一函数 Abs（原生挂 .prototype，=== 折 true）。
      for (const n of evalClassChain(o.shape.name)) {
        const spec = getEvalClass(n);
        // Bug 90：own-property 取值——c.constructor / c.__proto__ 值读不得
        // 命中宿主 Object.prototype 继承名（此前折假 false 的根因）
        if (spec && ownRecValue(spec.methods, key) !== undefined) {
          return classMethodValueAbs(spec, "inst", key, ownRecValue(spec.methodParams, key));
        }
      }
      // P3b：原型链数据槽（new B().x ← Base.prototype.x / A.prototype.x）
      // ——own 槽与方法面之后沿链原型对象读槽。链洞 / fn 伪父（ctor 体
      // 不透明，实例自有面不可判）→ 缺席不可折 undefined（sound unknown；
      // 此前闭 obj miss 折 undefined 对抽象父是 wrong-exact）。
      // Object.prototype 成员（hasOwnProperty/…）走下方通用投影，不折。
      const protoHit = chainProtoSlotOf(o.shape.name, key, 0);
      if (protoHit !== undefined) return protoHit;
      if (
        key !== "constructor" && key !== "__proto__" && !OBJECT_PROTO_NAMES.has(key) &&
        (classChainHasHole(o.shape.name) || chainHasOpaqueFnParent(o.shape.name))
      ) {
        return unknown;
      }
    }
    // 原型链 constructor：内建 brand（Error/Date/…）→ 对应构造器 Abs；
    // P3b：注册类（用户类/fn 伪父）实例/原型 → 类值本身（=== 折 exact）。
    // Bug 234：类值（class 声明 / 有体类表达式）的 [[Prototype]] 是
    // Function.prototype ⇒ `constructor` 继承自那里 = **内建 Function**
    // （原生 `Widget.constructor === Function` 为 true、`.name` 为
    // "Function"）。此前落 `builtinCtorAbs(类名)`——一个「以类名命名的
    // 内建构造器」：=== Function 折确定 false、.name 折类名（自信错值）。
    if (key === "constructor") {
      const cn = ctorNameOfRecv(o);
      if (cn) {
        if (isClassVal) return builtinCtorAbs("Function");
        const cv = lookupClassValue(cn);
        if (cv) return cv;
        return builtinCtorAbs(cn);
      }
    }
    // Bug 58/67：__proto__ 是 Object.prototype 访问器（读 [[Prototype]]）——
    // brand 接收者走 protoOfRecv 的 brand 面：类值 → 父构造器 /
    // Function.prototype；X.prototype 品牌 → owner extends（extends null
    // → null 字面量）；实例 brand → X.prototype。不得落 inner obj 面折
    // Object.prototype（类值/原型品牌的 [[Prototype]] 都不是它）。
    if (key === "__proto__") {
      return protoOfRecv(o);
    }
    // Bug 102：TA 字符串形下标（v["1"] ≡ v[1]，与 $idx 的 TA 臂同元素域）——
    // canonicalArrayIndex 归一；此前落 inner 闭 obj 槽 miss 折 exact
    // undefined。长度槽字面量（makeTypedArrayAbs 数字形态）时精确：在界 →
    // 元素域、越界 → undef；长度不可判 → 元素域 join undef（可能越界）。
    if (!isClassVal && TYPED_ARRAY_ELEMENT[o.shape.name] !== undefined) {
      const idx = canonicalArrayIndex(key);
      if (idx !== undefined) {
        const elem = TYPED_ARRAY_ELEMENT[o.shape.name]!;
        const lenA = inner?.shape.k === "obj"
          ? getSlot(inner.shape.slots, "length")?.value
          : undefined;
        const lenR = lenA ? litValue(lenA) : undefined;
        if (lenR?.ok && typeof lenR.value === "number") {
          return idx < lenR.value
            ? abs({ k: "prim", type: elem }, undefined, undefined, "exact")
            : undef();
        }
        return joinAbs(abs({ k: "prim", type: elem }, undefined, undefined, "exact"), undef());
      }
    }
    // Bug 40：已知原型访问器名（BUILTIN_BRAND_ACCESSORS，$in presence 表）
    // 的值读若槽面未建模 → 诚实 unknown——不得落闭 obj 槽 miss 折精确
    // undefined（`typeof ab.detached` / `typeof ta.buffer` 曾断言成员缺席，
    // wrong-exact）。own 槽已在上方优先（byteLength/resizable 等精确面
    // 不回退）；类值（isClassVal）走静态面，不在此列。
    if (!isClassVal && BUILTIN_BRAND_ACCESSORS[o.shape.name]?.has(key)) {
      return unknown;
    }
    // Bug 332 顺带：**未建模**的 Intl 子构造器（Collator / Locale / …）的
    // **实例方法面**读出 exact undefined（原生恒有该方法——`new
    // Intl.Collator().compare` 是函数）⇒ 自信错值。台账口径：Intl.<Sub>
    // 的方法面 imprecise ⇒ 折 **unknown**（不是 undefined）。
    //
    // 只覆盖「该子构造器**确有的**成员」（原型方法表 + brand check 访问器
    // 表）——其余键（如实例 `.name`——原生恒 undefined）仍折 exact
    // undefined。
    if (
      !isClassVal &&
      o.shape.name.startsWith("Intl.") &&
      (BUILTIN_PROTO_METHODS[o.shape.name]?.has(key) ||
        BUILTIN_PROTO_BRAND_CHECK[o.shape.name]?.has(key))
    ) {
      return unknown;
    }
    return $get(inner, key, opts);
  }
  // dual-facet fn 静态槽（Number.isFinite / Array.isArray）：自有槽优先
  if (o.shape.k === "fn" && o.shape.slots) {
    const slot = getSlot(o.shape.slots, key);
    if (slot) {
      if (slot.optional) return joinAbs(slot.value, undef());
      return slot.value;
    }
  }
  // Bug 9：函数值属性 name / length / prototype——值域恒可判定
  //（name：shape.name 声明名（asAbsVal / $fnVal 透传）有则 exact，否则
  //  string；length：$len 的 fn 分支；prototype：非箭头恒对象 / 箭头 undefined）
  if (o.shape.k === "fn") {
    if (key === "name") {
      const nm = (o.shape as { name?: string }).name;
      // Bug 332：Intl 子构造器的**内部派发键**（"Intl.Collator"）不得污染
      // 原生 `fn.name`（原生是**非限定名**："Collator" / "NumberFormat"）。
      // 派发键仍留在 shape.name（原型 brand 路由要它）⇒ 读面剥前缀。
      if (typeof nm === "string" && nm.startsWith("Intl.")) {
        return strLit(nm.slice("Intl.".length));
      }
      return typeof nm === "string" && nm ? strLit(nm) : str();
    }
    if (key === "length") return $len(o);
    if (key === "prototype") {
      // Bug 93：generator 表达式（$fnVal kind:"generator" 标记）——
      // ctor:false 但原生有 prototype（generator 实例原型，typeof
      // "object"）。可辨 brand（[[Proto]] 是 %GeneratorFunction%.prototype
      // 而非 Object.prototype）；constructor 无槽折 builtinCtorAbs 面
      //（`g.prototype.constructor === g` 原生 false——真 constructor 是
      // GeneratorFunction.prototype，不回指 g）。箭头/async/方法保持
      // exact undefined（原生无 prototype）。
      // Bug 325：async generator（kind:"async-generator"）同样有原生
      // prototype（%AsyncGeneratorFunction.prototype%）⇒ 同款 brand 面。
      const fnKind = getFnImpl(o)?.fnKind;
      if (fnKind === "generator" || fnKind === "async-generator") {
        return generatorProtoBrandOf(o);
      }
      // Bug 243：Intl 子构造器（Intl.<Sub>）的 .prototype 是**真正的原型
      // 对象**（带 brand 的原型面）——其上的 brand check 访问器
      // （Intl.NumberFormat.prototype.format / Intl.Collator.prototype
      // .compare / Intl.Locale.prototype.baseName）读即定抛 TypeError，
      // 需要原型 brand 才有落点。此前 fnProtoOf 只装 constructor 一个槽
      // （闭 obj）⇒ 原型成员读全部落槽 miss ⇒ 折 exact undefined 且不记
      // throws（L2 门禁假绿）。
      const fnName = (o.shape as { name?: string }).name;
      if (fnName !== undefined && fnName.startsWith("Intl.") && INTL_SUB_CTORS.has(fnName.slice(5))) {
        return protoBrandAbs(fnName);
      }
      return o.shape.ctor === false
        ? undef()
        : // P3b：fn 的 prototype 对象身份按 fn Abs 驻留（原生每 fn 唯一
          // 共享 prototype）——此前每次读捏新闭 obj，`Base.prototype.x = 1`
          // 写后读丢、`f.prototype === f.prototype` 恒等丢。constructor 槽
          // 指回 fn 自身（MakeConstructor 语义，=== 折 exact）。
          fnProtoOf(o);
    }
  }
  // 数组 length：成员路径（a.length += 1 等复合写）与 a.length 读同源
  if ((o.shape.k === "tuple" || o.shape.k === "arr") && key === "length") {
    return $len(o);
  }
  // 元组下标字符串键（a["0"] ≡ a[0]）；确定非下标自有键 → undefined
  // （原型方法 / Symbol.iterator 不在此列，继续走下方方法投影）
  if (o.shape.k === "tuple") {
    const idx = canonicalArrayIndex(key);
    const els = o.shape.elements;
    if (idx !== undefined) return idx < els.length ? els[idx]! : undef();
    if (!isPossiblyProtoMemberKey(key)) return undef();
  }
  // 字符串下标字符串键（s["1"] ≡ s[1]）；确定非下标自有键 → undefined
  // （与元组同口径 canonicalArrayIndex；length/原型方法继续走下方投影）
  if (o.shape.k === "prim" && (o.shape as { type?: string }).type === "string") {
    const idx = canonicalArrayIndex(key);
    const svR = litValue(o);
    const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
    if (idx !== undefined) {
      if (typeof sv === "string") return idx < sv.length ? $lit(sv[idx]!) : undef();
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
    if (key === "length" && typeof sv === "string") return numLit(sv.length);
    // Bug 49：String.prototype 专有方法（trim/charAt/padStart/bold/…）是
    // 可能的原型成员——不折 undef（否则 typeof "ab".trim === "undefined"
    // 错误具体值）；其余确定非下标非方法键仍 undefined（原生 s.foo）
    if (!isPossiblyProtoMemberKey(key) && !STRING_METHODS.has(key) && key !== "length") {
      return undef();
    }
  }
  // 元组/数组/prim 上的 Object.prototype / Array.prototype / prim 原型方法读取
  const primProtoMethods =
    o.shape.k === "prim"
      ? PRIM_PROTO_METHOD_NAMES[(o.shape as { type?: string }).type ?? ""]
      : undefined;
  if (
    (o.shape.k === "tuple" || o.shape.k === "arr" || o.shape.k === "prim") &&
    (OBJECT_PROTO_METHOD_NAMES.has(key) ||
      (o.shape.k !== "prim" && ARRAY_PROTO_METHOD_NAMES.has(key)) ||
      primProtoMethods?.has(key) === true)
  ) {
    if ((o.shape.k === "tuple" || o.shape.k === "arr") && (key === "toString" || key === "toLocaleString" || key === "join")) {
      return arrayMethodAbs(key === "join" ? "join" : key);
    }
    // Array.prototype 方法 / Symbol.iterator：一等函数（typeof a.push === "function"）。
    // Bug 56：具名方法升级为方法值读通道（apply 钩子转发借用调用
    // [].push.call(a, v)；@@iterator 维持无 impl 形状——迭代协议派发另走）。
    if (o.shape.k !== "prim" && (ARRAY_PROTO_METHOD_NAMES.has(key) || key === "@@iterator")) {
      if (key !== "@@iterator") return protoMethodValueAbs("Array", key);
      return { shape: { k: "fn", params: [], ctor: false }, conf: "path" };
    }
    // Bug 219：symbol prim 的 toString / toLocaleString / valueOf —— 原生取自
    // **Symbol.prototype 自己的面**（toString / valueOf 自有；toLocaleString
    // 继承 Object.prototype 的 toLocaleString → this.toString()）。此前落
    // Object.prototype 泛型版（**无 brand check**）→ 错值 "[object Number]" /
    // "[object Symbol]"，且借用调用漏抛 TypeError（`Symbol().toString.call(1)`
    // 原生定抛）。走 Symbol.prototype 通道（brand check + 描述串）。
    if (
      (o.shape as { type?: string }).type === "symbol" &&
      (key === "toString" || key === "toLocaleString" || key === "valueOf")
    ) {
      return symbolProtoMethodAbs(key);
    }
    // string.toString/valueOf 由 callAbsMethod 处理调用；一等读取仍给 OP 函数
    if (
      primProtoMethods?.has(key) === true &&
      (!OBJECT_PROTO_METHOD_NAMES.has(key) ||
        // 唯一例外：string prim 的 toString（此前被显式排除落 unknown，
        // Bug 49 值读面）——OP 泛型 toString 会折 "[object String]"，走
        // prim 通道才有 String.prototype.toString 域
        ((o.shape as { type?: string }).type === "string" && key === "toString") ||
        // Bug 105：bigint prim 的 toString/toLocaleString 是 BigInt.prototype
        // 自有方法——OP 泛型版折 "[object BigInt]"（假精确，原生是十进制/
        // 本地化数字串），必须走 prim 通道（apply 钩子 → $invoke bigint 臂）
        ((o.shape as { type?: string }).type === "bigint" && (key === "toString" || key === "toLocaleString")))
    ) {
      // Bug 49：prim 专有原型方法（trim/toFixed/…）——方法值读通道：
      // apply 钩子转发 callAbsMethod 既有派发
      return protoMethodValueAbs((o.shape as { type: string }).type, key);
    }
    return objectProtoMethodAbs(key);
  }
  // Bug 218：number / boolean / bigint / symbol **原始值**读不存在的成员 →
  // 原生 undefined（不是 unknown）。此前这类 prim 无「确定缺失」臂 → 一路
  // 落尾部 unknown 接收者分支：既折了错值（unknown 而非 undefined），又
  // **丢掉 may-throw**（unknown 接收者不记 throws）⇒ 后续读该值
  // （`n.foo.bar`）不记 TypeError ⇒ L2 门禁假绿。string prim 早有同款臂
  // （上方），此处补齐其余 prim。
  if (o.shape.k === "prim" && (o.shape as { type?: string }).type !== "string") {
    // 确定非下标非方法键 → undefined（原生 (5).foo === undefined）。
    // 「可能存在的原型成员」不在此列（constructor / __proto__ / Object 与
    // Array 原型名 / @@ 符号键 / 该 prim 自己的原型方法表）——它们走下方
    // 各自的投影面，不得折 undef。
    if (!isPossiblyProtoMemberKey(key) && !primProtoMethods?.has(key)) {
      return undef();
    }
  }
  // OOB 合成 undefined 接收者（抽象下标可能 miss 后的成员读）：引擎精度
  // 产物，不记 may-throw / 不硬抛；marker 透传（issue #98）。透传是有意
  // 的召回权衡：越界读本身不抛、读到的 undefined 再被成员读原生必抛
  // TypeError，而 marker 无法区分「循环不变量保证在界内」（#98 循环 DP
  // 表，要零误报）与「真实无约束下标」（如 d[i][0] 原生 h(5) 必抛，此处
  // 穿门不报）——按类压制换 #98 零误报；理想收窄 = Φ 导出下标在界 pred。
  if (isOobUndef(o)) return o;
  // any / nullish：throws 域（design-cli-semantics §3.3）
  if (noteNullishMemberThrows(o, key, "property")) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (o.shape.k === "any") {
    if (!opts?.silent) noteAnyMemberMayThrow(o, key, "property");
    return anyMemberResult();
  }
  if (isObj(o)) {
    const acc = lookupObjAccessor(o, key);
    // Bug 235：receiver 优先（Proxy 无 get 陷阱转发读靶时，靶上 getter 的
    // this 必须是 receiver=proxy，不是 target）
    if (acc) return acc.get ? acc.get(receiver ?? o) : undef();
    const slot = getSlot((o.shape as ObjShape).slots, key);
    if (slot) {
      // optional 槽在 JS 中可能缺席 → 读到 undefined，不能报 definite presence
      if (slot.optional) return joinAbs(slot.value, undef());
      return slot.value;
    }
    // Bug 195：数组视图对象（模板对象 / RegExp exec 结果——原生是数组 exotic）
    // 上的**数组原型方法**（join / indexOf / concat / map / slice…）可派发：
    // 原生模板对象继承 Array.prototype。此前 obj 接收者的数组方法面只认
    // tuple/arr 形状 ⇒ 方法读落「确定不存在」折 exact undefined ⇒ 调用
    // **假抛 TypeError**（原生不抛）。
    if (ARRAY_PROTO_METHOD_NAMES.has(key) && isMatchArrayView(o)) {
      return arrayViewMethodAbs(key);
    }
    // Object.prototype 方法（非 null-proto）：一等函数读取
    if (!isNullProtoObj(o) && OBJECT_PROTO_METHOD_NAMES.has(key)) {
      return objectProtoMethodAbs(key);
    }
    // Object.prototype.__proto__ 访问器（Bug 17）：读 [[Prototype]]——与
    // Object.getPrototypeOf 的 protoOfRecv 投影同款（闭字面量原型恰为
    // Object.prototype 单例、open 走 protoTable/unknown），不得折精确
    // undefined；null-proto 无该访问器 → 原生读 undefined（不是 null）。
    // protoTable 原型自身是 null-proto 对象时访问器同样缺席 → undefined。
    if (key === "__proto__") {
      if (isNullProtoObj(o)) return undef();
      const p = protoOfRecv(o);
      return isNullProtoObj(p) ? undef() : p;
    }
    // Bug 217：开放对象**声明的索引值域**（shape.index.value）——成员读
    // 优先用它（process.env.HOME → string | undefined），
    // 无索引声明才退 unknown（那才是真正的「推断失败」）。此前该臂
    // 无条件 return unknown ⇒ 丢弃声明值域 ⇒ envObj() 折
    // Record<string, string | undefined> 而成员读折 unknown（两面矛盾）
    // + 触发假 nudo:unknown-inference。符号键例外：原生
    // process.env[Symbol.iterator] → undefined（env 无符号键）。
    if ((o.shape as ObjShape).open) return openIndexValueOf(o, opts?.symbolKey === true) ?? unknown;
    // Object.prototype.constructor（null-proto 无 → undef）
    if (key === "constructor" && !isNullProtoObj(o)) {
      return builtinCtorAbs("Object");
    }
    // C0.5：闭 shape 缺槽且求值命中 → 可选 nudo:missing-slot（默认 off）
    noteObjSlotMissing(o, key);
    return undef();
  }
  if (o.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const parts = o.shape.members.map((m) => $get(m, key, opts));
    return parts.length ? parts.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
  // prim / tuple / arr / fn / eff 的 __proto__（Bug 17）：Object.prototype
  // 访问器读 [[Prototype]]——protoOfRecv 同款投影（tuple/arr →
  // Array.prototype、prim → 装箱原型、fn → Function.prototype）；null-proto
  // 标记（setPrototypeOf(…, null) 产物）无访问器 → 原生 undefined。
  // nullish/unknown/any 形状不在此列（访问器存在性不可判，走底部诊断路径）。
  if (
    key === "__proto__" &&
    (o.shape.k === "prim" || o.shape.k === "tuple" || o.shape.k === "arr" ||
      o.shape.k === "fn" || o.shape.k === "eff")
  ) {
    return isNullProtoObj(o) ? undef() : protoOfRecv(o);
  }
  // prim / tuple / arr / fn / eff 的原型 constructor（上文未命中自有槽）
  if (key === "constructor") {
    const cn = ctorNameOfRecv(o);
    if (cn) return builtinCtorAbs(cn);
  }
  if (!opts?.silent) {
    // nullish → may-throw TypeError（soft，不中断求值）
    if (noteNullishMemberThrows(o, key, "property")) {
      return unknown;
    }
    // any（无约束）→ may-throw TypeError；结果保持 any
    if (noteAnyMemberMayThrow(o, key, "property")) {
      return anyMemberResult();
    }
    // unknown（推导失败）→ unknown-recv 引擎债（$invoke 自己报 method）
    noteUnknownMemberMissing(o, key, "property");
    noteObjSlotMissing(o, key);
  }
  return unknown;
}

/** P3b：$set fn 臂自建槽的 fn Abs 集（与出生自带 slots 的 dual-facet env fn
 *  区分——后者就地突变会跨 run 泄漏，维持只读）。 */
const userFnSlots = new WeakSet<object>();

/** Bug 291：fn 是否有自有该键（expando 槽）——sealed/nonext 的新键写门用 */
function hasFnOwnKey(o: Abs, key: string): boolean {
  const slots = (o.shape as { slots?: Record<string, unknown> }).slots;
  return !!slots && Object.prototype.hasOwnProperty.call(slots, key);
}

/**
 * Bug 205：宿主函数（转译的函数声明 / 函数表达式）**不是 Abs**——写面此前
 * 直接丢弃（`F.prototype = {}` 引擎完全无感：原型替换不可观测，instanceof
 * 只能按构造器**名**匹配 → unsound 的肯定判断，类型守卫会走错分支）。
 *
 * 建 **facade**：一等 fn Abs 承载写面槽（prototype），调用点根绑定重绑到它
 * （转译侧单层成员写是 `F = $set(F, "prototype", v)`）——原生换的是构造器的
 * prototype **属性**，facade 保留宿主函数身份（name / length / 可构造性 /
 * 调用 impl 全透传），prototype 槽读回即新原型。
 *
 * 键域**只限 "prototype"**：其它键（`F.x = 1` 之类 expando）此前是 no-op，
 * 不在 Bug 205 范围内，不改（避免牵动无关用例）。
 */
const hostFnFacades = new WeakMap<object, Abs>();

function hostFnFacadeOf(hostFn: Function): Abs {
  const cached = hostFnFacades.get(hostFn as object);
  if (cached) return cached;
  const facade = asAbsVal(hostFn);
  if (facade.shape.k !== "fn") return facade;
  // 槽面自建（与 $set 的 fn 臂同款：userFnSlots 只认本机制自建的槽）
  facade.shape = { ...facade.shape, slots: {} };
  userFnSlots.add(facade);
  hostFnFacades.set(hostFn as object, facade);
  return facade;
}

/** 宿主函数的 prototype 写：落进 facade 的 "prototype" 槽，返回 facade。 */
function hostFnPrototypeSet(hostFn: Function, value: Abs): Abs {
  const facade = hostFnFacadeOf(hostFn);
  const slots = facade.shape.k === "fn" ? facade.shape.slots : undefined;
  if (slots) {
    setSlot(slots, "prototype", { value: asAbsVal(value) });
    facade.conf = confJoin(facade.conf, value.conf);
    clearStaleTermPred(facade);
  }
  return facade;
}

/** 成员写：返回新 obj/brand（不可变更新）；frozen/sealed/只读目标按 sloppy 静默失败。
 *  opts.internal（Bug 84）：私有字段落地——槽打 Slot.internal 标记；后续覆写
 *  保留既有标记（this.#x = v 不丢失 internal）。
 *  opts.symbolKey（Bug 73）：计算 symbol 键投影（[Symbol.X] → "@@X"）落地
 * ——槽打 Slot.symbolKey 标记（JSON.stringify 等字符串键枚举面跳过）；
 *  覆写保留既有标记。 */
export function $set(
  o: Abs,
  key: string,
  value: Abs,
  opts?: { internal?: boolean; symbolKey?: boolean },
): Abs {
  // 私有名（"#" 键）：foreign-receiver brand check（PrivateFieldSet）
  privateNameGuard(o, key);
  // DEC-006 B/C：free identifier 可能把宿主值（globalThis…）漏进来——
  // 非 Abs 目标 fail-closed 返回原接收者（调用点 `root = $set(root, …)` 重绑
  // 为自赋值 no-op），禁止读 .shape 炸宿主 TypeError（$get 同口径）
  if (!o || typeof o !== "object" || !("shape" in (o as object))) {
    // Bug 205：宿主函数（转译的函数声明 / 函数表达式）不是 Abs——写此前
    // 直接丢弃（`F.prototype = {}` 引擎完全无感：原型替换不可观测，
    // instanceof 只能按构造器名匹配 → unsound 的肯定判断）。此处建
    // **facade**（一等 fn Abs 承载 prototype 槽）并返回——调用点根绑定
    // 重绑到它（`F = $set(F, "prototype", v)`），原型替换遂可观测。
    if (typeof o === "function" && key === "prototype") {
      return hostFnPrototypeSet(o as Function, value);
    }
    // Bug 291 顺带：宿主函数（转译的**函数声明**）的**任意键**写也要过
    // 不变性门——原生 `Object.freeze(f); f.x = 1` 在 strict 下定抛 TypeError
    // （函数亦是不可扩展对象）；此前非 prototype 键直接 no-op ⇒ 冻结的
    // 函数声明仍可加新键（**假冻结**）。facade 取 asAbsVal 的**稳定门面**
    // （同一宿主函数恒同一 Abs ⇒ extState / flags 跨调用可见）。
    if (typeof o === "function") {
      const facade = asAbsVal(o as Function);
      const st = extStateOf(facade);
      if (st === "frozen") throwStrictWrite();
      if ((st === "sealed" || st === "nonext") && !hasFnOwnKey(facade, key)) {
        throwStrictWrite();
      }
    }
    return o;
  }
  if (o.shape.k === "brand") {
    // Bug 116：strict 毒丸——arguments.callee 写定抛（node 实测 strict 下
    // 赋值同抛；caller 写是普通数据属性不毒）
    if (o.shape.name === "Arguments" && key === "callee") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // Bug 71：Proxy——set 陷阱优先（实参 (target, key, value, receiver)、
    // this = handler）；返回字面量 false → strict TypeError（硬抛，catch 可
    // 吸收）；无陷阱回转发写靶（原地；brand inner 即 target 引用，身份不
    // 变）。陷阱体内 t[k]=v 经 $set 原地突变对代理读可见
    if (o.shape.name === "Proxy") {
      const parts = proxyPartsOf(o);
      if (parts) {
        const trap = proxyTrapOf(parts.handler, "set");
        if (trap.k === "fn") {
          // Bug 149：符号键的陷阱实参是真 symbol（规范 PropertyKey），不是 "@@X" 串
          const res = $call(trap.fn, [parts.target, trapKeyAbs(key, opts?.symbolKey), value, o], parts.handler);
          const rv = litValue(res);
          // Bug 209：set 陷阱返回值按规范 **ToBoolean**——falsy（0 / "" / null /
          // undefined / false）→ strict TypeError；此前只认字面量 false，其余
          // falsy 静默通过（原生 strict 下 falsy 皆抛）。
          if (rv.ok && !rv.value) throwStrictWrite();
          return o;
        }
        if (trap.k === "dead" || trap.k === "opaque") {
          recordMayThrow({ kind: "TypeError", cause: `Proxy set trap for '${key}' not callable / unknown` });
          return o;
        }
        $set(parts.target, key, value, opts);
        o.conf = confJoin(o.conf, value.conf);
        return o;
      }
      // 无侧表（退化副本）：沿通用 brand 内层（inner = target）路径
    }
    if (extStateOf(o) === "frozen") throwStrictWrite();
    const isClassVal = classNameOfValue(o as object) === o.shape.name;
    if (isClassVal) {
      const sacc = findStaticClassAccessor(o.shape.name, key);
      if (sacc) {
        if (sacc.set) return sacc.set(o, value);
        // Bug 225：getter-only 静态访问器——strict 写原生 TypeError（与实例
        // 面同款，见下方实例分支的 throwStrictWrite）；此前 `sacc.set ?
        // … : o` 静默吞写（写穿无声，类字面体的 static get 写不抛）。
        throwStrictWrite();
      }
      // Bug 206：类值的 prototype 是不可写 / 不可配置 / 不可枚举的 own
      // property（原生 ClassDefinitionEvaluation）——`A.prototype = {}` 在
      // strict 下定抛 TypeError；此前无「prototype 非可写」门 → 落到通用
      // 槽写（写穿后类照常工作，换原型这件事在引擎侧完全无感）。
      // 例外：引擎内部的 defineProperty 写回（把**就地改过**的原型对象重新
      // 装回类值——值是同名原型 brand）——原生那一次是「就地改原型对象」，
      // 不是给 C.prototype 赋值，不得被本门拦下（值判据：同名原型 brand）。
      if (key === "prototype") {
        const writeback = value.shape.k === "brand" && value.shape.name === `${o.shape.name}.prototype`;
        if (!writeback) throwStrictWrite();
      }
      if (findClassAccessor(o.shape.name, key)) return o;
      // Bug 197：静态面 defineProperty 装的**不可写**属性（writable:false）→
      // strict 写原生 TypeError；此前静态面只看类注册表访问器，flags 面
      // （defineProperty 的 writable:false）完全没查 → 写穿无声（假绿）。
      if (getPropFlags(o)?.get(key)?.writable === false) throwStrictWrite();
    } else {
      const acc = findClassAccessor(o.shape.name, key);
      if (acc) {
        if (acc.set) return acc.set(o, value);
        // getter-only：strict → TypeError（硬抛，catch 可吸收）
        throwStrictWrite();
      }
      // 类实例字段就地突变：原生引用共享语义——方法内 this.n = v 对
      // 调用点持有的同一实例 Abs 可见（不可变更新会只改局部绑定）
      const inner = o.shape.shape;
      if (inner.shape.k === "obj") {
        // Bug 103：内建 brand 的 getter-only 原型访问器（$in presence 表
        // BUILTIN_BRAND_ACCESSORS：TA/DV 的 length/byteLength/byteOffset/
        // BYTES_PER_ELEMENT、Map/Set.size、RegExp.source/flags 等）——strict
        // 写原生 TypeError；此前落新自有槽 → 假写成功 + 假读回。例外仅
        // opts.internal（引擎簿记写）。已知偏差：defineProperty 以
        // writable:true 自建数据槽后覆写（原生成功）此处仍抛——descriptor
        // 的 writeInPlace 复用原 Abs 身份不迁移 propFlags 侧表，豁免不可
        // 判（构造器工件槽同无标记，不可放行）；超罕见边，留侧表迁移任务。
        if (!opts?.internal && BUILTIN_BRAND_ACCESSORS[o.shape.name]?.has(key)) {
          throwStrictWrite();
        }
        // Bug 197：类实例的 [[Set]] 原型链写门——receiver **无自有该键**时，
        // 原生沿 [[Prototype]] 链上溯（A.prototype → 父类原型 → …）：首个
        // 持有该键的原型的访问器（无 setter）/ 不可写数据属性 / frozen 原型
        // ⇒ strict TypeError；带 setter → 派发 setter（不是静默建自有属性）。
        // 此前类实例面**完全不过写门**（protoChainSetVerdict 只查 protoTable，
        // 类实例未登记 ⇒ 链恒空 ⇒ 门恒 allow）⇒
        // `Object.defineProperty(A.prototype, "y", { get(){…} })` 之后
        // `a.y = 1` 静默写穿（原生定抛，门禁假绿）。
        // 类字面量访问器由上方 findClassAccessor 覆盖（注册表面）；此处补
        // **动态装到原型上**的访问器 / 只读数据属性（原型槽面）。
        if (!getSlot(inner.shape.slots, key)) {
          const verdict = protoChainSetVerdict(o, key);
          if (verdict.kind === "deny") throwStrictWrite();
          if (verdict.kind === "setter") return verdict.setter(o, value);
        }
        const st = extStateOf(o);
        if ((st === "sealed" || st === "nonext") && !getSlot(inner.shape.slots, key)) {
          throwStrictWrite(); // 不可扩展：新键写 TypeError
        }
        if (getPropFlags(o)?.get(key)?.writable === false) throwStrictWrite();
        // Bug 84：覆写保留既有 internal 标记（this.#x = v 不丢 introspection 不可见性）
        // Bug 73：symbol 键投影标记同语义保留
        // Bug 66：inherited 槽（errorBrandAbs 的 name——原型链解析槽）公有
        // 覆写落地转自有——新槽不携带 inherited，并清 enumerable:false 侧表
        //（原生 e.name = "X" / 子类 name 字段建自有可枚举属性；message/
        // stack 自有不可枚举槽覆写不受影响，侧表保持）
        const prevSlot = getSlot(inner.shape.slots, key);
        setSlot(inner.shape.slots, key, {
          value: asAbsVal(value),
          ...(prevSlot?.internal || opts?.internal ? { internal: true } : {}),
          ...(prevSlot?.symbolKey || opts?.symbolKey ? { symbolKey: true } : {}),
        });
        if (prevSlot?.inherited && !opts?.internal) {
          setPropFlags(inner, key, { enumerable: true });
        }
        clearStaleTermPred(o);
        return o;
      }
    }
    const inner = $set(o.shape.shape, key, value, opts);
    const next = abs(
      { k: "brand", name: o.shape.name, shape: inner },
      o.term,
      o.pred,
      confJoin(o.conf, value.conf),
    );
    // 类 Abs 不可变更新后仍是类值（静态访问器派发依赖身份）
    const clsName = classNameOfValue(o as object);
    if (clsName) markClassValue(next as object, clsName);
    return next;
  }
  // a.length = n：合法域是非负整数 ≤ 2^32-1（4294967295），其余原生 RangeError；
  // 合法且巨大（原生稀疏数组）不物化——就地降 arr（元素 ∪ undefined、长度未知）。
  // 抽象值按 sound 回退：元素与 undefined 取并、长度未知
  if (o.shape.k === "tuple" && key === "length") {
    const st = extStateOf(o);
    if (st === "frozen") throwStrictWrite();
    // Bug 231：原生 ArraySetLength 先 ToNumber(value) 再判整数与界——引擎
    // 此前只判「**数字**字面量」，`undefined` / `{}` / "abc" 等**具体非数值**
    // 落进抽象回退（不抛）→ 原生 RangeError 缺失（门禁假绿）。域判定统一
    // 走 lengthToNumber：nan → RangeError；typeerror（Symbol）→ TypeError；
    // abstract（不可判定）→ 仍按 sound 回退（原生本身不可判定）。
    const len = lengthToNumber(value);
    if (len.kind === "typeerror") throw new NudoThrow(errorTypeAbs("TypeError"));
    if (len.kind === "nan") throw new NudoThrow(errorTypeAbs("RangeError"));
    if (len.kind === "num") {
      const v = len.n;
      // 负数/小数/NaN/Infinity/≥2^32：原生 hard RangeError（catch 可吸收）
      if (!Number.isInteger(v) || v < 0 || v > 4294967295) {
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
      // Bug 223：sealed 数组 length **截断**写要删除被截掉的元素——sealed 的
      // 元素是不可配置自有属性 → 原生 TypeError（"Cannot delete property
      // '2'"）。增长合法（新增 hole，不删任何属性）；preventExtensions
      // （nonext）不冻结元素 → 截断不抛（node 实测）。
      if (st === "sealed" && v < o.shape.elements.length) throwStrictWrite();
      if (v > TUPLE_MATERIALIZE_CAP) {
        // 合法但巨大：不物化巨 tuple
        o.shape = widenTupleToArr(o.shape.elements, o.shape.holes, undefined);
        o.conf = confJoin(o.conf, "path");
        clearStaleTermPred(o);
        return o;
      }
      const els = o.shape.elements.slice(0, v);
      while (els.length < v) els.push($lit(undefined));
      // 截断过滤 + 延长新增：延长部分（[oldLen, v)）全是 hole
      const oldLen = o.shape.elements.length;
      const holes = (o.shape.holes ?? []).filter((h) => h < v);
      for (let h = oldLen; h < v; h++) holes.push(h);
      // 就地写回（引用语义：别名同步）
      o.shape = {
        k: "tuple",
        elements: els,
        holes: holes.length > 0 ? holes : undefined,
      };
      clearStaleTermPred(o);
      return o;
    }
    const joined =
      o.shape.elements.length > 0
        ? o.shape.elements.reduce((a, b) => joinAbs(a, b))
        : unknown;
    o.shape = { k: "arr", element: joinAbs(joined, $lit(undefined)) };
    o.conf = "partial";
    clearStaleTermPred(o);
    return o;
  }
  if (o.shape.k === "arr" && key === "length") {
    // 抽象数组也是数组：非法 length 同样原生 RangeError（Bug 231：域判定
    // 统一走 lengthToNumber——具体非数值（undefined / {}）也定抛）。
    const len = lengthToNumber(value);
    if (len.kind === "typeerror") throw new NudoThrow(errorTypeAbs("TypeError"));
    if (len.kind === "nan") throw new NudoThrow(errorTypeAbs("RangeError"));
    if (len.kind === "num") {
      const v = len.n;
      if (!Number.isInteger(v) || v < 0 || v > 4294967295) {
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
    }
    o.conf = "partial";
    clearStaleTermPred(o);
    return o;
  }
  // P3b：fn 值 expando 静态写（`Base.px = 5` / 借用原型挂方法等）——
  // slotless 用户/transpile fn 就地建槽（引用语义：别名与子类链静态读
  // 共享同一槽面）。dual-facet env fn（出生自带 slots 的内建静态面，
  // Number.isFinite 等）不就地改——env Abs 可能跨 run 复用，原地突变
  // 泄漏到后续分析（既有不写口径维持：userFnSlots 只认本机制自建的槽）。
  if (o.shape.k === "fn") {
    // Bug 197：fn 上的 defineProperty **不可写**属性（writable:false）→
    // strict 写原生 TypeError；此前 fn 臂只建槽（flags 面完全没查）→
    // 写穿无声（假绿）。
    if (getPropFlags(o)?.get(key)?.writable === false) throwStrictWrite();
    // Bug 291：frozen / sealed（不可扩展）函数的写门——与 obj 臂同款：
    // frozen 全写 TypeError；sealed/nonext 新键 TypeError（strict 硬抛）。
    // 原生 `Object.freeze(f); f.x = 4` → TypeError（函数亦是不可扩展对象）
    // ——此前 fn 臂不读 extState ⇒ 冻结的函数仍可写（假冻结）。
    const st = extStateOf(o);
    if (st === "frozen") throwStrictWrite();
    if ((st === "sealed" || st === "nonext") && !hasFnOwnKey(o, key)) throwStrictWrite();
    if (o.shape.slots === undefined) {
      o.shape = { ...o.shape, slots: {} };
      userFnSlots.add(o);
    }
    if (o.shape.slots && userFnSlots.has(o)) {
      setSlot(o.shape.slots, key, { value: asAbsVal(value) });
      o.conf = confJoin(o.conf, value.conf);
      clearStaleTermPred(o);
    }
    return o;
  }
  if (!isObj(o)) {
    // strict/ESM 写语义：确定非对象目标原生 TypeError（硬抛，catch 可吸收）。
    // 此前一律 `return $obj({...})` 伪造对象——prim/空值静默成功（L2 漏报）、
    // 数组目标被整体替换为对象（最坏假精确）。
    const sk = o.shape.k;
    // nullish 字面量（$lit(null/undefined) 是 unknown+lit term）与 prim：原生必抛
    if (sk === "prim" || sk === "never" || isNullishAbs(o)) throwStrictWrite();
    // any：可能成功（对象）也可能 TypeError——软 may-throw，目标不变
    if (sk === "any") {
      noteAnyMemberMayThrow(o, key, "property");
      return o;
    }
    if (sk === "unknown") {
      noteUnknownMemberMissing(o, key, "property");
      return o;
    }
    // 数组 expando 属性（a.x = 1）：无槽位模型——tuple 就地降 arr（长度/元素保持）
    if (sk === "tuple") {
      o.shape = widenTupleToArr(o.shape.elements, o.shape.holes, value);
      o.conf = confJoin(o.conf, "path");
      clearStaleTermPred(o);
      return o;
    }
    // sum：成员含确定非对象 → 写可能 TypeError（软）；否则写成功但无槽位模型
    if (sk === "sum" && o.shape.members.some((m) => m.shape.k === "prim" || m.shape.k === "never")) {
      recordMayThrow({
        kind: "TypeError",
        cause: `property '${key}' write on sum (non-object member)`,
        recv: "sum",
        name: key,
      });
    }
    return o;
  }
  const shape = o.shape as ObjShape;
  const st = extStateOf(o);
  const hasKey = Object.prototype.hasOwnProperty.call(shape.slots, key);
  // frozen：全写 TypeError；sealed/nonext：新键 TypeError（strict 硬抛）
  if (st === "frozen") throwStrictWrite();
  if ((st === "sealed" || st === "nonext") && !hasKey) throwStrictWrite();
  // defineProperty writable:false：写 TypeError
  if (getPropFlags(o)?.get(key)?.writable === false) throwStrictWrite();
  const acc = lookupObjAccessor(o, key);
  if (acc) {
    if (!acc.set) throwStrictWrite(); // getter-only：写 TypeError
    return acc.set(o, value);
  }
  // `o.__proto__ = v` 走 Object.prototype setter（设原型）；null-proto 无 setter
  // → 自有数据属性。不得 slots[key]=（宿主 __proto__ setter 丢键）。
  if (key === "__proto__" && !isNullProtoObj(o)) {
    return $setProto(o, value);
  }
  // Bug 197：[[Set]] 原型链写门——receiver **无自有该键**时，原生沿
  // [[Prototype]] 链上溯找第一个「持有该键」的原型：访问器（无 setter）/
  // 不可写数据属性 / frozen 原型 → strict TypeError；命中带 setter 的
  // 访问器 → **派发 setter**（不是静默建自有属性）。此前只看自有槽与类
  // 注册表 → 原型链上的访问器/不可写槽被跳过（写穿无声，门禁假绿）。
  if (!hasKey) {
    const verdict = protoChainSetVerdict(o, key);
    if (verdict.kind === "deny") throwStrictWrite();
    if (verdict.kind === "setter") return verdict.setter(o, value);
  }
  // 就地写槽（引用语义：const b = o; b.x = v 对 o 可见）——Abs 身份不变
  // Bug 84：覆写保留既有 internal 标记 / opts.internal 新打标
  // Bug 73：symbol 键投影标记同语义保留 / opts.symbolKey 新打标
  const prevSlot = getSlot(shape.slots, key);
  setSlot(shape.slots, key, {
    value: asAbsVal(value),
    ...(prevSlot?.internal || opts?.internal ? { internal: true } : {}),
    ...(prevSlot?.symbolKey || opts?.symbolKey ? { symbolKey: true } : {}),
  });
  o.conf = confJoin(o.conf, value.conf);
  clearStaleTermPred(o);
  return o;
}

// ---------------------------------------------------------------------------
// Bug 315：接收者 toString 解析钩子注册（Object.prototype.toLocaleString
// 委派 this.toString()）
// ---------------------------------------------------------------------------
/**
 * Bug 315：`Object.prototype.toLocaleString` 委派**接收者的 toString()**
 * （原生表：`{toString(){return "CUSTOM"}}` → "CUSTOM"；抛错原样冒泡；
 * `Object.create(null)` 接收者 → TypeError；`[1,2]` → "1,2"；`5` → "5"）。
 * builtins/object-proto.ts 侧是 builtins 层（不能直连 exec 的 $get——反向
 * 依赖成环）⇒ 按 protoMethodDispatch 同款注册式注入：这里把「读接收者的
 * toString 成员」委派给**成员机制**（$get：自有槽 / 访问器 getter 求值 /
 * 类方法派发 / 数组·prim 原型方法面），builtins 侧只管「取到可调用值后
 * 以接收者为 this 调用」。
 *
 * 直接 import builtins/object-proto.ts（不经 barrel）——barrel 未导出该
 * 注册函数，且本分片不改 barrel（与上方 collectionIteratorFor /
// isMatchArrayView 的直连口径同款）。
 */
setReceiverToStringResolver((recv: Abs): Abs | undefined => {
  // prim 接收者：走 **prim 原型方法通道**（Bug 49/105/219 口径）——通用 OP
  // toString 只折标签（"[object Number]"，假精确；原生 (5).toString() →
  // "5"、true.toString() → "true"）。
  if (recv.shape.k === "prim") {
    const ptype = (recv.shape as { type?: string }).type ?? "";
    if (ptype === "symbol") return symbolProtoMethodAbs("toString");
    if (PRIM_PROTO_METHOD_NAMES[ptype]?.has("toString")) {
      return protoMethodValueAbs(ptype, "toString");
    }
  }
  return $get(recv, "toString", { silent: true });
});
