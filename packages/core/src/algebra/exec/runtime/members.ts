/**
 * 访问器（get/set）侧表、in / instanceof / delete 路由。
 *
 * Bug 149：符号键（Symbol.iterator 等）按**宿主身份**反查 "@@X" 内部槽键
 * 寻址（与读写面同口径），Proxy has 陷阱收到**真 symbol**（规范
 * PropertyKey）——不再在「键不可判」处提前 return（陷阱此前完全不派发）。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, strLit, unknown, type Confidence } from "../../abs.ts";
import { lit } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import { absFunction, getFnImpl } from "../../abs-fn.ts";
import { joinAbs, isObj, type ObjShape, type Slot, isNullProtoObj, getSlot, canonicalArrayIndex, propertyKeyOf, getProtoAbs } from "../../objects.ts";
import { isNullishLitAbs } from "../../surface.ts";
import { isMapAbs, isSetAbs, mapSizeAbs, setSizeAbs } from "../../collections.ts";
import {
  evalNamespaceCall, extStateOf, getPropFlags, migrateInvariants,
  isObjectProtoBrand, OBJECT_PROTO_METHOD_NAMES, isSymbolAbs,
  symbolDescriptionAbs, objectProtoBrand, builtinCtorAbs, ctorNameOfRecv,
  protoOfRecv, hostBuiltinCtorName, protoBrandAbs,
} from "../../builtins.ts";
import { errorTypeAbs, recordMayThrow, type MayThrowEffect } from "../may-throw.ts";
import { TYPED_ARRAY_ELEMENT } from "../../builtins/shared.ts";
import { OBJECT_PROTO_NAMES, ARRAY_PROTO_METHOD_NAMES } from "../member-diag.ts";
import { $call } from "../call.ts";
import { proxyPartsOf, proxyTrapOf } from "../match-iter.ts";
import { slotKeyOfSymbolAbs } from "./symbol-key.ts";
import { getEvalClass, lookupClassValue, BUILTIN_ERROR_SUPER, fnProtoOf } from "../class-registry.ts";
import { classNameOfValue, markClassValue } from "../../class-mark.ts";
import { NudoThrow, noBody, undef, throwStrictWrite, writeInPlace, clearStaleTermPred, asAbsVal, isDefinitelyTrue, isDefinitelyFalse, currentExecPhi, $lit, litTruth } from "./state.ts";
import { $typeof, $eq, $ne } from "./ops.ts";
import { $objAccessor, lookupObjAccessor, migrateAccessors, accessorTable } from "../../accessors.ts";

// 访问器侧表已下沉到 ../../accessors.ts（叶子模块，objects.ts join 共用）

/** 计算键访问器注册（`{ get [expr]() {} }`）：键为 Abs，ToPropertyKey 后注册。
 *  非字面量键无法静态定键——保占位槽（键存在性），不注册派发。 */
export function $objAccessorKey(
  o: Abs,
  key: Abs,
  get: ((t: Abs) => Abs) | null,
  set: ((t: Abs, v: Abs) => Abs) | null,
): Abs {
  const pk = propertyKeyOf(key);
  if (pk === undefined) return o;
  return $objAccessor(o, pk, get, set);
}

// ---------------------------------------------------------------------------
// Bug 124：对象级 Proxy 陷阱（deleteProperty/defineProperty/setPrototypeOf/
// preventExtensions/getPrototypeOf）统一派发面。此前只接线 get/has/set 三个
// 命名属性陷阱，对象级强制陷阱被无视（falsy 陷阱结果不抛、靶被静默改动）。
// ---------------------------------------------------------------------------

/**
 * 布尔陷阱派发（Object.* 抛 / Reflect.* 返布尔两口径共用）。返回：
 * - undefined：无陷阱（absent）或无侧表 → 调用方回退靶语义
 * - "opaque"：handler 形态不可判 → 调用方保守（boolean 域 / 原样返回）
 * - Abs：陷阱已调用，ToBoolean(结果)——boolLit(true)/boolLit(false)；
 *   抽象结果 → boolean 域（Object 口径的调用方不得对非字面量 false 抛）。
 * dead（有槽不可调用，GetMethod 原生定抛）在此硬抛 TypeError。
 */
export function proxyBooleanTrap(
  o: Abs,
  name: "deleteProperty" | "defineProperty" | "setPrototypeOf" | "preventExtensions",
  trapArgs: (target: Abs) => Abs[],
): Abs | "opaque" | undefined {
  if (o.shape.k !== "brand" || o.shape.name !== "Proxy") return undefined;
  const parts = proxyPartsOf(o);
  if (!parts) return undefined;
  const trap = proxyTrapOf(parts.handler, name);
  if (trap.k === "absent") return undefined;
  if (trap.k === "dead") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (trap.k === "opaque") return "opaque";
  const r = $call(trap.fn, trapArgs(parts.target), parts.handler);
  const rv = litValue(r);
  if (rv.ok) return boolLit(Boolean(rv.value));
  return bool();
}

/**
 * getPrototypeOf 陷阱派发。返回口径与 proxyBooleanTrap 同款：
 * undefined（回退 protoOfRecv 靶原型）/ "opaque"（保守 unknown 由调用方落）/
 * Abs（陷阱结果——原生要求 Object 或 null，非对象非 null 字面量在此定抛；
 * 抽象面 may TypeError + unknown）。
 */
export function proxyGetProtoTrap(o: Abs): Abs | "opaque" | undefined {
  if (o.shape.k !== "brand" || o.shape.name !== "Proxy") return undefined;
  const parts = proxyPartsOf(o);
  if (!parts) return undefined;
  const trap = proxyTrapOf(parts.handler, "getPrototypeOf");
  if (trap.k === "absent") return undefined;
  if (trap.k === "dead") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (trap.k === "opaque") return "opaque";
  const r = $call(trap.fn, [parts.target], parts.handler);
  const rv = litValue(r);
  if (rv.ok) {
    if (rv.value === null) return r;
    if (typeof rv.value === "object") return r;
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (
    r.shape.k === "obj" || r.shape.k === "brand" || r.shape.k === "arr" ||
    r.shape.k === "tuple" || r.shape.k === "fn" || r.shape.k === "eff"
  ) {
    return r;
  }
  recordMayThrow({
    kind: "TypeError",
    cause: "Proxy getPrototypeOf trap result must be an object or null",
  });
  return unknown;
}

export type ClassAccessor = { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs };

/** 沿继承链找实例 class get/set 访问器 */
export function findClassAccessor(
  startName: string,
  key: string,
): ClassAccessor | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const acc = getEvalClass(cur)?.accessors?.[key];
    if (acc) return acc;
    cur = getEvalClass(cur)?.superName;
  }
  return undefined;
}

/** 静态访问器（挂在类构造器上；继承链上溯） */
export function findStaticClassAccessor(
  startName: string,
  key: string,
): ClassAccessor | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const acc = getEvalClass(cur)?.staticAccessors?.[key];
    if (acc) return acc;
    cur = getEvalClass(cur)?.superName;
  }
  return undefined;
}

/** JS 访问器派发（$get/$set 共用）：obj 走侧表，brand 走 class 注册表 */
export function findAccessor(
  o: Abs,
  key: string,
): { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs } | undefined {
  if (o.shape.k === "brand") return findClassAccessor(o.shape.name, key);
  return lookupObjAccessor(o, key);
}

// in / instanceof / classExpr / delete
// --- in / instanceof / delete（transpile 运算符路由） ---

/**
 * `key in obj`：闭形状精确判定（含 Object.prototype/Array.prototype 名、
 * 数组下标/length、class 方法/访问器与内建 brand 方法/访问器）；
 * prim/nullish 接收者原生抛 TypeError →
 * unknown；抽象键/开形状 → boolean。
 */
export function $in(key: Abs, o: Abs): Abs {
  if (o.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce。
    // nullish 成员（null|obj 等 union）：整体只 may 抛（守卫分支只读非空侧）
    // → 该成员折 boolean + may-throw，不得 definite 硬抛。
    const parts = o.shape.members.map((m) => {
      if (isNullishLitAbs(m)) {
        recordMayThrow({
          kind: "TypeError",
          cause: "'in' on nullish (union arm): receiver may be a non-object",
        });
        return bool();
      }
      return $in(key, m);
    });
    return parts.length ? parts.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
  // 原生：prim/nullish 接收者抛 TypeError（'a' in 5 → TypeError）。
  // 确定非对象 → hard NudoThrow（tier 1，调用边界收成 throws），
  // 不得折 unknown 假「不抛」。
  if (o.shape.k === "prim" || o.shape.k === "never" || isNullishLitAbs(o)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // any（无约束值）可能是 prim/nullish → may TypeError。接收者效应与键形态
  // 无关（Bug 6：抽象/symbol 键此前在下方键分类早退，漏记本臂）；unknown 是
  // 引擎 fail-closed 令牌（不进 throws 域，与 member-diag 的 unknown-recv
  // 口径一致），静默。
  if (o.shape.k === "any") {
    recordMayThrow({
      kind: "TypeError",
      cause: "'in' on any (unconstrained value): receiver may be a non-object",
    });
    return bool();
  }
  // null/undefined/boolean 键走 ToPropertyKey（"null"/"undefined"/"true"）——
  // 原生 `undefined in o` / `null in o` 不抛，是普通字符串键查询。
  // 仅**右操作数**非对象才 TypeError。非字面量键 → boolean 近似。
  //
  // Bug 149：**符号键**（Symbol.iterator 等）——propertyKeyOf 对 symbol 返
  // undefined，但那不是「键不可判」而是**真 symbol 键**：内部槽键按 "@@X"
  // 投影寻址（与读写面同口径），Proxy has 陷阱收到**真 symbol**（规范
  // PropertyKey：trap 的 key 与读取时的 key 相同）。此前此臂提前
  // return bool() ⇒ has 陷阱**完全不派发**。
  const symSlotKey = isSymbolAbs(key) ? slotKeyOfSymbolAbs(key) : undefined;
  const keyStr = propertyKeyOf(key) ?? symSlotKey;
  if (keyStr === undefined) {
    // 抽象键 / 用户符号（Symbol("x")）——键不可判
    return bool();
  }
  const kv: string | number = keyStr;
  if (o.shape.k === "tuple") {
    if (kv === "length") return boolLit(true);
    const idx = canonicalArrayIndex(kv);
    if (idx !== undefined) {
      if (o.shape.holes?.includes(idx)) return boolLit(false);
      return boolLit(idx < o.shape.elements.length);
    }
    // Bug 15：tuple 原型链 Array.prototype → Object.prototype——非下标键
    // 按两表精确判定（"map"/"toString"/"constructor" in [] 原生 true）；
    // 表外键闭 tuple 精确缺席（"x" in [1] → false）。
    return boolLit(ARRAY_PROTO_METHOD_NAMES.has(keyStr) || OBJECT_PROTO_NAMES.has(keyStr));
  }
  if (o.shape.k === "arr") return bool(); // 抽象数组：索引域未知
  // Bug 71：Proxy——has 陷阱优先（实参 (target, key)、this = handler）；
  // 无陷阱回退靶包含判定（inner 即 target Abs）
  if (o.shape.k === "brand" && o.shape.name === "Proxy") {
    const parts = proxyPartsOf(o);
    if (parts) {
      const trap = proxyTrapOf(parts.handler, "has");
      if (trap.k === "fn") {
        // Bug 149：符号键的陷阱实参是真 symbol（规范 PropertyKey），不是 "@@X" 串
        return $call(trap.fn, [parts.target, symSlotKey !== undefined ? key : strLit(String(kv))], parts.handler);
      }
      if (trap.k === "dead" || trap.k === "opaque") {
        recordMayThrow({ kind: "TypeError", cause: `Proxy has trap for '${keyStr}' not callable / unknown` });
        return bool();
      }
      return $in(key, parts.target);
    }
  }
  // Bug 56：Arguments brand → 靶 tuple 包含判定（下标/length 精确）
  if (o.shape.k === "brand" && o.shape.name === "Arguments") {
    return $in(key, o.shape.shape);
  }
  if (o.shape.k === "obj" || o.shape.k === "brand") {
    const objShape: ObjShape | undefined =
      o.shape.k === "brand"
        ? o.shape.shape.shape.k === "obj"
          ? o.shape.shape.shape
          : undefined
        : o.shape;
    if (!objShape) return bool();
    const slot = getSlot(objShape.slots, keyStr);
    if (slot) {
      if (slot.optional) return bool(); // optional 槽可能缺席
      return boolLit(true);
    }
    // N2：类值接收者——静态面（ctor [[Prototype]] 链）：自有/继承静态方法、
    // 静态访问器、祖先类值槽 + 内建父构造器宿主链。实例方法/访问器不在此
    // 链（挂 X.prototype——`"m" in B` 原生 false），brandHasProtoMember 的
    // 实例面不适用；类值是函数：Function.prototype 名（call/apply/bind…）
    // 原生恒在。链洞（mock/桥接父名）→ 不可判 → boolean。
    if (o.shape.k === "brand" && classNameOfValue(o as object) === o.shape.name) {
      if (classValueHasStatic(o.shape.name, keyStr)) return boolLit(true);
      const sup = builtinSuperCtorOf(o.shape.name);
      if (sup) {
        try {
          if (keyStr in (sup.host as object)) return boolLit(true);
        } catch {
          /* 宿主 in 不可判 → 走下方降级 */
        }
      }
      if (classChainHasHole(o.shape.name)) return bool();
      return boolLit(OBJECT_PROTO_NAMES.has(keyStr) || FUNCTION_PROTO_NAMES.has(keyStr));
    }
    // class 实例：原型链上的方法/访问器/内建 brand 方法
    if (o.shape.k === "brand" && brandHasProtoMember(o.shape.name, keyStr)) {
      return boolLit(true);
    }
    if (objShape.open) return bool();
    // Object.create(null)：无 Object.prototype 可回退，缺自有槽即缺席
    if (o.shape.k === "obj" && isNullProtoObj(o)) return boolLit(false);
    return boolLit(OBJECT_PROTO_NAMES.has(keyStr));
  }
  if (o.shape.k === "fn") {
    if (o.shape.slots && getSlot(o.shape.slots, keyStr) && !o.shape.slots[keyStr]!.optional) {
      return boolLit(true);
    }
    return boolLit(OBJECT_PROTO_NAMES.has(keyStr) || FUNCTION_PROTO_NAMES.has(keyStr));
  }
  // eff：Promise/Generator 原型方法
  if (o.shape.k === "eff") {
    if (o.shape.eff === "promise" && PROMISE_PROTO_NAMES.has(keyStr)) return boolLit(true);
    return boolLit(OBJECT_PROTO_NAMES.has(keyStr));
  }
  // unknown：无信息，不得按 Object.prototype 成员误判（Object.create 未建模时
  // "toString" in o 曾折 true）。fail-closed 令牌不进 throws 域；any 接收者的
  // may-throw 已在函数首按接收者统一记录（Bug 6）。
  if (o.shape.k === "unknown") return bool();
  return boolLit(OBJECT_PROTO_NAMES.has(keyStr));
}

/** Function.prototype / 函数自有面常见名 */
export const FUNCTION_PROTO_NAMES = new Set(["call", "apply", "bind", "length", "name", "prototype"]);
export const PROMISE_PROTO_NAMES = new Set(["then", "catch", "finally"]);

/** 内建 brand 原型方法名（值读 protoMethodValueAbs / $in 精确判定共用；
 *  Bug 40：按宿主原型面补齐——缺席名经闭 obj 槽 miss 折精确 undefined/
 *  false（wrong-exact），表内名折 "function"/true。名录与宿主
 *  Object.getOwnPropertyNames(X.prototype) 对齐（Node 26 实测）。 */
export const BUILTIN_BRAND_METHODS: Record<string, ReadonlySet<string>> = {
  Date: new Set([
    "toString", "toDateString", "toTimeString", "toISOString", "toUTCString", "toGMTString",
    "getDate", "setDate", "getDay", "getFullYear", "setFullYear", "getHours", "setHours",
    "getMilliseconds", "setMilliseconds", "getMinutes", "setMinutes", "getMonth", "setMonth",
    "getSeconds", "setSeconds", "getTime", "setTime", "getTimezoneOffset",
    "getUTCDate", "setUTCDate", "getUTCDay", "getUTCFullYear", "setUTCFullYear",
    "getUTCHours", "setUTCHours", "getUTCMilliseconds", "setUTCMilliseconds",
    "getUTCMinutes", "setUTCMinutes", "getUTCMonth", "setUTCMonth",
    "getUTCSeconds", "setUTCSeconds", "valueOf", "getYear", "setYear",
    "toJSON", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "toTemporalInstant",
  ]),
  RegExp: new Set(["test", "exec", "toString", "compile"]),
  Map: new Set(["get", "set", "has", "delete", "clear", "forEach", "keys", "values", "entries", "getOrInsert", "getOrInsertComputed"]),
  Set: new Set([
    "has", "add", "delete", "clear", "forEach", "keys", "values", "entries",
    "union", "intersection", "difference", "symmetricDifference",
    "isSubsetOf", "isSupersetOf", "isDisjointFrom",
  ]),
  // Bug 56：X.prototype.<method> 值读通道的表源（WeakMap/WeakSet 补齐）
  WeakMap: new Set(["get", "has", "set", "delete", "getOrInsert", "getOrInsertComputed"]),
  WeakSet: new Set(["add", "has", "delete"]),
  Error: new Set(["toString"]),
  // Bug 68：Error 家族七子类原型面与 Error 同款（toString = `${name}: ${message}`；
  // X.prototype.toString 值读/借用调用按接收者 brand 名派发到家族实现）
  TypeError: new Set(["toString"]),
  RangeError: new Set(["toString"]),
  ReferenceError: new Set(["toString"]),
  SyntaxError: new Set(["toString"]),
  URIError: new Set(["toString"]),
  EvalError: new Set(["toString"]),
  AggregateError: new Set(["toString"]),
  Promise: new Set(["then", "catch", "finally"]),
  // Bug 40：二进制缓冲 / 视图 / 弱引用家族原型面（此前全缺 → typeof/in
  // wrong-exact；调用面经 protoMethodValueAbs → $invoke 落既有派发，未建模
  // 方法调用仍诚实 unknown）
  ArrayBuffer: new Set(["slice", "resize", "transfer", "transferToFixedLength"]),
  SharedArrayBuffer: new Set(["slice", "grow"]),
  DataView: new Set([
    "getInt8", "setInt8", "getUint8", "setUint8",
    "getInt16", "setInt16", "getUint16", "setUint16",
    "getInt32", "setInt32", "getUint32", "setUint32",
    "getFloat16", "setFloat16", "getFloat32", "setFloat32",
    "getFloat64", "setFloat64", "getBigInt64", "setBigInt64", "getBigUint64", "setBigUint64",
  ]),
  WeakRef: new Set(["deref"]),
  FinalizationRegistry: new Set(["register", "unregister"]),
  // Bug 40 同口径补齐：新建品牌原型面（此前空 brand 闭 obj
  // 槽 miss → 值读折精确 undefined wrong-exact，`if (usp.get)`
  // / `if (td.decode)` 证伪死分支；调用面仍经既有派发，
  // 未建模方法调用诚实 unknown）
  URLSearchParams: new Set([
    "append", "delete", "entries", "forEach", "get", "getAll",
    "has", "keys", "set", "sort", "toString", "values",
  ]),
  TextDecoder: new Set(["decode"]),
  "Intl.NumberFormat": new Set([
    "format", "formatRange", "formatRangeToParts", "formatToParts", "resolvedOptions",
  ]),
  "Intl.DateTimeFormat": new Set([
    "format", "formatRange", "formatRangeToParts", "formatToParts", "resolvedOptions",
  ]),
};

/** Bug 36：%TypedArray%.prototype 回调族（HOF + find 系 + reduce 系；
 *  flatMap 原生不在 TA 原型上，不得混入）。$invokeInner 回调派发专用
 *  （exec/class.ts 按 TYPED_ARRAY_ELEMENT 家族路由 invokeArrMethod）；
 *  家族键 = builtins/shared.ts 的 TYPED_ARRAY_ELEMENT 单一事实源（12 家族）。 */
export const TYPED_ARRAY_CALLBACK_METHODS: ReadonlySet<string> = new Set([
  "forEach", "map", "filter", "reduce", "reduceRight",
  "every", "some", "find", "findIndex", "findLast", "findLastIndex",
]);

/** Bug 40：%TypedArray%.prototype 全量字符串键方法面（值读/$in 用）——
 *  回调族之外还有 set/subarray/at/join/sort 等非回调方法，此前缺席令
 *  `typeof ta.set` 折精确 "undefined"（wrong-exact）。回调调用派发仍只认
 *  TYPED_ARRAY_CALLBACK_METHODS（exec/class.ts），两表分工不同不得合并。 */
export const TYPED_ARRAY_PROTO_METHOD_NAMES: ReadonlySet<string> = new Set([
  "entries", "keys", "values", "at", "copyWithin", "every", "fill", "filter",
  "find", "findIndex", "findLast", "findLastIndex", "forEach", "includes",
  "indexOf", "join", "lastIndexOf", "map", "reverse", "reduce", "reduceRight",
  "set", "slice", "some", "sort", "subarray", "toReversed", "toSorted", "with",
  "toLocaleString", "toString",
]);
for (const fam of Object.keys(TYPED_ARRAY_ELEMENT)) {
  BUILTIN_BRAND_METHODS[fam] = TYPED_ARRAY_PROTO_METHOD_NAMES;
}
// base64/hex 提案面仅 Uint8Array 原生自有（Float64Array 等无——混入共享表
// 会反向 wrong-exact）
BUILTIN_BRAND_METHODS.Uint8Array = new Set([
  ...TYPED_ARRAY_PROTO_METHOD_NAMES,
  "toBase64", "setFromBase64", "toHex", "setFromHex",
]);

/** @@iterator 值读（typeof x[Symbol.iterator]）只对原生可迭代 brand 折
 *  "function"（Map/Set/TA 家族）；Date/RegExp/Error/WeakMap/AB/DV 等非可
 *  迭代 brand 原生 undefined——Bug 40 前臂上 `key === "@@iterator"` 对
 *  任意有表 brand 折函数（wrong-exact）。迭代协议派发不走该值读臂。 */
export const ITERABLE_BRANDS: ReadonlySet<string> = new Set([
  "Map", "Set",
  // URLSearchParams 原生可迭代（@@iterator === entries）
  "URLSearchParams",
  ...Object.keys(TYPED_ARRAY_ELEMENT),
]);

export function brandHasProtoMember(brandName: string, key: string): boolean {
  for (const name of evalClassChain(brandName)) {
    const spec = getEvalClass(name);
    if (spec?.methods?.[key]) return true;
    if (spec?.accessors?.[key]) return true;
    const builtin = BUILTIN_BRAND_METHODS[name];
    if (builtin?.has(key)) return true;
    const builtinAcc = BUILTIN_BRAND_ACCESSORS[name];
    if (builtinAcc?.has(key)) return true;
  }
  // Bug 113：原型链数据槽 presence（`A.prototype.x = 1` 落 protoBrandAbs
  // memo 槽 / fn 伪父 fnProtoOf 槽 / 函数声明链 protoBrandAbs(n) 槽）——
  // 值读（chainProtoSlotOf）已见而 in 判定此前忽略（`"zz" in new f()` 与
  // class 实例 `C.prototype.zz = 5; "zz" in new C()` 同折假精确 false）。
  // constructor/__proto__ 由此处恒 miss（chainProtoSlotOf 专用分支排除）。
  if (chainProtoSlotOf(brandName, key, 0) !== undefined) return true;
  return false;
}

/** 内建 brand 原型访问器（非方法成员；$in 精确判定用——值读不走方法表：
 *  Map/Set 的 size 在 $get 单独委托 mapSizeAbs/setSizeAbs，混入
 *  BUILTIN_BRAND_METHODS 会把 m.size 折成函数形状）。Bug 15。
 *  Bug 40 补：二进制/TA/RegExp 访问器名（byteLength 等值读多由构造器
 *  槽面建模，此处补 $in presence——`"buffer" in dv` / `"length" in ta`
 *  此前折精确 false）。 */
export const BUILTIN_BRAND_ACCESSORS: Record<string, ReadonlySet<string>> = {
  Map: new Set(["size"]),
  Set: new Set(["size"]),
  ArrayBuffer: new Set(["byteLength", "maxByteLength", "resizable", "detached"]),
  SharedArrayBuffer: new Set(["byteLength", "maxByteLength", "growable"]),
  DataView: new Set(["buffer", "byteLength", "byteOffset"]),
  RegExp: new Set([
    "source", "flags", "global", "ignoreCase", "multiline",
    "dotAll", "sticky", "unicode", "unicodeSets", "hasIndices",
  ]),
  URLSearchParams: new Set(["size"]),
  TextDecoder: new Set(["encoding", "fatal", "ignoreBOM"]),
  ...Object.fromEntries(
    Object.keys(TYPED_ARRAY_ELEMENT).map((fam) => [
      fam,
      new Set(["buffer", "byteLength", "byteOffset", "length", "BYTES_PER_ELEMENT"]),
    ]),
  ),
};

/** evaluator 品牌链：registry extends 优先，内建错误层级回退（限深防环）。
 *  Bug 64：".prototype" 后缀名（protoBrandAbs 品牌）从 owner 类起走链且
 *  首项保留品牌名自身不含 owner——OrdinaryHasInstance 从 O.[[Prototype]]
 *  起步：`X.prototype instanceof X` 原生 false（owner 不在自己的链上），
 *  `X.prototype instanceof Super` 命中 owner 的 super 链。 */
export function evalClassChain(name: string): string[] {
  const ownerOf = name.endsWith(".prototype") ? name.slice(0, -".prototype".length) : name;
  const out = [name];
  let cur: string | undefined = ownerOf;
  let depth = 0;
  while (cur && depth++ < 32) {
    const spec = getEvalClass(cur);
    const parent: string | undefined = spec?.superName ?? BUILTIN_ERROR_SUPER[cur];
    if (!parent || out.includes(parent)) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

/** P3a：NAMESPACE_GLOBALS 路由表内、hostBuiltinCtorName 名单外的可扩展
 *  宿主类（Bug 24/40/56 入表但 N2 名单未跟进）：URL / ArrayBuffer /
 *  SharedArrayBuffer / DataView / WeakRef / FinalizationRegistry。
 *  extends 这些父类时 superBuiltinHost 同样放行——静态读（typeof
 *  AB.isView → "function" / 缺席键折 undefined）与白名单调用走宿主
 *  通道；构造面（new AB(8)）经 constructClass 的 evalBuiltinNew 路由。
 *  Set 成员按值恒等 + 名字配对（与 TYPED_ARRAY_ELEMENT 家族同校验）。 */
const NAMESPACE_ONLY_HOST_CTORS = new Set<unknown>([
  URL,
  ArrayBuffer,
  SharedArrayBuffer,
  DataView,
  WeakRef,
  FinalizationRegistry,
]);

/** N2：名 → 宿主内建构造器（globalThis 面 + 身份校验；hostBuiltinCtorName
 *  名单 + TYPED_ARRAY_ELEMENT 家族 + P3a 表内可扩展类）。$class 的
 *  superBuiltinHost 标记用「名 → 宿主值恒等」校验 extends 目标
 *  是真实内建（mock 同名 fn 不匹配）。 */
export function hostBuiltinCtorOf(name: string): unknown {
  const v = (globalThis as Record<string, unknown>)[name];
  if (typeof v !== "function") return undefined;
  if (hostBuiltinCtorName(v) === name) return v;
  if (name in TYPED_ARRAY_ELEMENT && (v as { name?: unknown }).name === name) return v;
  if (NAMESPACE_ONLY_HOST_CTORS.has(v) && (v as { name?: unknown }).name === name) return v;
  return undefined;
}

/**
 * N2：类值继承链上的**内建父构造器**：链上首个未注册名，且其直接子类带
 * superBuiltinHost 标记（extends 目标是真实宿主内建构造器，非 mock 同名
 * fn）。返回宿主值供 $get / $call 走既有宿主静态通道（namespace 投影 /
 * 宿主真值）。无通道（mock/桥接父类 / 非名单内建）→ undefined。
 * 原生：类值的 [[Prototype]] 链通到内建构造器，其静态成员
 * （Object.keys / Error.captureStackTrace / Promise.all / TA.from …）
 * 经链被派生类继承。
 */
export function builtinSuperCtorOf(startName: string): { host: unknown; ns: string } | undefined {
  const chain = evalClassChain(startName);
  for (let i = 1; i < chain.length; i++) {
    const n = chain[i]!;
    if (getEvalClass(n)) continue; // 用户注册面优先（同名用户类遮蔽内建）
    const child = getEvalClass(chain[i - 1]!);
    if (!child?.superBuiltinHost || child.superName !== n) continue;
    const host = hostBuiltinCtorOf(n);
    if (host !== undefined) return { host, ns: n };
    return undefined;
  }
  return undefined;
}

/**
 * P3b：原型链数据槽读（`X.prototype.k` / 实例 `.k` 经 extends 链）——原生
 * 派生类原型 [[Prototype]] 通父原型，数据属性沿链可见。逐级取链名原型：
 * 注册类 → protoBrandAbs(n) 内层槽（原地可变——`A.prototype.x = 1` 落
 * memo 对象）；fn 伪父 → fnProtoOf(类值) 槽。constructor / __proto__ 不
 * 在此列（专用分支）。未注册链名（洞）跳过——缺席折叠由调用方按
 * classChainHasHole 决定（洞 → 不可折缺席）。
 */
export function chainProtoSlotOf(startName: string, key: string, fromLevel: number): Abs | undefined {
  if (key === "constructor" || key === "__proto__") return undefined;
  const chain = evalClassChain(startName);
  for (let i = fromLevel; i < chain.length; i++) {
    const n = chain[i]!;
    const cv = lookupClassValue(n);
    let protoInner: Abs | undefined;
    if (cv && cv.shape.k === "fn") {
      protoInner = fnProtoOf(cv); // fn 伪父：memo prototype 本体（闭 obj）
    } else if (getEvalClass(n)) {
      const pb = protoBrandAbs(n).shape;
      protoInner = pb.k === "brand" ? pb.shape : undefined;
    } else {
      continue; // 链洞 / 内建未注册名：调用方按 hole 语义处理
    }
    if (protoInner && protoInner.shape.k === "obj") {
      const slot = getSlot(protoInner.shape.slots, key);
      if (slot && !slot.optional) return slot.value;
    }
  }
  return undefined;
}

/**
 * P3b：链上是否有 fn 伪父（构造器体不透明——super() 不执行 fn 体，
 * 实例自有面不可判）→ 实例缺槽不可折 undefined（sound unknown）。
 */
export function chainHasOpaqueFnParent(startName: string): boolean {
  for (const n of evalClassChain(startName)) {
    const cv = lookupClassValue(n);
    if (cv && cv.shape.k === "fn") return true;
  }
  return false;
}

/**
 * N2：类值静态成员 presence（`"m2" in A` / `"x" in B`）：自有静态方法/
 * 静态访问器（spec 表——静态方法不落槽）+ 沿链祖先类值自有槽（声明静态
 * 字段 + 动态写 A.y=…）。实例方法/访问器不在类值链上（挂 X.prototype，
 * `"m" in B` 原生 false）——与 brandHasProtoMember 的实例面互补。
 */
export function classValueHasStatic(startName: string, key: string): boolean {
  let level = 0;
  for (const n of evalClassChain(startName)) {
    const spec = getEvalClass(n);
    if (spec?.staticMethods?.[key] || spec?.staticAccessors?.[key]) return true;
    if (level++ > 0) {
      const anc = lookupClassValue(n);
      const inner = anc && anc.shape.k === "brand" ? anc.shape.shape : undefined;
      if (inner?.shape.k === "obj" && getSlot(inner.shape.slots, key)) return true;
      if (!spec) break; // 链洞：槽面止步（宿主通道由调用方处理）
    }
  }
  return false;
}

/**
 * N2：类值继承链是否有洞——任一未注册父名（且非 superBuiltinHost 放行的
 * 宿主内建父）→ 链不可判定，presence/缺席不可折精确（调用方降级
 * boolean）。全链已注册（末名无 super → 隐式 Function.prototype 尾）或
 * 经宿主内建父闭合 → 链完整。
 */
export function classChainHasHole(startName: string): boolean {
  const chain = evalClassChain(startName);
  for (let i = 1; i < chain.length; i++) {
    const n = chain[i]!;
    if (getEvalClass(n)) continue;
    const child = getEvalClass(chain[i - 1]!);
    if (child?.superBuiltinHost && child.superName === n && hostBuiltinCtorOf(n) !== undefined) {
      continue; // 宿主内建父：链经宿主原生 [[Prototype]] 链闭合
    }
    return true;
  }
  return false;
}

/** 内建构造器名：对其 exact false / true 可判定；未知用户构造器名 → boolean */
export const BUILTIN_CTOR_NAMES = new Set([
  "Array", "Object", "Function", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "String", "Number", "Boolean",
  "Symbol", "ArrayBuffer", "DataView",
]);

/**
 * instanceof 右操作数校验（原生 InstanceofOperator 的 (1)/(2)/(4) 步）：
 * (1) 非对象 RHS（null/undefined/prim 字面量或 prim 形状）→ definite
 *     TypeError（"Right-hand side of 'instanceof' is not an object"）；
 * (4) 无 callable @@hasInstance 处理器且非 callable → definite TypeError
 *     （"Right-hand side of 'instanceof' is not callable"，Bug 33）：
 *     arr/tuple 继承面（Array/Object.prototype）无 @@hasInstance、引擎内
 *     也从不携带 call impl → 定抛；闭 obj 自有槽集完整，无 callable
 *     @@hasInstance 槽即确定 non-callable（Object.create(null) 的闭
 *     null-proto 同理），open obj（动态继承不建模）保守不抛；brand 实例
 *     （Map/Date/… 值）原生 non-callable 定抛，但 Proxy（apply trap）可
 *     callable，引擎不可区分 → may TypeError，类值（classNameOfValue 已
 *     标，含内建构造器）是 constructor 函数 → 合法不记。
 * fn 形状 RHS 不校验（箭头/async 原生因无 .prototype 定抛，generator fn
 * 有 .prototype 合法——ctor facet 三者混同，definite/may 均会误伤
 * generator，见 eval-instanceof-rhs.test.ts documented 债）；any RHS 可能
 * 是非对象/非 callable → may TypeError；unknown 是引擎 fail-closed 令牌
 * （桥接/契约包裹后的内部值），不进 throws 域。
 */
function validateInstanceofRhs(rightVal: Abs): void {
  const k = rightVal.shape?.k;
  if (k === "prim" || k === "never" || isNullishLitAbs(rightVal)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // any（无约束值）可能是非对象 → may TypeError；unknown 是引擎 fail-closed
  // 令牌（桥接/契约包裹后的内部值），不进 throws 域
  if (k === "any") {
    recordMayThrow({
      kind: "TypeError",
      cause: "instanceof RHS may be a non-object (null/undefined/prim)",
    });
  }
  // Bug 33：原生第 (4) 步——数组继承面（Array.prototype → Object.prototype）
  // 链上无 @@hasInstance，且 arr/tuple Abs 从不携带 call impl（attachFnImpl
  // 只产 fn 形状）→ 确定 non-callable → 定抛
  if (k === "arr" || k === "tuple") {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (k === "obj" && !(rightVal.shape as ObjShape).open) {
    // 闭 shape（字面量 / Object.create(null) 的闭 null-proto）自有槽集完整：
    // 无 callable @@hasInstance 槽即确定 non-callable；槽值不可调用时原生
    // GetMethod 也直接定抛（"x is not a function"），与缺槽同折。open obj
    //（Object.create(proto)/setPrototypeOf 产物，动态继承不建模）保守不抛，
    // $instanceof 左值分派折抽象 boolean（imprecision 优于 wrong-exact）。
    const slot = (rightVal.shape as ObjShape).slots["@@hasInstance"];
    const callable =
      slot !== undefined &&
      (slot.value.shape.k === "fn" || getFnImpl(slot.value) !== undefined);
    if (!callable) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // callable 槽可能缺位（optional）：缺位路径无处理器 → 原生定抛 → may
    if (slot.optional) {
      recordMayThrow({
        kind: "TypeError",
        cause: "instanceof RHS @@hasInstance slot may be absent",
      });
    }
  }
  if (k === "brand" && classNameOfValue(rightVal as object) !== undefined) {
    // Bug 50：类值带自有 @@hasInstance 槽但不可调用 → 原生 GetMethod 定抛
    //（"x is not a function"，与闭 obj 臂同口径；继承槽只折抽象 boolean）
    const inner = (rightVal.shape as { shape?: Abs }).shape;
    const slot =
      inner && inner.shape.k === "obj"
        ? getSlot((inner.shape as ObjShape).slots, "@@hasInstance")
        : undefined;
    if (
      slot &&
      !slot.optional &&
      slot.value.shape.k !== "fn" &&
      getFnImpl(slot.value) === undefined
    ) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  if (k === "brand" && classNameOfValue(rightVal as object) === undefined) {
    // brand 实例（new Map() 等值）non-callable → 原生 TypeError；Proxy
    //（apply trap）可 callable → 原生不抛，引擎不可区分 → may
    recordMayThrow({
      kind: "TypeError",
      cause: "instanceof RHS brand may be a non-callable instance",
    });
  }
}

/**
 * Bug 50：类值 brand 的 @@hasInstance 槽查找——自有内层槽优先；未命中沿
 * registry 继承链回取注册类值的槽（原生 @@hasInstance 是 inherited 属性：
 * `class D extends C {}` 的 D.[[Proto]] = C，继承 C 的处理器）。
 */
function brandHasInstanceSlot(rv: Abs): Slot | undefined {
  if (rv.shape.k !== "brand") return undefined;
  const inner = rv.shape.shape;
  const own =
    inner && inner.shape.k === "obj"
      ? getSlot((inner.shape as ObjShape).slots, "@@hasInstance")
      : undefined;
  if (own) return own;
  for (const n of evalClassChain(rv.shape.name)) {
    if (n === rv.shape.name) continue;
    const cv = lookupClassValue(n);
    const ci = cv && cv.shape.k === "brand" ? (cv.shape as { shape?: Abs }).shape : undefined;
    const s2 =
      ci && ci.shape.k === "obj"
        ? getSlot((ci.shape as ObjShape).slots, "@@hasInstance")
        : undefined;
    if (s2) return s2;
  }
  return undefined;
}

/**
 * `x instanceof Right`（Right 为标识符名）：按左值形状精确判定。
 * RHS 非对象 → 原生 definite TypeError；nullish 左侧原生**不抛**（无装箱、
 * OrdinaryHasInstance 恒 false）→ 精确 boolLit(false)；未知用户构造器名 →
 * boolean（不得 exact false）。
 */
export function $instanceof(left: Abs, rightName: string, rightVal?: Abs): Abs {
  // 原生先校验 RHS（@@hasInstance 的 ToObject）：非对象 definite / 抽象 may
  if (rightVal !== undefined) validateInstanceofRhs(asAbsVal(rightVal));
  // null/undefined instanceof X：原生不抛，恒 false（精确）
  if (isNullishLitAbs(left)) return boolLit(false);
  // 自定义 @@hasInstance：RHS 值带可调用槽则调用并布尔化结果
  // （v instanceof o ≡ o[Symbol.hasInstance](v)）；槽在但不可调用 → 抽象
  if (rightVal) {
    const rv = asAbsVal(rightVal);
    let slot: Slot | undefined;
    if (rv.shape.k === "obj") {
      slot = rv.shape.slots["@@hasInstance"];
    } else if (rv.shape.k === "brand" && classNameOfValue(rv as object) !== undefined) {
      // Bug 50：类值的 static [Symbol.hasInstance]（含继承——D extends C）
      slot = brandHasInstanceSlot(rv);
    }
    if (slot && !slot.optional) {
      // 槽在但不可调用 → 原生 TypeError；保守折抽象 boolean
      if (slot.value.shape.k !== "fn" && getFnImpl(slot.value) === undefined) {
        return bool();
      }
      // 与 $invoke 同口径：receiver 经 $call 第三参传递——bindThis impl
      //（含 $class 注册的类值 @@hasInstance 适配器，Bug 50）由派发注入
      // 首参后自行剥掉；非 bindThis impl 经 apply 钩子进宿主 this
      const r = $call(slot.value, [left], rv);
      const bvR = litValue(r);
      // 原生把返回值 ToBoolean（return 0 → false、'yes' → true、undefined → false）。
      // 「是否字面量」看 ok：lit(undefined) 的 ToBoolean 是 false，不是「无字面量」。
      if (bvR.ok) return boolLit(Boolean(bvR.value));
      return bool();
    }
  }
  switch (left.shape.k) {
    case "brand":
      // 类值本身是 constructor 函数：instanceof Function/Object 恒 true
      if (classNameOfValue(left as object) !== undefined) {
        return boolLit(rightName === "Function" || rightName === "Object");
      }
      // Bug 123：Proxy 的 [[GetPrototypeOf]] 透传靶原型链（getPrototypeOf
      // 陷阱可改写，但靶形态是既有保守面）——instanceof 沿靶判定，不得
      // 折 exact false（proxy(fn) instanceof Function 原生 true）。
      // brand 内层承载是 Abs（makeProxyAbs shape: target）。
      if (left.shape.name === "Proxy") {
        const target = (left.shape as { shape?: Abs }).shape;
        if (target) return $instanceof(target, rightName, rightVal);
        return bool();
      }
      // Bug 65：Object.prototype 的 [[Prototype]] 是 null（链终结符）——
      // OrdinaryHasInstance 从 O.[[Prototype]] 起步比较，永不含自身 →
      // instanceof 任何构造器（含 Object）恒 false
      if (left.shape.name === "Object.prototype") return boolLit(false);
      // Bug 67 联动：extends null 类的原型同为 null 链终结符——其
      // instanceof Object 也不得折 true
      if (left.shape.name.endsWith(".prototype")) {
        const owner = left.shape.name.slice(0, -".prototype".length);
        if (getEvalClass(owner)?.superNull) return boolLit(false);
      }
      // P3b：fn 值父类（函数表达式 extends）——链名是伪名（__nudoFnParentN），
      // rightName 不命中；按注册类值**身份**匹配（lookupClassValue(链名) ===
      // rightVal → 同一父构造器值）折 true（与名匹配同一名键假设，last-wins
      // 语义一致）。身份不匹配不折（落 boolean）。
      if (rightVal !== undefined) {
        const rv = asAbsVal(rightVal);
        for (const n of evalClassChain(left.shape.name)) {
          if (lookupClassValue(n) === rv) return boolLit(true);
        }
      }
      return boolLit(
        rightName === "Object" || evalClassChain(left.shape.name).includes(rightName),
      );
    case "arr":
    case "tuple":
      if (rightName === "Array" || rightName === "Object") return boolLit(true);
      if (BUILTIN_CTOR_NAMES.has(rightName)) return boolLit(false);
      return bool(); // 可能是 Array 子类
    case "obj":
      // Object.create(null)：原型链 null 终止——任何构造器的 instanceof 恒 false
      //（含 Object 与内建/自定义构造器）。标记随 $set/$del 迁移（objects.ts 侧表）。
      if (isNullProtoObj(left)) return boolLit(false);
      if (rightName === "Object") {
        // Bug 67 联动：open obj 的已记录原型链可能 null 终止
        // （Object.create(<extends-null 类原型>) / Object.create(
        // Object.create(null))）——链上无 Object.prototype 则原生 false，
        // 不得折 true；链不可判 → 保守 boolean（闭字面量原型恰为
        // Object.prototype，保持精确 true）。
        if ((left.shape as ObjShape).open) {
          let cur: Abs | undefined = getProtoAbs(left);
          let depth = 0;
          while (cur !== undefined && depth++ < 8) {
            if (isObjectProtoBrand(cur)) return boolLit(true);
            const next = protoOfRecv(cur);
            const nvR = litValue(next);
            if (nvR.ok && nvR.value === null) return boolLit(false);
            if (next === cur || next === unknown) break;
            cur = next;
          }
          return bool();
        }
        return boolLit(true);
      }
      // Bug 16：open obj（Object.create(proto) / setPrototypeOf 产物）原型链
      // 未知——可含任意内建原型（Object.create([]) instanceof Array 原生
      // true），不得断言精确 false，降 boolean；闭字面量原型恰为
      // Object.prototype，内建构造器（除 Object）恒 false 保持精确。
      if (!left.shape.open && BUILTIN_CTOR_NAMES.has(rightName)) return boolLit(false);
      return bool(); // Object.create(C.prototype) / open obj
    case "fn":
      if (rightName === "Function" || rightName === "Object") return boolLit(true);
      if (BUILTIN_CTOR_NAMES.has(rightName)) return boolLit(false);
      return bool();
    case "eff":
      if (left.shape.eff === "promise") {
        if (rightName === "Promise" || rightName === "Object") return boolLit(true);
        if (BUILTIN_CTOR_NAMES.has(rightName)) return boolLit(false);
        return bool();
      }
      if (left.shape.eff === "generator") {
        if (rightName === "Generator" || rightName === "Object") return boolLit(true);
        if (BUILTIN_CTOR_NAMES.has(rightName)) return boolLit(false);
        return bool();
      }
      return bool();
    case "prim":
      return boolLit(false); // 原始值无装箱
    case "sum": {
      // 成员分发须带上 RHS 值：@@hasInstance 对 sum 成员同样适用
      const parts = left.shape.members.map((m) => $instanceof(m, rightName, rightVal));
      let decided: boolean | undefined;
      let undecided = false;
      for (const p of parts) {
        const pvR = litValue(p);
        const pv = pvR.ok ? pvR.value : undefined;
        if (typeof pv !== "boolean") {
          undecided = true;
          continue;
        }
        if (decided === undefined) decided = pv;
        else if (decided !== pv) return bool();
      }
      if (decided === undefined) return bool();
      return undecided
        ? abs(bool().shape, lit(decided), pTrue, "path")
        : boolLit(decided);
    }
    default:
      return bool();
  }
}

/** instanceof 右操作数非标识符（表达式/成员路径）：RHS 值传入时先做原生
 *  非对象校验（definite / may TypeError）；构造器值未知 → 抽象 boolean */
export function $instanceofNonIdent(left: Abs, right?: Abs): Abs {
  if (right !== undefined) validateInstanceofRhs(asAbsVal(right));
  return bool();
}

/** ClassExpression 值：构造器函数形状，不得折成精确 undefined */
export function $classExpr(): Abs {
  return absFunction(
    ["_rest"],
    {
      body: noBody,
      apply: () => unknown,
    },
    // Bug 9：类表达式值是构造器，可 new
    { ctor: true },
  );
}

/**
 * `delete obj[key]` 的结果判定（只读，不写回）。
 * frozen/sealed 或 configurable:false 键 → false；preventExtensions 可删；
 * closed 目标恒 true（其余 non-configurable 形态不建模）；
 * nullish 接收者原生 definite TypeError（ToObject(null) 抛）→ hard NudoThrow；
 * 非 nullish prim 接收者原生不抛（装箱临时对象上 delete 恒 true，strict 亦然）
 * → 保持 unknown 折叠；any/unknown 接收者可能 nullish → may TypeError。
 */
export function $delRes(o: Abs, _key: Abs): Abs {
  if (isNullishLitAbs(o) || o.shape.k === "never") {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (o.shape.k === "prim") {
    return unknown;
  }
  if (o.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce。
    // nullish 成员（null|obj union）：整体只 may 抛 → boolean + may-throw。
    const parts = o.shape.members.map((m) => {
      if (isNullishLitAbs(m)) {
        recordMayThrow({
          kind: "TypeError",
          cause: "delete on nullish (union arm): receiver may be nullish",
        });
        return bool();
      }
      return $delRes(m, _key);
    });
    return parts.length ? parts.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
  const st = extStateOf(o);
  const kvR = litValue(_key);
  const kv = kvR.ok ? kvR.value : undefined;
  const flags =
    kv !== undefined ? getPropFlags(o)?.get(String(kv)) : undefined;
  // Bug 124：deleteProperty 陷阱优先于靶语义——falsy 字面量结果 strict 定抛
  // TypeError（原生无条件），truthy → 表达式值恒 true（删除责任在陷阱，
  // 靶不动）；opaque → boolean 域；absent → 回退下方靶判定
  {
    const trapR = proxyBooleanTrap(o, "deleteProperty", (t) => [t, _key]);
    if (trapR === "opaque") return bool();
    if (trapR !== undefined) {
      if (trapR.term?.op === "lit" && trapR.term.value === false) throwStrictWrite();
      return trapR;
    }
  }
  // strict：frozen/sealed/non-configurable 删除 TypeError（表达式与语句同口径）
  if (st === "frozen" || st === "sealed") throwStrictWrite();
  if (flags?.configurable === false) throwStrictWrite();
  if (st === "nonext") return boolLit(true); // 属性仍可删（仅不可加）
  if (o.shape.k === "obj" || o.shape.k === "brand") {
    const objShape: ObjShape | undefined =
      o.shape.k === "brand"
        ? o.shape.shape.shape.k === "obj"
          ? o.shape.shape.shape
          : undefined
        : o.shape;
    if (objShape?.open) return bool();
    return boolLit(true);
  }
  // tuple/arr/fn/eff：delete 任意键恒 true（数组洞为 undefined 槽，不影响结果）
  if (
    o.shape.k === "tuple" ||
    o.shape.k === "arr" ||
    o.shape.k === "fn" ||
    o.shape.k === "eff"
  ) {
    return boolLit(true);
  }
  // any（无约束值）：接收者可能 nullish → may TypeError（值保持 boolean）；
  // unknown 是引擎 fail-closed 令牌，不进 throws 域
  if (o.shape.k === "any") {
    recordMayThrow({
      kind: "TypeError",
      cause: "delete on any (unconstrained value): receiver may be nullish",
    });
  }
  return bool();
}

/**
 * `delete obj[key]` 的写入（不可变更新）：返回删键后的新容器。
 * 闭对象删自有槽；tuple 规范下标置 undefined（对齐原生空洞读值）；
 * 抽象 arr 元素并入 undefined；无法表达的形态原样返回。
 */
export function $del(o: Abs, key: Abs): Abs {
  // ToPropertyKey：null/undefined/boolean → "null"/"undefined"/"true"
  const keyStr = propertyKeyOf(key);
  if (o.shape.k === "sum") {
    return abs(
      { k: "sum", members: o.shape.members.map((m) => $del(m, key)) },
      undefined,
      undefined,
      "partial",
    );
  }
  // Bug 124：deleteProperty 陷阱优先于一切靶判定——陷阱在场时删除责任
  // 在陷阱（引擎不动靶）；falsy 字面量结果 strict 定抛（与 $delRes 同口径）；
  // absent → 靶语义（下方 brand 递归删靶槽）
  // Bug 172：陷阱的**派发**唯一发生在 $delRes（delete 表达式值通道）。本函数
  // 是语句位写回通道（`o = $del(o, k)`）——若在此再派发一次，Proxy 的
  // deleteProperty 陷阱会被调用两次（原生恰好一次），陷阱副作用翻倍。故
  // 此处只**探测陷阱在场**（不调用），在场 → 靶不动、原样返回。
  if (o.shape.k === "brand" && o.shape.name === "Proxy") {
    const parts = proxyPartsOf(o);
    const trap = parts ? proxyTrapOf(parts.handler, "deleteProperty") : undefined;
    // opaque（形态不可判）→ 与 $delRes 同口径：靶不动；fn/dead（陷阱在场）
    // → 删除责任在陷阱：靶不动。absent → 无陷阱，落靶语义。
    if (parts && trap && trap.k !== "absent") return o;
  }
  const st = extStateOf(o);
  // frozen/sealed：删除 TypeError（strict 硬抛；表达式 delete 走 $delRes 返回 false）
  if (st === "frozen" || st === "sealed") throwStrictWrite();
  if (o.shape.k === "brand") {
    // Bug 116：strict 毒丸——delete arguments.callee 定抛（与 $get/$set 的
    // brand 臂同口径；复用 throwStrictWrite 的 strict TypeError 通道）
    if (o.shape.name === "Arguments" && keyStr === "callee") throwStrictWrite();
    const inner = $del(o.shape.shape, key);
    if (inner === o.shape.shape) return o;
    const next = abs({ k: "brand", name: o.shape.name, shape: inner }, undefined, undefined, o.conf);
    const clsName = classNameOfValue(o as object);
    if (clsName) markClassValue(next as object, clsName);
    return next;
  }
  if (o.shape.k === "obj" && keyStr !== undefined) {
    if (getPropFlags(o)?.get(keyStr)?.configurable === false) throwStrictWrite();
    if (o.shape.open) return o;
    if (!getSlot(o.shape.slots, keyStr) && !lookupObjAccessor(o, keyStr)) return o; // 无此槽且无访问器：no-op
    // 就地删槽（引用语义：别名同步）；identity 不变故侧表免迁移，
    // 对象字面量自有访问器随键删除（原生 own accessor 是自有属性）
    delete o.shape.slots[keyStr];
    const am = accessorTable.get(o);
    if (am) {
      am.delete(keyStr);
      if (am.size === 0) accessorTable.delete(o);
    }
    clearStaleTermPred(o);
    return o;
  }
  if (o.shape.k === "tuple") {
    const idx = canonicalArrayIndex(keyStr);
    if (idx === undefined || idx >= o.shape.elements.length) return o; // 越界 delete 不影响数组
    o.shape.elements[idx] = $lit(undefined);
    if (!o.shape.holes) o.shape.holes = [];
    if (!o.shape.holes.includes(idx)) o.shape.holes.push(idx);
    clearStaleTermPred(o);
    return o;
  }
  if (o.shape.k === "arr") {
    o.shape = {
      k: "arr",
      element: joinAbs(o.shape.element, $lit(undefined)),
    };
    o.conf = "partial";
    clearStaleTermPred(o);
    return o;
  }
  return o;
}
