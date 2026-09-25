/**
 * 访问器（get/set）侧表、in / instanceof / delete 路由。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, unknown, type Confidence } from "../../abs.ts";
import { lit } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import { absFunction, getFnImpl } from "../../abs-fn.ts";
import { joinAbs, isObj, type ObjShape, type Slot, isNullProtoObj, getSlot, canonicalArrayIndex } from "../../objects.ts";
import { isNullishLitAbs } from "../../surface.ts";
import { isMapAbs, isSetAbs, mapSizeAbs, setSizeAbs } from "../../collections.ts";
import {
  evalNamespaceCall, extStateOf, getPropFlags, migrateInvariants,
  isObjectProtoBrand, OBJECT_PROTO_METHOD_NAMES, isSymbolAbs,
  symbolDescriptionAbs, objectProtoBrand, builtinCtorAbs, ctorNameOfRecv,
} from "../../builtins.ts";
import { errorTypeAbs, type MayThrowEffect } from "../may-throw.ts";
import { OBJECT_PROTO_NAMES } from "../member-diag.ts";
import { $call } from "../call.ts";
import { getBClass } from "../class-registry.ts";
import { classNameOfValue, markClassValue } from "../../class-mark.ts";
import { NudoThrow, noBody, undef, throwStrictWrite, writeInPlace, clearStaleTermPred, asAbsVal, isDefinitelyTrue, isDefinitelyFalse, currentExecPhi, $lit, litTruth } from "./state.ts";
import { $typeof, $eq, $ne } from "./ops.ts";

// 访问器侧表
/** 对象字面量访问器侧表（Abs 不可存裸 JS 闭包；键为对象 Abs 身份） */
export const accessorTable = new WeakMap<
  object,
  Map<string, { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs }>
>();

/** 注册对象字面量访问器（transpile 调用；返回原 obj 以便链式包裹） */
export function $objAccessor(
  o: Abs,
  key: string,
  get: ((t: Abs) => Abs) | null,
  set: ((t: Abs, v: Abs) => Abs) | null,
): Abs {
  if (!get && !set) return o;
  let m = accessorTable.get(o);
  if (!m) {
    m = new Map();
    accessorTable.set(o, m);
  }
  const def = m.get(key) ?? {};
  if (get) def.get = get;
  if (set) def.set = set;
  m.set(key, def);
  return o;
}

/** 对象字面量访问器查询（供 $get/$set/$spread/Object.assign 共用） */
export function lookupObjAccessor(
  o: Abs,
  key: string,
): { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs } | undefined {
  return accessorTable.get(o)?.get(key);
}

/** 不可变更新产生新 Abs 时迁移侧表；omitKey=delete 目标键（对象字面量自有访问器随键删除） */
export function migrateAccessors(from: Abs, to: Abs, omitKey?: string): void {
  if (to === from) return;
  const m = accessorTable.get(from);
  if (!m) return;
  if (omitKey === undefined) {
    accessorTable.set(to, m);
    return;
  }
  const copy = new Map(m);
  copy.delete(omitKey);
  if (copy.size === 0) accessorTable.delete(to);
  else accessorTable.set(to, copy);
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
    const acc = getBClass(cur)?.accessors?.[key];
    if (acc) return acc;
    cur = getBClass(cur)?.superName;
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
    const acc = getBClass(cur)?.staticAccessors?.[key];
    if (acc) return acc;
    cur = getBClass(cur)?.superName;
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
// --- in / instanceof / delete（transpile 运算符路由；与 ast-eval 同口径） ---

/**
 * `key in obj`：闭形状精确判定（含 Object.prototype 名、数组下标/length、
 * class 方法/访问器与内建 brand 方法）；prim/nullish 接收者原生抛 TypeError →
 * unknown；抽象键/开形状 → boolean。
 */
export function $in(key: Abs, o: Abs): Abs {
  if (o.shape.k === "sum") {
    return o.shape.members.map((m) => $in(key, m)).reduce((a, b) => joinAbs(a, b));
  }
  // 原生：prim/nullish 接收者抛 TypeError（'a' in 5 → TypeError）
  if (o.shape.k === "prim" || o.shape.k === "never" || isNullishLitAbs(o)) {
    return unknown;
  }
  // null/undefined 键原生抛 TypeError；非字面量键 → boolean 近似
  const kv = key.term?.op === "lit" ? key.term.value : undefined;
  if (kv === null || kv === undefined) {
    return isNullishLitAbs(key) ? unknown : bool();
  }
  if (o.shape.k === "tuple") {
    if (kv === "length") return boolLit(true);
    const idx = canonicalArrayIndex(kv);
    if (idx !== undefined) {
      if (o.shape.holes?.includes(idx)) return boolLit(false);
      return boolLit(idx < o.shape.elements.length);
    }
    return boolLit(false);
  }
  if (o.shape.k === "arr") return bool(); // 抽象数组：索引域未知
  const keyStr =
    typeof kv === "number" ? String(kv) : typeof kv === "string" ? kv : undefined;
  if (keyStr === undefined) return bool(); // symbol 键：抽象
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
    return boolLit(OBJECT_PROTO_NAMES.has(keyStr) || FUNCTION_PROTO_NAMES.has(keyStr));
  }
  // eff：Promise/Generator 原型方法
  if (o.shape.k === "eff") {
    if (o.shape.eff === "promise" && PROMISE_PROTO_NAMES.has(keyStr)) return boolLit(true);
    return boolLit(OBJECT_PROTO_NAMES.has(keyStr));
  }
  // unknown/any：无信息，不得按 Object.prototype 成员误判（Object.create 未建模时
  // "toString" in o 曾折 true）
  if (o.shape.k === "unknown" || o.shape.k === "any") return bool();
  return boolLit(OBJECT_PROTO_NAMES.has(keyStr));
}

/** Function.prototype / 函数自有面常见名 */
export const FUNCTION_PROTO_NAMES = new Set(["call", "apply", "bind", "length", "name", "prototype"]);
export const PROMISE_PROTO_NAMES = new Set(["then", "catch", "finally"]);

/** 内建 brand 原型方法名（$in 精确判定用；不必穷尽，未知名仍回落 false/proto） */
export const BUILTIN_BRAND_METHODS: Record<string, ReadonlySet<string>> = {
  Date: new Set(["getTime", "valueOf", "toISOString", "toString", "getMilliseconds", "getSeconds", "getMinutes", "getHours", "getDate", "getDay", "getMonth", "getFullYear"]),
  RegExp: new Set(["test", "exec", "toString"]),
  Map: new Set(["get", "set", "has", "delete", "clear", "forEach", "keys", "values", "entries"]),
  Set: new Set(["has", "add", "delete", "clear", "forEach", "keys", "values", "entries"]),
  Error: new Set(["toString"]),
  Promise: new Set(["then", "catch", "finally"]),
};

export function brandHasProtoMember(brandName: string, key: string): boolean {
  for (const name of bClassChain(brandName)) {
    const spec = getBClass(name);
    if (spec?.methods?.[key]) return true;
    if (spec?.accessors?.[key]) return true;
    const builtin = BUILTIN_BRAND_METHODS[name];
    if (builtin?.has(key)) return true;
  }
  return false;
}

/** 内建错误层级（Error 为根，registry 无 superName 时回退） */
export const BUILTIN_ERROR_SUPER: Record<string, string> = {
  Error: "",
  RangeError: "Error",
  TypeError: "Error",
  ReferenceError: "Error",
  SyntaxError: "Error",
  URIError: "Error",
  EvalError: "Error",
  AggregateError: "Error",
};

/** B-path 品牌链：registry extends 优先，内建错误层级回退（限深防环） */
export function bClassChain(name: string): string[] {
  const out = [name];
  let cur: string | undefined = name;
  let depth = 0;
  while (cur && depth++ < 32) {
    const spec = getBClass(cur);
    const parent: string | undefined = spec?.superName ?? BUILTIN_ERROR_SUPER[cur];
    if (!parent || out.includes(parent)) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

/** 内建构造器名：对其 exact false / true 可判定；未知用户构造器名 → boolean */
export const BUILTIN_CTOR_NAMES = new Set([
  "Array", "Object", "Function", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "String", "Number", "Boolean",
  "Symbol", "ArrayBuffer", "DataView",
]);

/**
 * `x instanceof Right`（Right 为标识符名）：按左值形状精确判定。
 * nullish 左侧原生抛 TypeError → unknown；未知用户构造器名 → boolean（不得 exact false）。
 */
export function $instanceof(left: Abs, rightName: string, rightVal?: Abs): Abs {
  // null/undefined instanceof X：原生抛 TypeError
  if (isNullishLitAbs(left)) return unknown;
  // 自定义 @@hasInstance：RHS 值带可调用槽则调用并布尔化结果
  // （v instanceof o ≡ o[Symbol.hasInstance](v)）；槽在但不可调用 → 抽象
  if (rightVal) {
    const rv = asAbsVal(rightVal);
    if (rv.shape.k === "obj") {
      const slot = rv.shape.slots["@@hasInstance"];
      if (slot && !slot.optional) {
        // 槽在但不可调用 → 原生 TypeError；保守折抽象 boolean
        if (slot.value.shape.k !== "fn" && getFnImpl(slot.value) === undefined) {
          return bool();
        }
        // 与 $invoke bindThis 同口径：receiver 注入首参（impl 首参是 __this）
        const r = $call(slot.value, [rv, left]);
        const bv = litValue(r);
        // 原生把返回值 ToBoolean（return 0 → false、'yes' → true）
        if (bv !== undefined) return boolLit(Boolean(bv));
        return bool();
      }
    }
  }
  switch (left.shape.k) {
    case "brand":
      // 类值本身是 constructor 函数：instanceof Function/Object 恒 true
      if (classNameOfValue(left as object) !== undefined) {
        return boolLit(rightName === "Function" || rightName === "Object");
      }
      return boolLit(
        rightName === "Object" || bClassChain(left.shape.name).includes(rightName),
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
      if (rightName === "Object") return boolLit(true);
      if (BUILTIN_CTOR_NAMES.has(rightName)) return boolLit(false);
      return bool(); // Object.create(C.prototype)
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
        const pv = litValue(p);
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

/** instanceof 右操作数非标识符（表达式/成员路径）：构造器值未知 → 抽象 boolean */
export function $instanceofNonIdent(_left: Abs): Abs {
  return bool();
}

/** ClassExpression 值：构造器函数形状，不得折成精确 undefined */
export function $classExpr(): Abs {
  return absFunction(["_rest"], {
    body: noBody,
    apply: () => unknown,
  });
}

/**
 * `delete obj[key]` 的结果判定（只读，不写回）。
 * frozen/sealed 或 configurable:false 键 → false；preventExtensions 可删；
 * closed 目标恒 true（其余 non-configurable 形态不建模）；
 * prim/nullish 接收者原生抛 TypeError → unknown。
 */
export function $delRes(o: Abs, _key: Abs): Abs {
  if (o.shape.k === "prim" || o.shape.k === "never" || isNullishLitAbs(o)) {
    return unknown;
  }
  if (o.shape.k === "sum") {
    return o.shape.members.map((m) => $delRes(m, _key)).reduce((a, b) => joinAbs(a, b));
  }
  const st = extStateOf(o);
  const kv = litValue(_key);
  const flags =
    kv !== undefined ? getPropFlags(o)?.get(String(kv)) : undefined;
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
  return bool();
}

/**
 * `delete obj[key]` 的写入（不可变更新）：返回删键后的新容器。
 * 闭对象删自有槽；tuple 规范下标置 undefined（对齐原生空洞读值）；
 * 抽象 arr 元素并入 undefined；无法表达的形态原样返回。
 */
export function $del(o: Abs, key: Abs): Abs {
  const kv = litValue(key);
  if (o.shape.k === "sum") {
    return abs(
      { k: "sum", members: o.shape.members.map((m) => $del(m, key)) },
      undefined,
      undefined,
      "partial",
    );
  }
  const st = extStateOf(o);
  // frozen/sealed：删除 TypeError（strict 硬抛；表达式 delete 走 $delRes 返回 false）
  if (st === "frozen" || st === "sealed") throwStrictWrite();
  if (o.shape.k === "brand") {
    const inner = $del(o.shape.shape, key);
    if (inner === o.shape.shape) return o;
    const next = abs({ k: "brand", name: o.shape.name, shape: inner }, undefined, undefined, o.conf);
    const clsName = classNameOfValue(o as object);
    if (clsName) markClassValue(next as object, clsName);
    return next;
  }
  const keyStr =
    typeof kv === "number" ? String(kv) : typeof kv === "string" ? kv : undefined;
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
    const idx = canonicalArrayIndex(kv);
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
