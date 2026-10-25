/**
 * 访问器（get/set）侧表、in / instanceof / delete 路由。
 *
 * Bug 149：符号键（Symbol.iterator 等）按**宿主身份**反查 "@@X" 内部槽键
 * 寻址（与读写面同口径），Proxy has 陷阱收到**真 symbol**（规范
 * PropertyKey）——不再在「键不可判」处提前 return（陷阱此前完全不派发）。
 * Bug 230：delete 运算符路径（$delRes）的 Proxy [[Delete]] 规范不变量——
 * deleteProperty 陷阱返 true 时，若靶上该键是不可配置自有属性 ⇒ 原生定抛
 * TypeError（此前直接返 true，假绿；Reflect 臂已由 S9 接线）。
 * Bug 194：`delete X.prototype.m` —— 类方法在方法注册表（spec.methods）里，
 * 原型对象上无该方法的槽 ⇒ 只删槽不留痕（读/调用/in 三面继续命中）。
 * $del 在 `.prototype` brand 臂按 owner 名通知注册表侧移除（S8 的
 * deleteProtoMethod 钩子）；delete 返回值恒 true（原生同）。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, strLit, unknown, type Confidence } from "../../abs.ts";
import { lit } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import { absFunction, getFnImpl } from "../../abs-fn.ts";
import { joinAbs, isObj, type ObjShape, type Slot, isNullProtoObj, getSlot, canonicalArrayIndex, propertyKeyOf, getProtoAbs, getInstanceProto } from "../../objects.ts";
import { isNullishLitAbs } from "../../surface.ts";
import { isMapAbs, isSetAbs, mapSizeAbs, setSizeAbs } from "../../collections.ts";
import {
  evalNamespaceCall, extStateOf, getPropFlags, migrateInvariants,
  isObjectProtoBrand, OBJECT_PROTO_METHOD_NAMES,
  symbolDescriptionAbs, objectProtoBrand, builtinCtorAbs, ctorNameOfRecv,
  protoOfRecv, hostBuiltinCtorName, protoBrandAbs,
} from "../../builtins.ts";
import { errorTypeAbs, recordMayThrow, type MayThrowEffect } from "../may-throw.ts";
import { TYPED_ARRAY_ELEMENT } from "../../builtins/shared.ts";
import { OBJECT_PROTO_NAMES, ARRAY_PROTO_METHOD_NAMES } from "../member-diag.ts";
import { $call } from "../call.ts";
import { proxyPartsOf, proxyTrapOf } from "../match-iter.ts";
// 族 57 · 第 6 条 ②：符号键的**槽寻址键**（well-known → "@@X"；用户符号 →
// "@@sym#<身份 id>"）——普通对象面的符号槽寻址单一事实源（片 W7 建）。
import { symbolSlotKeyOf } from "./containers/symbol-slot.ts";
import { arrayLengthIsNonConfigurable } from "./array-length.ts";
import { getEvalClass, lookupClassValue, BUILTIN_ERROR_SUPER, fnProtoOf } from "../class-registry.ts";
import { classNameOfValue, markClassValue } from "../../class-mark.ts";
import { NudoThrow, noBody, undef, throwStrictWrite, writeInPlace, clearStaleTermPred, asAbsVal, isDefinitelyTrue, isDefinitelyFalse, currentExecPhi, $lit, litTruth } from "./state.ts";
import { $typeof, $eq, $ne } from "./ops.ts";
import { $objAccessor, lookupObjAccessor, migrateAccessors, accessorTable } from "../../accessors.ts";
// Bug 230：Proxy [[Delete]] 规范不变量的单一实现（S9 落在 builtins/object/
// descriptor.ts）——delete 运算符路径（$delRes）接线；Reflect.deleteProperty
// 臂已由 S9 接线。
import { enforceProxyDeleteInvariant } from "../../builtins/object/descriptor.ts";
// Bug 194：`delete X.prototype.m` 的方法注册表侧移除钩子（S8 落在
// exec/class/declare.ts）——引擎的类方法不在原型对象的槽里，只删槽不留痕。
import { deleteProtoMethod, bindCtorFacetOf } from "../class/declare.ts";

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

/**
 * Bug 214 / 238：内建**原型对象**上的 brand check 访问器——读面原生**定抛
 * TypeError**（getter 要求 this 是实例 / symbol）：
 * - `Symbol.prototype.description` → this 不是 symbol → TypeError；
 * - `Map.prototype.size` / `Set.prototype.size` → this 不是实例 → TypeError。
 * 此前漏槽 → 折 exact undefined（wrong-exact），且**不记 throws**（L2 门禁
 * 假绿——原生必抛的读被当成「读到 undefined」）。
 *
 * 读面经 findClassAccessor 钩子定抛（brand 接收者的访问器唯一入口——
 * member.ts 的 brand 臂 `findClassAccessor(o.shape.name, key)`）。
 */
const BUILTIN_PROTO_BRAND_GUARDS: Record<string, ReadonlySet<string>> = {
  "Symbol.prototype": new Set(["description"]),
  "Map.prototype": new Set(["size"]),
  "Set.prototype": new Set(["size"]),
};

/** 沿继承链找实例 class get/set 访问器 */
export function findClassAccessor(
  startName: string,
  key: string,
): ClassAccessor | undefined {
  // Bug 214 / 238：内建原型对象的 brand check 访问器——读定抛 TypeError
  // （this 不是实例 / symbol）。写面同口径（getter-only → strict TypeError）。
  if (BUILTIN_PROTO_BRAND_GUARDS[startName]?.has(key)) {
    return {
      get: () => {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      },
    };
  }
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
  //
  // 族 57 · 第 6 条 ②（外-02 符号键槽寻址 · 第二半）：槽键改用
  // **symbolSlotKeyOf**——well-known 符号 → "@@X"（同 slotKeyOfSymbolAbs），
  // **用户符号**（Symbol("x") / Symbol.for("x")）→ "@@sym#<身份 id>"
  // （每次调用新符号 ⇒ 新 id；Symbol.for 驻留 ⇒ 同 id 同槽键；**不按
  // description**——description 可撞会串键）。此前只认 well-known 符号 ⇒
  // 用户符号的 `in` 折 boolean 域（原生 true）。无身份 id 的符号 → undefined
  // ⇒ 键不可判 ⇒ 仍折 boolean（不得凭空捏）。
  const symSlotKey = symbolSlotKeyOf(key);
  const keyStr = propertyKeyOf(key) ?? symSlotKey;
  if (keyStr === undefined) {
    // 抽象键 / 无身份的符号——键不可判
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
        // Bug 209：has 陷阱返回值按规范 **ToBoolean**（`has:()=>0` → false、
        // `has:()=>""` → false、`has:()=>[]` → true）——此前把陷阱原始返回值
        // 直接当判定结果（number 0 折「有」、空串折「有」：wrong-exact）。
        const r = $call(trap.fn, [parts.target, symSlotKey !== undefined ? key : strLit(String(kv))], parts.handler);
        const truth = litTruth(r);
        if (truth !== undefined) return boolLit(truth);
        return bool();
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
      // Bug 295：symbol 键槽（Slot.symbolKey）只对**真 symbol 键**可见——
      // 引擎把 symbol 键投影成 "@@X" 槽名，原生 `"@@toStringTag" in t` = false
      // （那是字符串键，t 上只有 Symbol.toStringTag 这个 symbol 键）。
      // 键是 symbol 时 symSlotKey === keyStr ⇒ 命中；键是字符串 ⇒ 不得命中。
      if (slot.symbolKey === true && symSlotKey === undefined) {
        return boolLit(false);
      }
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
  // 族 62 · 第 1 条：Intl.Collator 实例面（此前缺席 → `typeof
  // new Intl.Collator().compare` 折精确 "undefined"（wrong-exact：原生是
  // "function"））。原生面 = %Intl.Collator.prototype% 的 compare /
  // resolvedOptions（node v26.10.0 实测
  // Object.getOwnPropertyNames(Intl.Collator.prototype) =
  // ["constructor","resolvedOptions","compare"]；constructor 不入实例面）。
  "Intl.Collator": new Set(["compare", "resolvedOptions"]),
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

/**
 * Bug 192：`X.prototype` 品牌上的**自有**成员判定（`X.prototype
 * .hasOwnProperty("m")` 原生 true——m 是 owner 类的实例方法，就挂在
 * owner.prototype 上）。
 *
 * 供 builtins/object-proto.ts 的 hasOwnDecision 接线（该文件不在本分片的
 * 可改面——见报告的越界诉求；一行调用即可）。
 * 只认 owner 类的**自有**方法 / 访问器（祖先类的方法在原型链上，原生
 * hasOwnProperty 折 false）；数据槽（`A.prototype.x = 1`）由
 * hasOwnDecision 的内层槽读覆盖。
 */
export function protoBrandOwnMember(brandName: string, key: string): boolean {
  if (!brandName.endsWith(".prototype")) return false;
  const owner = brandName.slice(0, -".prototype".length);
  const spec = getEvalClass(owner);
  if (!spec) return false;
  if (spec.methods?.[key] !== undefined) return true;
  if (spec.accessors?.[key] !== undefined) return true;
  return false;
}

/**
 * 族 58 · Bug 321/3：原型 brand（`X.prototype`）的**自有键**精确清单
 * （gOPN 语义：「全部自有键」，含不可枚举）。
 *
 * 覆盖范围（**只**覆盖引擎已建模成员的原型；其余原型保持既有保守域
 * `string[]`——**不扩 Abs 形状**，避免把本项升级成 A 类架构债）：
 * - Error 家族原型：自有数据属性 name/message（引擎已建模）+ 自有方法
 *   toString（**仅** Error.prototype 自有；子类的 toString 是继承的——
 *   node v26.10.0 实测 `Object.getOwnPropertyNames(TypeError.prototype)`
 *   = ["constructor","name","message"]，toString 在原型链上）。
 * - 用户类原型：constructor + owner 类的**自有**实例方法/访问器（祖先类
 *   成员在原型链上，原生 gOPN 不列）。
 *
 * 顺序：原生 gOPN 按**定义序**（constructor 在先）。引擎的类注册表把方法与
 * 访问器分两张表（spec.methods / spec.accessors）⇒ 交错定义序不可复原 ⇒
 * 方法与访问器**同时**存在时不给精确清单（返回 undefined，保持保守域）。
 */
const PROTO_BRAND_OWN_KEYS: Record<string, readonly string[]> = {
  "Error.prototype": ["constructor", "name", "message", "toString"],
  "TypeError.prototype": ["constructor", "name", "message"],
  "RangeError.prototype": ["constructor", "name", "message"],
  "ReferenceError.prototype": ["constructor", "name", "message"],
  "SyntaxError.prototype": ["constructor", "name", "message"],
  "URIError.prototype": ["constructor", "name", "message"],
  "EvalError.prototype": ["constructor", "name", "message"],
  "AggregateError.prototype": ["constructor", "name", "message"],
};

/**
 * 族 58 · Bug 321/3：原型 brand 的自有键集（精确清单或 undefined=开放）。
 * 单一事实源——消费方：builtins/object/enum-entries.ts 的
 * builtinBrandOwnKeyNames（gOPN 面）与 builtins/object/methods.ts 的
 * Object.hasOwn 面（该文件不在本分片的可改面——见报告的越界诉求；
 * 一行调用即可）。
 */
export function protoBrandOwnStringKeys(brandName: string): string[] | undefined {
  // 生成器原型 brand（`${fn名}.generatorProto`）：原生 `g.prototype` 的自有键集
  // **恒空**（next/return/throw 在 %GeneratorPrototype% 上——原型链，非自有键；
  // node 实测 `Object.getOwnPropertyNames(g.prototype)` === []）⇒ 空元组。
  if (brandName.endsWith(".generatorProto")) return [];
  if (!brandName.endsWith(".prototype")) return undefined;
  const fixed = PROTO_BRAND_OWN_KEYS[brandName];
  if (fixed) return [...fixed];
  const owner = brandName.slice(0, -".prototype".length);
  const spec = getEvalClass(owner);
  if (!spec) return undefined;
  const methods = Object.keys(spec.methods ?? {});
  const accessors = Object.keys(spec.accessors ?? {});
  // 方法/访问器交错定义序不可复原 ⇒ 不给精确清单（保持保守域）。
  if (methods.length > 0 && accessors.length > 0) return undefined;
  const keys = ["constructor"];
  for (const k of [...methods, ...accessors]) {
    if (k === "constructor" || keys.includes(k)) continue;
    keys.push(k);
  }
  return keys;
}

/**
 * 族 58 · Bug 5：任意 brand 的 **"length" 槽**（成员读语义）——env 声明面
 * 建模的槽（如 Buffer 实例的 `length`）此前不可读：core 的 `$len` 只认
 * 少数品牌（String / TypedArray 家族 / Arguments / Proxy），其余 brand 一律
 * 折 unknown ⇒ `buf.length` 拿不到。
 *
 * 口径：**只**认内层 obj 的**非可选** "length" 槽（无槽的 brand 沿既有
 * unknown 口径；可选槽的 length 读出 `T | undefined`——本 helper 只回
 * 确定的非可选槽，可选槽仍沿调用方的 unknown 口径）。
 */
export function brandLengthSlotValue(a: Abs): Abs | undefined {
  if (!a || a.shape.k !== "brand") return undefined;
  const inner = (a.shape as { shape?: Abs }).shape;
  if (!inner || inner.shape.k !== "obj") return undefined;
  const slot = getSlot((inner.shape as ObjShape).slots, "length");
  if (!slot || slot.optional) return undefined;
  return slot.value;
}

/**
 * Bug 217：开放对象**声明的索引值域**（`shape.index.value`）——成员读优先用
 * 它（`process.env.HOME` → `string | undefined`；`process.versions.node` →
 * `string`），无索引声明才退 unknown（那才是真正的「推断失败」）。
 *
 * 供 member.ts 的开放对象读臂接线（该文件不在本分片的可改面——见报告的
 * 越界诉求；一行调用即可）：
 * `if ((o.shape as ObjShape).open) return openIndexValueOf(o) ?? unknown;`
 *
 * 符号键例外：原生 `process.env[Symbol.iterator]` → undefined（env 无符号
 * 键）——调用方按符号键跳过本 helper（isSymbolKey 参数）。
 */
export function openIndexValueOf(o: Abs, isSymbolKey = false): Abs | undefined {
  if (isSymbolKey) return undefined;
  const s = o.shape;
  if (s.k === "obj") {
    const idx = (s as ObjShape).index;
    return idx ? idx.value : undefined;
  }
  if (s.k === "brand") {
    const inner = (s as { shape?: Abs }).shape;
    if (inner && inner.shape.k === "obj") {
      const idx = (inner.shape as ObjShape).index;
      return idx ? idx.value : undefined;
    }
  }
  return undefined;
}

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
  // Bug 214 / 238：内建**原型对象**上的 brand check 访问器（`"size" in
  // Map.prototype` 原生 true；值读定抛 TypeError——见
  // BUILTIN_PROTO_BRAND_GUARDS）。此前原型名缺席 → in 折 exact false。
  "Map.prototype": new Set(["size"]),
  "Set.prototype": new Set(["size"]),
  "Symbol.prototype": new Set(["description"]),
  ...Object.fromEntries(
    Object.keys(TYPED_ARRAY_ELEMENT).map((fam) => [
      fam,
      new Set(["buffer", "byteLength", "byteOffset", "length", "BYTES_PER_ELEMENT"]),
    ]),
  ),
  // Bug 329：symbol **包装对象**（Object(Symbol("x"))）的 description
  // 访问器挂在 Symbol.prototype 上 ⇒ 包装对象也继承到（原生
  // `"description" in Object(Symbol("x"))` → true；此前折 exact false）。
  // 值读由 global.ts 的装箱槽给出 exact 描述串（非本表职责）。
  Symbol: new Set(["description"]),
};

/** 链构造单一实现：registry extends 优先，内建错误层级回退（限深防环）。
 *  includeOwner 只影响 ".prototype" 名（owner 是否入链）——两个导出包装的
 *  唯一差异。 */
function classChain(name: string, includeOwner: boolean): string[] {
  const ownerOf = name.endsWith(".prototype") ? name.slice(0, -".prototype".length) : name;
  const out = [name];
  // Bug 192：owner 入链（其实例方法挂 owner.prototype）——仅成员查找链
  if (includeOwner && ownerOf !== name && getEvalClass(ownerOf)) out.push(ownerOf);
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

/** evaluator 品牌链（**成员查找链**）：registry extends 优先，内建错误层级回退
 *  （限深防环）。
 *  Bug 192：".prototype" 后缀名（protoBrandAbs 品牌）的链**含 owner 类**——
 *  owner 的实例方法就挂在 owner.prototype 上（`A.prototype.m` 原生是函数、
 *  `"m" in A.prototype` 原生 true）。此前链只从 owner 的**父类**起走
 *  （`evalClassChain("A.prototype") === ["A.prototype"]`）→ 成员读 / in 双双
 *  折 exact undefined / false（wrong-exact）。
 *  owner 仅在**已注册**时入链（内建构造器名不在 registry——其原型面走
 *  BUILTIN_BRAND_* 表，链语义保持不变）。 */
export function evalClassChain(name: string): string[] {
  return classChain(name, true);
}

/**
 * evaluator 品牌链（**[[Prototype]] 链**语义）："X.prototype" 的链**不含
 * owner**——OrdinaryHasInstance 从 O.[[Prototype]] 起步：`X.prototype
 * instanceof X` 原生 false（owner 不在自己的原型链上），
 * `X.prototype instanceof Super` 命中 owner 的 super 链。
 *
 * 与 evalClassChain（成员查找链，含 owner）分工：instanceof 判定走本函数，
 * 成员查找（方法 / 访问器 / 数据槽）走 evalClassChain。
 */
export function evalProtoChain(name: string): string[] {
  return classChain(name, false);
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
 * Bug 203：类 spec 是否声明了静态 `@@hasInstance` 成员（类体
 * `static [Symbol.hasInstance](){}` / `static [Symbol.hasInstance] = fn`
 * ——transpile 期句法形 Symbol.X 投影为静态名 "@@X"，见
 * exec/transpile/class-emit.ts）。
 */
function classDeclaresHasInstance(name: string): boolean {
  const spec = getEvalClass(name);
  if (!spec) return false;
  return (
    spec.staticMethods?.["@@hasInstance"] !== undefined ||
    spec.statics?.["@@hasInstance"] !== undefined
  );
}

/**
 * Bug 203：槽是否是**真** `Symbol.hasInstance` 钩子。
 *
 * 原生：`@@hasInstance` 是**符号**键的内部投影；用户写的**普通字符串键**
 * `"@@hasInstance"`（`o["@@hasInstance"]=fn` / `A["@@hasInstance"]=fn`）是
 * 一个**普通自有属性**，与符号键是两个键——`instanceof` 只看符号键。
 * 此前两者混同 → 字符串键被当钩子调用（`1 instanceof o` 折 true，原生
 * TypeError：RHS 非 callable）。
 *
 * 真钩子的两种来源：
 * 1. 动态写 `[Symbol.hasInstance] = fn` → 槽带 Slot.symbolKey 标记
 *    （transpile 的计算符号键投影，$set opts.symbolKey）；
 * 2. 类体 `static [Symbol.hasInstance]…` → 类 spec 声明了该静态成员
 *    （declare.ts 落同名槽；槽本身无 symbolKey 标记）。
 */
function isHasInstanceHookSlot(slot: Slot | undefined, ownerName?: string): boolean {
  if (!slot) return false;
  if (slot.symbolKey === true) return true;
  if (ownerName !== undefined && classDeclaresHasInstance(ownerName)) return true;
  return false;
}

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
    // Bug 203：只有**符号键**投影的槽（Slot.symbolKey）才是 Symbol.hasInstance
    // 钩子；普通字符串键 "@@hasInstance" 是用户自有属性（原生不参与
    // instanceof 判定）——此前两者混同 → `o["@@hasInstance"]=fn` 被当钩子。
    const slot = (rightVal.shape as ObjShape).slots["@@hasInstance"];
    const callable =
      isHasInstanceHookSlot(slot) &&
      (slot!.value.shape.k === "fn" || getFnImpl(slot!.value) !== undefined);
    if (!callable) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // callable 槽可能缺位（optional）：缺位路径无处理器 → 原生定抛 → may
    if (slot!.optional) {
      recordMayThrow({
        kind: "TypeError",
        cause: "instanceof RHS @@hasInstance slot may be absent",
      });
    }
  }
  if (k === "brand" && classNameOfValue(rightVal as object) !== undefined) {
    // Bug 50：类值带自有 @@hasInstance 槽但不可调用 → 原生 GetMethod 定抛
    //（"x is not a function"，与闭 obj 臂同口径；继承槽只折抽象 boolean）
    // Bug 203：普通字符串键槽不是 Symbol.hasInstance 钩子 → 不按钩子定抛
    //（原生 `1 instanceof A` 走 OrdinaryHasInstance → false，不抛）。
    const inner = (rightVal.shape as { shape?: Abs }).shape;
    const slot =
      inner && inner.shape.k === "obj"
        ? getSlot((inner.shape as ObjShape).slots, "@@hasInstance")
        : undefined;
    if (
      slot &&
      isHasInstanceHookSlot(slot, rightVal.shape.name) &&
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
  // Bug 203：普通字符串键槽不是 Symbol.hasInstance 钩子（原生字符串键与
  // 符号键是两个键）→ 不作钩子返回。
  if (own && isHasInstanceHookSlot(own, rv.shape.name)) return own;
  for (const n of evalClassChain(rv.shape.name)) {
    if (n === rv.shape.name) continue;
    const cv = lookupClassValue(n);
    const ci = cv && cv.shape.k === "brand" ? (cv.shape as { shape?: Abs }).shape : undefined;
    const s2 =
      ci && ci.shape.k === "obj"
        ? getSlot((ci.shape as ObjShape).slots, "@@hasInstance")
        : undefined;
    // 继承槽：类体声明（spec 声明）或动态符号键写（symbolKey 标记）
    if (s2 && isHasInstanceHookSlot(s2, n)) return s2;
  }
  return undefined;
}

/**
 * Bug 205：RHS 构造器的 prototype（原生 OrdinaryHasInstance 的
 * `Get(C, "prototype")`）。
 *
 * - 宿主函数 **facade**（member.ts 的 `$set` 宿主函数臂建——`F.prototype = {}`
 *   的写落进 facade 的槽）：其 "prototype" 槽 = 原型被替换后的新原型
 *   （含**非对象**值——原生此时定抛 TypeError）。
 * - 类值：prototype 不可写（Bug 206）⇒ 恒 protoBrandAbs(类名)。
 * - 其它 fn Abs：按名 protoBrandAbs（与 `f.prototype` 读同一载体）。
 */
function rhsPrototypeOf(
  rightName: string,
  rightVal?: Abs,
): { proto: Abs; ctorName: string } | undefined {
  if (rightVal === undefined) {
    return { proto: protoBrandAbs(rightName), ctorName: rightName };
  }
  const rv = asAbsVal(rightVal);
  const sh = rv.shape;
  if (sh.k === "fn") {
    const nm = (sh as { name?: string }).name ?? rightName;
    if (sh.slots) {
      const slot = getSlot(sh.slots, "prototype");
      if (slot) return { proto: slot.value, ctorName: nm };
    }
    return { proto: protoBrandAbs(nm), ctorName: nm };
  }
  if (sh.k === "brand" && classNameOfValue(rv as object) !== undefined) {
    return { proto: protoBrandAbs(rightName), ctorName: rightName };
  }
  return undefined;
}

/**
 * Bug 205（补面）：obj 形状里是否有**内部槽**（协议面 / 生成器对象等**引擎
 * 替身**）——内部槽 obj 不是用户写的对象字面量：其真实 [[Prototype]] 不是
 * Object.prototype（生成器对象 ⇒ Generator.prototype）⇒ 不得按「闭 obj ⇒
 * 原型链 = [Object.prototype]」定论（引擎自身的 protoOfRecv 口径对替身 obj
 * 同样只是近似）。
 */
function hasInternalSlot(o: Abs): boolean {
  if (o.shape.k !== "obj") return false;
  for (const s of Object.values(o.shape.slots)) {
    if (s.internal) return true;
  }
  return false;
}

/**
 * Bug 205（补面）：**闭 obj**（对象字面量）接收者的 instanceof 定论——RHS 的
 * prototype 对象（只在「原生必有 .prototype **对象**」时给出，否则调用方降
 * 抽象——不误判）：
 *
 * - 类值（brand + classNameOfValue）：类必有 prototype 对象 ✅；
 * - fn 形状且**可构造**（`ctor === true`）且**不是 bind 产物**（bind 产物可
 *   构造但**无** .prototype 属性 ⇒ 原生 OrdinaryHasInstance 定抛 TypeError）：
 *   facade 的 prototype 槽（`F.prototype = X` 的写落点）优先，否则按名
 *   protoBrandAbs（与 `F.prototype` 读同一载体）；
 * - 其余（箭头 / async / generator——原生**无** .prototype ⇒ 定抛；非类值的
 *   brand 实例——原生 RHS 不可调用 ⇒ 定抛；any / unknown / sum）⇒ undefined。
 */
function closedObjRhsPrototype(rightName: string, rightVal: Abs | undefined): Abs | undefined {
  if (rightVal === undefined) return undefined;
  const rv = asAbsVal(rightVal);
  const sh = rv.shape;
  if (sh.k === "brand") {
    if (classNameOfValue(rv as object) === undefined) return undefined;
    return protoBrandAbs(rightName);
  }
  if (sh.k === "fn") {
    if (sh.ctor !== true) return undefined;
    // bind 产物：可构造但**无** .prototype（原生 instanceof 定抛 TypeError）
    if (bindCtorFacetOf(rv) !== undefined) return undefined;
    const nm = sh.name ?? rightName;
    if (sh.slots) {
      const slot = getSlot(sh.slots, "prototype");
      if (slot) return slot.value;
    }
    return protoBrandAbs(nm);
  }
  return undefined;
}

/** 确定非对象（原生 `Get(C,"prototype")` 非 Object ⇒ TypeError）。 */
function isDefinitelyNonObjectAbs(a: Abs): boolean {
  if (a.shape.k === "prim") return true;
  const t = a.term;
  if (t?.op === "lit") {
    const v = (t as { value?: unknown }).value;
    return v === null || typeof v !== "object";
  }
  return false;
}

/** 原型链上的一步（[[Prototype]] 的下一环）。 */
type ProtoStep =
  | { kind: "next"; proto: Abs }
  | { kind: "end" }
  | { kind: "unknown" };

/**
 * Bug 205：原型对象的 [[Prototype]] 一步。
 *
 * - Object.prototype：[[Prototype]] 是 null → 链终结符。
 * - 原型对象 brand（"X.prototype"）：其 [[Prototype]] = 父类原型对象
 *   （extends null 的类 → null，链终结）。
 * - 其它对象（obj / arr / 替换进来的任意原型）：其 [[Prototype]] 未建模
 *   → 不可判（降 boolean，**不得** exact false）。
 */
function protoStepOf(cur: Abs): ProtoStep {
  if (isObjectProtoBrand(cur)) return { kind: "end" };
  const sh = cur.shape;
  if (sh.k === "brand" && sh.name.endsWith(".prototype")) {
    const owner = sh.name.slice(0, -".prototype".length);
    if (getEvalClass(owner)?.superNull) return { kind: "end" };
    const chain = evalProtoChain(sh.name);
    if (chain.length <= 1) return { kind: "next", proto: objectProtoBrand() };
    const pname = chain[1]!;
    const pbase = pname.endsWith(".prototype") ? pname.slice(0, -".prototype".length) : pname;
    return { kind: "next", proto: protoBrandAbs(pbase) };
  }
  return { kind: "unknown" };
}

/**
 * Bug 205：实例沿**真实 [[Prototype]] 链**与 RHS 的 prototype 做**身份**
 * 比较（原生 OrdinaryHasInstance：从 O.[[Prototype]] 起步，在链上找
 * SameValue(O, Get(C,"prototype"))）。
 *
 * 仅在「原型确实被换过」时接管——其余情形沿既有**名字**匹配语义（不动
 * 已钉用例）：
 * - RHS 的 prototype ≠ 该构造器的原型对象（原型被替换 / facade 槽）；
 * - 或实例记录的 [[Prototype]] ≠ 其构造器的原型对象（实例原型被改写 /
 *   换原型**前**造的旧实例记的是旧原型）。
 *
 * 链不可判（动态改写未建模）时降 boolean——**不得** exact true。
 */
function instanceofByProtoChain(left: Abs, rightName: string, rightVal?: Abs): Abs | undefined {
  if (left.shape.k !== "brand") return undefined;
  const brandName = left.shape.name;
  // 原型对象 brand（A.prototype）自身不在本路径处理面：它的 [[Prototype]]
  // 起点是**父类**原型（`A.prototype instanceof A` 原生 false）——既有
  // evalProtoChain 语义已覆盖。
  if (brandName.endsWith(".prototype")) return undefined;
  const rhs = rhsPrototypeOf(rightName, rightVal);
  if (rhs === undefined) return undefined;
  const canonicalLhs = protoBrandAbs(brandName);
  const canonicalRhs = protoBrandAbs(rhs.ctorName);
  const rec = getInstanceProto(left);
  const lhsChanged = rec !== undefined && rec !== canonicalLhs;
  const rhsChanged = rhs.proto !== canonicalRhs;
  if (!lhsChanged && !rhsChanged) return undefined;
  // 原型被换成非对象：原生 OrdinaryHasInstance 定抛 TypeError
  // （`F.prototype = 5` → `f instanceof F` TypeError）。
  if (isDefinitelyNonObjectAbs(rhs.proto)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  let cur: Abs | undefined = rec ?? canonicalLhs;
  let depth = 0;
  while (cur !== undefined && depth++ < 32) {
    if (cur === rhs.proto) return boolLit(true);
    const step = protoStepOf(cur);
    if (step.kind === "end") return boolLit(false);
    if (step.kind === "unknown") return bool();
    cur = step.proto;
  }
  return bool();
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
      // Bug 203：普通字符串键 "@@hasInstance" 不是 Symbol.hasInstance 钩子
      const raw = rv.shape.slots["@@hasInstance"];
      slot = isHasInstanceHookSlot(raw) ? raw : undefined;
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
  // Bug 205：RHS 的 prototype 为**非对象**时，原生 OrdinaryHasInstance 在
  // 走原型链**之前**定抛 TypeError（`F.prototype = 5` → `f instanceof F`
  // TypeError）——此前引擎按构造器名匹配折 exact true（假绿）。
  // （自定义 @@hasInstance 短路该路径，故本检查在其之后。）
  if (rightVal !== undefined) {
    const rhs = rhsPrototypeOf(rightName, asAbsVal(rightVal));
    if (rhs !== undefined) {
      if (isDefinitelyNonObjectAbs(rhs.proto)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // 抽象原型值：可能非对象 → 记 may-throw（不得折确定的 true/false）
      if (rhs.proto.shape.k === "any" || rhs.proto.shape.k === "unknown" || rhs.proto.shape.k === "sum") {
        recordMayThrow({
          kind: "TypeError",
          cause: "instanceof RHS prototype is abstract (may be a non-object)",
        });
      }
    }
  }
  // Bug 205（左操作数收形）：左操作数可能是**宿主函数**（转译的函数声明 /
  // 函数表达式——不是 Abs，原生是函数值）：原生 `F instanceof Function` 为
  // true（函数的 [[Prototype]] 是 Function.prototype）、`F instanceof Object`
  // 同为 true。此前直读 left.shape 崩 ⇒ 引擎 fail-closed 折 unknown（原生
  // true ⇒ 精度债）。asAbsVal 收成 fn 形状（宿主函数的稳定门面，state.ts）。
  // **收形放在 @@hasInstance 钩子之后**——钩子拿到的是**原生左值**（不收形）。
  if (typeof (left as unknown) === "function") left = asAbsVal(left as unknown);
  switch (left.shape.k) {
    case "brand":
      // 类值本身是 constructor 函数：instanceof Function/Object 恒 true
      if (classNameOfValue(left as object) !== undefined) {
        return boolLit(rightName === "Function" || rightName === "Object");
      }
      // Bug 205：实例原型被置 null（`Object.setPrototypeOf(f, null)`）→
      // [[Prototype]] 链终止 → OrdinaryHasInstance 恒 false（引擎此前按
      // 构造器**名**匹配折 exact true——unsound 的肯定判断）。null-proto
      // 标记随 setPrototypeOf 落（objects.ts 侧表），obj 接收者同口径
      // 见下方 case "obj" 臂。
      if (isNullProtoObj(left)) return boolLit(false);
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
      // Bug 205：原型被替换（`F.prototype = {}`）/ 实例原型被改写
      // （`Object.setPrototypeOf(f, {})`）时，沿**真实 [[Prototype]] 链**做
      // **身份**比较（原生 OrdinaryHasInstance）——此前按构造器**名**匹配折
      // exact true（unsound 的肯定判断：类型守卫会走错分支）。
      const byProto = instanceofByProtoChain(left, rightName, rightVal);
      if (byProto !== undefined) return byProto;
      // P3b：fn 值父类（函数表达式 extends）——链名是伪名（__nudoFnParentN），
      // rightName 不命中；按注册类值**身份**匹配（lookupClassValue(链名) ===
      // rightVal → 同一父构造器值）折 true（与名匹配同一名键假设，last-wins
      // 语义一致）。身份不匹配不折（落 boolean）。
      if (rightVal !== undefined) {
        const rv = asAbsVal(rightVal);
        // Bug 192 / 205：instanceof 走 [[Prototype]] 链（**不含 owner**）——
        // `X.prototype instanceof X` 原生 false；成员查找链（含 owner）走
        // evalClassChain。
        for (const n of evalProtoChain(left.shape.name)) {
          if (lookupClassValue(n) === rv) return boolLit(true);
        }
      }
      return boolLit(
        rightName === "Object" || evalProtoChain(left.shape.name).includes(rightName),
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
      //
      // Bug 205（补面）：**闭 obj**（对象字面量）的 [[Prototype]] 恰是
      // Object.prototype ⇒ 原型链恰是 [Object.prototype]（下一环 null）——
      // 与 RHS 的 prototype 做**身份**比较即可定论：命中（= Object.prototype）
      // → true，否则 false（原生 false：用户类 / 用户函数的 prototype 都不是
      // Object.prototype）。此前只对**内建**构造器名折 exact false，用户类 /
      // 用户函数折抽象 boolean（原生 false）——精度债。
      // RHS 的 prototype 不可判时（箭头 / async / generator / bind 产物——
      // 原生可能定抛 TypeError；非类值的 brand 实例——原生定抛）⇒ 保持抽象
      // （不误判），见 closedObjRhsPrototype。**内部槽 obj**（引擎替身：生成器
      // 对象 / 协议面）不是用户写的对象字面量 ⇒ 同样不按闭 obj 定论。
      if (!left.shape.open) {
        if (!hasInternalSlot(left)) {
          const rhsProto = closedObjRhsPrototype(rightName, rightVal);
          if (rhsProto !== undefined) return boolLit(rhsProto === objectProtoBrand());
        }
        if (BUILTIN_CTOR_NAMES.has(rightName)) return boolLit(false);
      }
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

/**
 * ClassExpression 值：构造器函数形状，不得折成精确 undefined。
 *
 * Bug 133：name —— **NamedEvaluation 名**（`const K = class {}` → "K"）。
 * 空类体走本快路径（fn 形状），类名落在 fn 形状的 name 位（$get(fn,"name")
 * 读 shape.name）——无名类不传（原生名为空串）。
 */
export function $classExpr(name?: string): Abs {
  return absFunction(
    ["_rest"],
    {
      body: noBody,
      apply: () => unknown,
    },
    // Bug 9：类表达式值是构造器，可 new
    name === undefined ? { ctor: true } : { ctor: true, name },
  );
}

/**
 * `delete obj[key]` 的结果判定（只读，不写回）。
 * frozen/sealed 或 configurable:false 键 → false；preventExtensions 可删；
 * 数组 length 恒不可配置 → strict 定抛 TypeError（Bug 230）；
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
      // Bug 230：Proxy [[Delete]] 规范不变量（ES2024 10.5.9 step 10）——陷阱
      // 返回 **true** 时，若靶上该键是**不可配置**自有属性 ⇒ 原生定抛
      // TypeError。此前运算符路径直接返 true（假绿；Reflect.deleteProperty
      // 臂已由 S9 接线，此处补 delete 运算符路径）。
      if (trapR.term?.op === "lit" && trapR.term.value === true) {
        enforceProxyDeleteInvariant(o, _key);
      }
      return trapR;
    }
  }
  // Bug 230：数组实例的 length 是**不可配置**自有属性
  // （{value:n, writable:true, enumerable:false, configurable:false}）→
  // delete 恒 TypeError（strict）。与冻结档无关（数组恒不可配置 length），
  // 故须在 frozen/sealed 门**之前**判。抽象键（key 不可判）→ 不拦。
  if (arrayLengthIsNonConfigurable(o, kv !== undefined ? String(kv) : undefined)) {
    throwStrictWrite();
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
 * 抽象 arr 元素并入 undefined；数组 length 不可配置 → strict 定抛
 * TypeError（Bug 230）；无法表达的形态原样返回。
 */
export function $del(o: Abs, key: Abs): Abs {
  // ToPropertyKey：null/undefined/boolean → "null"/"undefined"/"true"
  //
  // 族 57 · 第 6 条 ②（外-02 符号键槽寻址 · 第二半）：符号键的槽寻址键用
  // **symbolSlotKeyOf**（well-known → "@@X"；用户符号 → "@@sym#<身份 id>"）
  // ——此前 propertyKeyOf(symbol) 恒 undefined ⇒ obj 臂整段跳过 ⇒ 符号槽
  // **删不掉**（原生 `delete o[Symbol.iterator]` 把槽删掉）。
  const keyStr = propertyKeyOf(key) ?? symbolSlotKeyOf(key);
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
  // Bug 230：数组 length 是**不可配置**自有属性 → delete 恒 TypeError
  // （strict）。与冻结档无关，故须在 frozen/sealed 门**之前**判（否则
  // nonext 数组的 delete a.length 会被放行）。抽象键 → 不拦。
  if (arrayLengthIsNonConfigurable(o, keyStr)) throwStrictWrite();
  // frozen/sealed：删除 TypeError（strict 硬抛；表达式 delete 走 $delRes 返回 false）
  if (st === "frozen" || st === "sealed") throwStrictWrite();
  if (o.shape.k === "brand") {
    // Bug 116：strict 毒丸——delete arguments.callee 定抛（与 $get/$set 的
    // brand 臂同口径；复用 throwStrictWrite 的 strict TypeError 通道）
    if (o.shape.name === "Arguments" && keyStr === "callee") throwStrictWrite();
    // Bug 194：`delete X.prototype.m` —— 原生删的是**原型对象上的自有属性**
    // （类方法就是原型对象的自有属性）。引擎的类方法在**方法注册表**
    // （spec.methods）里，原型对象上没有该方法的槽 ⇒ 只删槽不留痕 ⇒
    // findMethod 继续沿链命中（删除后仍可调用、`in` 面仍为真）。
    // 此处按 owner 名通知注册表侧移除（S8 的 deleteProtoMethod 钩子）——
    // delete 的返回值恒 true（原生同，与是否命中无关）。
    if (keyStr !== undefined && o.shape.name.endsWith(".prototype")) {
      deleteProtoMethod(o.shape.name.slice(0, -".prototype".length), keyStr);
    }
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
