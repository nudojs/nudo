/**
 * Object.prototype 成员（hasOwnProperty / isPrototypeOf / toString / …）
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, strLit, boolLit, unknown } from "../abs.ts";
import { objOf, canonicalArrayIndex, getSlot, isNullProtoObj } from "../objects.ts";
import {
  isMapAbs,
  isSetAbs,
  mapEntriesAbs,
  mapSizeAbs,
  setSizeAbs,
  setElementsAbs,
} from "../collections.ts";
import { absFunction } from "../abs-fn.ts";
import { lookupObjAccessor } from "../accessors.ts";
import { getEvalClass } from "../exec/class-registry.ts";
import { protoBrandOwnMember } from "../exec/runtime/members.ts";
import { classNameOfValue } from "../class-mark.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { str, boolPrim, noBody, peelBrand } from "./shared.ts";
import { isErrorCtorName } from "./error.ts";
import { getPropFlags, setPropFlags } from "./invariants.ts";
import { undefLit, isSymbolAbs, stringOfSymbol } from "./symbol.ts";
import {
  builtinCtorAbs,
  OBJECT_PROTO_METHOD_NAMES,
  objectProtoBrand,
  isObjectProtoBrand,
} from "./ctor.ts";

function toPropKey(a: Abs | undefined): string | "abstract" {
  if (a === undefined) return "undefined";
  const t = a.term;
  if (t?.op !== "lit") return "abstract";
  const v = t.value;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  return "abstract"; // symbol
}

function boolPrimB(): Abs {
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
}

function strPath(): Abs {
  return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
}

/**
 * Bug 90：类值自有静态面（spec 表）——静态方法/静态访问器是类构造器的
 * **自有**属性（ClassDefinitionEvaluation DefineOwnProperty 到类值，
 * 非枚举、不落 inner 槽）：`class D { static m(){} } D.hasOwnProperty("m")`
 * 原生 true。own-only 语义（与 classValueHasStatic 的全链 `in`
 * presence 互补）：m 挂祖先 A 时 B.hasOwnProperty("m") 原生 false。
 * 静态字段在 $class 已落类值槽（getSlot 命中），此处只补 spec 表两面。
 */
function classValueOwnStaticMember(recv: Abs, key: string): boolean {
  const s = recv.shape;
  if (s.k !== "brand" || classNameOfValue(recv as object) !== s.name) return false;
  const spec = getEvalClass(s.name);
  return (
    (spec?.staticMethods !== undefined && Object.hasOwn(spec.staticMethods, key)) ||
    (spec?.staticAccessors !== undefined && Object.hasOwn(spec.staticAccessors, key))
  );
}

/** hasOwnProperty 判定（自有槽 / 下标 / length / holes） */
function hasOwnDecision(recv: Abs, key: string): Abs {
  const s = recv.shape;
  if (s.k === "brand") {
    const inner = s.shape;
    // Number/Boolean/BigInt/Symbol 包装：无自有数据属性
    if (s.name === "Number" || s.name === "Boolean" || s.name === "BigInt" || s.name === "Symbol") {
      return boolLit(false);
    }
    if (classValueOwnStaticMember(recv, key)) return boolLit(true);
    // Bug 192：`X.prototype` 品牌上的**自有**成员（owner 类的实例方法 / 访问器
    // 就挂在 owner.prototype 上）→ hasOwnProperty 折 true。判定函数由
    // exec/runtime/members.ts 导出（protoBrandOwnMember——单一事实源）。
    if (protoBrandOwnMember(s.name, key)) return boolLit(true);
    if (inner.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      // Bug 84：internal 私有槽是内部槽——hasOwnProperty 折 false（$in 的
      // 槽存在性查询不走此判定，`#x in this` 保持 true）
      // Bug 66：inherited 槽（errorBrandAbs 的 name——原生经 X.prototype
      // 原型链解析）非自有属性 → false；$set 公有覆写已转自有不受影响
      if (slot?.internal || slot?.inherited) return boolLit(false);
      if (slot && !slot.optional) return boolLit(true);
      if (slot?.optional) return boolPrimB();
      if (!inner.shape.open) return boolLit(false);
      return boolPrimB();
    }
    return boolPrimB();
  }
  if (s.k === "obj") {
    const slot = getSlot(s.slots, key);
    // Bug 84：internal 私有槽非自有属性（同 brand 臂）；Bug 66 inherited 同
    if (slot?.internal || slot?.inherited) return boolLit(false);
    if (slot && !slot.optional) return boolLit(true);
    if (slot?.optional) return boolPrimB();
    if (!s.open && recv.conf === "exact") return boolLit(false);
    return boolPrimB();
  }
  if (s.k === "tuple") {
    if (key === "length") return boolLit(true);
    const idx = canonicalArrayIndex(key);
    if (idx !== undefined) {
      if (s.holes?.includes(idx)) return boolLit(false);
      return boolLit(idx < s.elements.length);
    }
    return boolLit(false);
  }
  if (s.k === "arr") {
    if (key === "length") return boolLit(true);
    return boolPrimB();
  }
  if (s.k === "prim") {
    if (s.type === "string") {
      if (key === "length") return boolLit(true);
      const idx = canonicalArrayIndex(key);
      if (idx !== undefined) {
        const litR = litValue(recv);
        const lit = litR.ok && typeof litR.value === "string" ? litR.value : undefined;
        if (typeof lit === "string") return boolLit(idx < lit.length);
        return boolPrimB();
      }
      return boolLit(false);
    }
    // number/boolean/bigint/symbol 装箱：无自有数据属性
    return boolLit(false);
  }
  if (s.k === "fn") {
    if (key === "length" || key === "name") return boolLit(true);
    return boolPrimB();
  }
  return boolPrimB();
}

/** propertyIsEnumerable：自有 + 可枚举（length 不可枚举；defineProperty enumerable:false） */
function propertyIsEnumerableDecision(recv: Abs, key: string): Abs {
  const own = hasOwnDecision(recv, key);
  const ownR = litValue(own);
  const ownV = ownR.ok ? ownR.value : undefined;
  if (ownV === false) return boolLit(false);
  // length 在数组/字符串包装上自有但不可枚举
  if (key === "length") {
    const s = recv.shape;
    if (s.k === "tuple" || s.k === "arr") return boolLit(false);
    if (s.k === "prim" && s.type === "string") return boolLit(false);
    if (s.k === "brand" && (s.name === "String" || s.name === "Array")) return boolLit(false);
  }
  // defineProperty(enumerable:false) 侧表
  // Bug 66：brand 接收者的 flags 记在内层 Abs 上（errorBrandAbs 家族槽
  // name/message/stack/errors/cause 全不可枚举）——只查外层 brand 会 miss
  // 折 true（原生 propertyIsEnumerable("message"|"stack"|"errors"|"cause")
  // 恒 false）。与 Object.keys/gOPD 的 isEnumerableView(inner,k) 同口径。
  const flagsHost = recv.shape.k === "brand" ? recv.shape.shape : recv;
  const flags = getPropFlags(flagsHost) ?? getPropFlags(recv);
  if (flags?.get(key)?.enumerable === false) return boolLit(false);
  // Bug 90：静态方法/静态访问器虽自有但**非枚举**（spec 表面）——PIE 恒 false
  if (classValueOwnStaticMember(recv, key)) return boolLit(false);
  // Bug 192：`X.prototype` 上的类方法 / 访问器同样**非枚举**（ClassDefinition
  // Evaluation 的方法定义是 non-enumerable）——PIE 恒 false
  if (recv.shape.k === "brand" && protoBrandOwnMember(recv.shape.name, key)) {
    return boolLit(false);
  }
  if (ownV === true) {
    // 下标在数组/字符串上可枚举
    return boolLit(true);
  }
  return boolPrimB();
}

/** Bug 72：@@toStringTag getter 求值 → 标签三值：
 *  - lit string → 标签
 *  - lit 非串（number/symbol/undefined…）→ null（native Type(tag)≠String
 *    折默认 "Object"）
 *  - 抽象串（非 lit）→ undefined（不折——native 可能是任意串） */
function accessorTagOf(get: (t: Abs) => Abs, recv: Abs): string | null | undefined {
  const vR = litValue(get(recv));
  if (!vR.ok) return undefined;
  if (typeof vR.value === "string") return vR.value;
  return null;
}

function typeTagOf(recv: Abs): string | undefined {
  if (recv.term?.op === "lit") {
    const v = recv.term.value;
    if (v === null) return "Null";
    if (v === undefined) return "Undefined";
    if (typeof v === "string") return "String";
    if (typeof v === "number") return "Number";
    if (typeof v === "boolean") return "Boolean";
    if (typeof v === "bigint") return "BigInt";
    if (typeof v === "symbol") return "Symbol";
  }
  const s = recv.shape;
  if (s.k === "prim") {
    // Bug 105：显式映射表——Abs prim 名 "bigint" 的大写化是 "Bigint"，
    // 规范 tag 是 "BigInt"（原生 Object.prototype.toString 折
    // "[object Bigint]" 假精确）。逐一映射，不再大小写推导。
    const PRIM_TAGS: Record<string, string> = {
      number: "Number",
      string: "String",
      boolean: "Boolean",
      bigint: "BigInt",
      symbol: "Symbol",
    };
    return PRIM_TAGS[s.type];
  }
  if (s.k === "arr" || s.k === "tuple") return "Array";
  if (s.k === "fn") return "Function";
  if (s.k === "eff") return s.eff === "promise" ? "Promise" : "Generator";
  if (s.k === "brand") {
    // 只折叠标准 Object.prototype.toString 标签；未建模 brand（URLSearchParams
    // 等）不得假精确折 [object X]——native 在无该全局时是 ReferenceError
    const KNOWN_TAGS = new Set([
      "Object", "Array", "String", "Number", "Boolean", "Function", "Promise",
      "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
      "ReferenceError", "URIError", "EvalError", "Map", "Set", "WeakMap", "WeakSet",
      "Object.prototype",
    ]);
    const inner = s.shape;
    if (inner.shape.k === "obj") {
      const tag = getSlot(inner.shape.slots, "@@toStringTag");
      if (tag) {
        const vR = litValue(tag.value);
        if (!vR.ok) return undefined;
        if (typeof vR.value === "string") return vR.value;
      }
      // Bug 72：访问器形 @@toStringTag——对象字面量 getter 落 accessorTable
      // 占位槽（lit(void 0)），数据槽读不到标签；$get 同款读派发调用
      // getter 求值（getter 体抛错则原生沿 ToString 链传播）。
      const acc = lookupObjAccessor(inner, "@@toStringTag");
      if (acc?.get) {
        const t = accessorTagOf(acc.get, recv);
        if (t !== null) return t;
      }
    }
    // Bug 72：class get [Symbol.toStringTag]() 形——computed 键投影
    // "@@toStringTag"（@@hasInstance 同款，见 exec/class.ts $class），沿
    // 继承链取注册表访问器求值
    {
      let cur: string | undefined = s.name;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const acc = getEvalClass(cur)?.accessors?.["@@toStringTag"];
        if (acc?.get) {
          const t = accessorTagOf(acc.get, recv);
          if (t !== null) return t;
        }
        cur = getEvalClass(cur)?.superName;
      }
    }
    if (KNOWN_TAGS.has(s.name) || s.name.endsWith("Error")) {
      // Bug 10：[[ErrorData]] 内部槽——整个 Error 家族统一 tag "Error"
      // （原生 Object.prototype.toString.call(new TypeError()) → "[object Error]"）
      if (isErrorCtorName(s.name)) return "Error";
      return s.name === "Object.prototype" ? "Object" : s.name;
    }
    return undefined;
  }
  if (s.k === "obj") {
    const tag = getSlot(s.slots, "@@toStringTag");
    if (tag) {
      const vR = litValue(tag.value);
      if (!vR.ok) return undefined;
      if (typeof vR.value === "string") return vR.value;
    }
    // Bug 72：访问器形（对象字面量 get [Symbol.toStringTag]）——getter 求值
    const acc = lookupObjAccessor(recv, "@@toStringTag");
    if (acc?.get) {
      const t = accessorTagOf(acc.get, recv);
      if (t !== null) return t;
    }
    return "Object";
  }
  return "Object";
}

/**
 * Object.prototype 方法语义（evaluator $invoke 与 Object.prototype.X.call 共用）。
 * null-proto 接收者无这些方法——返回 undefined（调用方走 TypeError 路径）。
 * 返回 undefined = 未接管。
 */
export function evalObjectProtoMethod(
  name: string,
  thisVal: Abs,
  args: Abs[],
): Abs | undefined {
  if (!OBJECT_PROTO_METHOD_NAMES.has(name)) return undefined;
  if (thisVal && typeof thisVal === "object" && "shape" in thisVal && isNullProtoObj(thisVal)) {
    return undefined;
  }
  // nullish this：ToObject 原生抛 TypeError
  if (thisVal && thisVal.term?.op === "lit" && (thisVal.term.value === null || thisVal.term.value === undefined)) {
    // Object.prototype.toString.call(null) 合法（返回 "[object Null]"）；
    // hasOwnProperty / valueOf 等经 ToObject 抛
    if (name !== "toString" && name !== "toLocaleString") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  switch (name) {
    case "hasOwnProperty": {
      const key = toPropKey(args[0]);
      if (key === "abstract") return boolPrimB();
      return hasOwnDecision(thisVal, key);
    }
    case "propertyIsEnumerable": {
      const key = toPropKey(args[0]);
      if (key === "abstract") return boolPrimB();
      return propertyIsEnumerableDecision(thisVal, key);
    }
    case "isPrototypeOf": {
      const v = args[0];
      if (!v) return boolLit(false);
      // 原始值 / nullish：Type(V) 不是 Object → false
      if (v.term?.op === "lit") {
        const vv = v.term.value;
        if (vv === null || vv === undefined || typeof vv !== "object") return boolLit(false);
      }
      const vk = v.shape.k;
      const vObjLike = vk === "obj" || vk === "arr" || vk === "tuple" || vk === "brand" || vk === "fn" || vk === "eff";
      if (!vObjLike && vk !== "sum" && vk !== "any" && vk !== "unknown") return boolLit(false);
      if (vObjLike && isNullProtoObj(v)) return boolLit(false);
      // Object.prototype.isPrototypeOf(V)：V 先取 [[GetPrototypeOf]] 再比 SameValue
      // —— 对象**不在**自己的原型链上：
      //   Object.prototype.isPrototypeOf(Object.prototype) === false
      if (isObjectProtoBrand(thisVal)) {
        if (isObjectProtoBrand(v)) return boolLit(false);
        return vObjLike ? boolLit(true) : boolPrimB();
      }
      return boolPrimB();
    }
    case "valueOf": {
      // Object.prototype.valueOf：对象恒等；prim 装箱非具体（差分不假精确）
      const s = thisVal.shape;
      if (s.k === "prim") return abs({ k: "unknown" }, undefined, undefined, "path");
      return thisVal;
    }
    case "toString":
    case "toLocaleString": {
      const tag = typeTagOf(thisVal);
      if (tag === undefined) return str();
      return strLit(`[object ${tag}]`);
    }
  }
  return undefined;
}

/** Object.prototype.X 一等函数（bindThis：call/apply 把 receiver 注入首参） */
export function objectProtoMethodAbs(name: string): Abs {
  return absFunction(["thisArg", "arg0"], {
    body: noBody,
    bindThis: true,
    apply: (a) => {
      const recv = a[0] ?? undefLit();
      return evalObjectProtoMethod(name, recv, a.slice(1)) ?? unknown;
    },
  }, { ctor: false }); // Bug 9：内建原型方法不可 new
}

