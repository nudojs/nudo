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
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { str, boolPrim, noBody, peelBrand } from "./shared.ts";
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

/** hasOwnProperty 判定（自有槽 / 下标 / length / holes） */
function hasOwnDecision(recv: Abs, key: string): Abs {
  const s = recv.shape;
  if (s.k === "brand") {
    const inner = s.shape;
    // Number/Boolean/BigInt/Symbol 包装：无自有数据属性
    if (s.name === "Number" || s.name === "Boolean" || s.name === "BigInt" || s.name === "Symbol") {
      return boolLit(false);
    }
    if (inner.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      if (slot && !slot.optional) return boolLit(true);
      if (slot?.optional) return boolPrimB();
      if (!inner.shape.open) return boolLit(false);
      return boolPrimB();
    }
    return boolPrimB();
  }
  if (s.k === "obj") {
    const slot = getSlot(s.slots, key);
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
        const lit = litValue(recv);
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
  const ownV = litValue(own);
  if (ownV === false) return boolLit(false);
  // length 在数组/字符串包装上自有但不可枚举
  if (key === "length") {
    const s = recv.shape;
    if (s.k === "tuple" || s.k === "arr") return boolLit(false);
    if (s.k === "prim" && s.type === "string") return boolLit(false);
    if (s.k === "brand" && (s.name === "String" || s.name === "Array")) return boolLit(false);
  }
  // defineProperty(enumerable:false) 侧表
  const flags = getPropFlags(recv);
  if (flags?.get(key)?.enumerable === false) return boolLit(false);
  if (ownV === true) {
    // 下标在数组/字符串上可枚举
    return boolLit(true);
  }
  return boolPrimB();
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
    const t = s.type;
    return t.charAt(0).toUpperCase() + t.slice(1);
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
        const v = litValue(tag.value);
        if (typeof v === "string") return v;
      }
    }
    if (KNOWN_TAGS.has(s.name) || s.name.endsWith("Error")) {
      return s.name === "Object.prototype" ? "Object" : s.name;
    }
    return undefined;
  }
  if (s.k === "obj") {
    const tag = getSlot(s.slots, "@@toStringTag");
    if (tag) {
      const v = litValue(tag.value);
      if (typeof v === "string") return v;
    }
    return "Object";
  }
  return "Object";
}

/**
 * Object.prototype 方法语义（B-path $invoke 与 Object.prototype.X.call 共用）。
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
      // Object.prototype.isPrototypeOf(普通对象) → true
      if (isObjectProtoBrand(thisVal)) {
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
  });
}

