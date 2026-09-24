/**
 * B 路径运行时：transpile 后的程序在 Node 上执行时，值就是 Abs。
 * 与 AST 解释器语义同构；TypeValue 不再是求值载体。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { bumpBForkBudget } from "../call-budget.ts";
import type { Abs } from "../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, unknown, type Confidence } from "../abs.ts";
import { lit } from "../term.ts";
import { absFunction, getFnImpl } from "../abs-fn.ts";
import {
  beginCollectionFork,
  endCollectionFork,
  popCollectionArm,
  pushCollectionArm,
} from "../collections.ts";
import { add, sub, mul, div, mod, cmp, falseConstraint } from "../arithmetic.ts";
import { typeofAbs, negAbs, notAbs, strictEqAbs, looseEqAbs, isNullishLitAbs, definitelyNotNullishShape, bitandAbs, bitorAbs, bitxorAbs, bitnotAbs, shlAbs, shrAbs, ushrAbs, powAbs, toNumberAbs } from "../surface.ts";
import { joinAbs, objOf, isObj, spread as spreadObj, type ObjShape, type Slot, isNullProtoObj, migrateNullProto, getSlot, canonicalArrayIndex } from "../objects.ts";
import {
  isMapAbs,
  isSetAbs,
  setElementsAbs,
  collectionExactLen,
  mapEntriesAbs,
  mapSizeAbs,
  setSizeAbs,
} from "../collections.ts";
import { shouldWidenArrayLiteral, widenedArrayConf, TUPLE_MATERIALIZE_CAP } from "../containers.ts";
import { registerMatchIter, matchIterElements } from "./match-iter.ts";
import { leqAbs } from "../leq.ts";
import { evalNamespaceCall, extStateOf, getPropFlags, migrateInvariants, regexBrandAbsFrom, evalObjectProtoMethod, objectProtoMethodAbs, isObjectProtoBrand, OBJECT_PROTO_METHOD_NAMES, isSymbolAbs, symbolDescriptionAbs, objectProtoBrand, builtinCtorAbs, ctorNameOfRecv, notePromiseExecutorFork } from "../builtins.ts";
import type { Phi } from "../pred.ts";
import { pTrue, and, predEquals } from "../pred.ts";
import {
  noteUnknownMemberMissing,
  noteObjSlotMissing,
  noteAnyMemberMayThrow,
  noteNullishMemberThrows,
  isNullishAbs,
  anyMemberResult,
  OBJECT_PROTO_NAMES,
} from "./calls.ts";
import { errorTypeAbs, $tryMarkSoft, $tryDigestSoft, $tryReleaseSoft, popMayThrowFrame, orphanMayThrowEffects, recordMayThrow, type MayThrowEffect } from "./may-throw.ts";
import { getBClass } from "./class-registry.ts";
import { classNameOfValue, markClassValue } from "../class-mark.ts";
import { $call } from "./call.ts";
import { NudoThrow, isNudoThrow } from "./nudo-throw.ts";

export { NudoThrow, isNudoThrow };

/** 就地改写 shape/conf：Abs 身份不变（引用语义）；旧 term/pred 不再描述新值，必须清除 */
function writeInPlace(target: Abs, next: Abs): Abs {
  target.shape = next.shape;
  target.conf = next.conf;
  target.term = undefined;
  target.pred = undefined;
  return target;
}

/** 调用方已直接改 shape 时的 term/pred 清理 */
export function clearStaleTermPred(v: Abs): void {
  v.term = undefined;
  v.pred = undefined;
}

/** 当前路径前提 Φ（transpile 后的 fork 会压栈） */
let phi: Phi = pTrue;

export function currentExecPhi(): Phi {
  return phi;
}

export function withExecPhi<T>(p: Phi, body: () => T): T {
  const prev = phi;
  phi = p;
  try {
    return body();
  } finally {
    phi = prev;
  }
}

// --- 运算符重载面（transpile 目标）---

/** 保守 unknown（JSX 等未建模构造的 lowering 目标——文件其余部分保持 B-hosted） */
export function $unknown(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

/** `import.meta` → `{ url: string }`（宿主 URL 非字面量，不假精确） */
export function $importMeta(): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        url: { value: abs({ k: "prim", type: "string" }, undefined, undefined, "path") },
      },
      open: true,
    },
    undefined,
    undefined,
    "path",
  );
}

/** `import(spec)` → Promise&lt;开放模块命名空间&gt;（动态模块图不静态解析） */
export function $dynamicImport(_spec: Abs): Abs {
  const ns = abs(
    { k: "obj", slots: {}, open: true },
    undefined,
    undefined,
    "path",
  );
  return abs({ k: "eff", eff: "promise", inner: ns }, undefined, undefined, "path");
}

export function $add(a: Abs, b: Abs): Abs {
  return add(a, b, phi);
}
export function $sub(a: Abs, b: Abs): Abs {
  return sub(a, b, phi);
}
export function $mul(a: Abs, b: Abs): Abs {
  return mul(a, b, phi);
}
export function $div(a: Abs, b: Abs): Abs {
  return div(a, b, phi);
}
export function $mod(a: Abs, b: Abs): Abs {
  return mod(a, b, phi);
}
export function $bitand(a: Abs, b: Abs): Abs {
  return bitandAbs(a, b);
}
export function $bitor(a: Abs, b: Abs): Abs {
  return bitorAbs(a, b);
}
export function $bitxor(a: Abs, b: Abs): Abs {
  return bitxorAbs(a, b);
}
export function $bitnot(a: Abs): Abs {
  return bitnotAbs(a);
}
export function $shl(a: Abs, b: Abs): Abs {
  return shlAbs(a, b);
}
export function $shr(a: Abs, b: Abs): Abs {
  return shrAbs(a, b);
}
export function $ushr(a: Abs, b: Abs): Abs {
  return ushrAbs(a, b);
}
export function $pow(a: Abs, b: Abs): Abs {
  return powAbs(a, b);
}
// --- 访问器（get/set）运行时 ---

/** 对象字面量访问器侧表（Abs 不可存裸 JS 闭包；键为对象 Abs 身份） */
const accessorTable = new WeakMap<
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
function migrateAccessors(from: Abs, to: Abs, omitKey?: string): void {
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

type ClassAccessor = { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs };

/** 沿继承链找实例 class get/set 访问器 */
function findClassAccessor(
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
function findStaticClassAccessor(
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
function findAccessor(
  o: Abs,
  key: string,
): { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs } | undefined {
  if (o.shape.k === "brand") return findClassAccessor(o.shape.name, key);
  return lookupObjAccessor(o, key);
}

export function $toNumber(a: Abs): Abs {
  return toNumberAbs(a);
}

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
const FUNCTION_PROTO_NAMES = new Set(["call", "apply", "bind", "length", "name", "prototype"]);
const PROMISE_PROTO_NAMES = new Set(["then", "catch", "finally"]);

/** 内建 brand 原型方法名（$in 精确判定用；不必穷尽，未知名仍回落 false/proto） */
const BUILTIN_BRAND_METHODS: Record<string, ReadonlySet<string>> = {
  Date: new Set(["getTime", "valueOf", "toISOString", "toString", "getMilliseconds", "getSeconds", "getMinutes", "getHours", "getDate", "getDay", "getMonth", "getFullYear"]),
  RegExp: new Set(["test", "exec", "toString"]),
  Map: new Set(["get", "set", "has", "delete", "clear", "forEach", "keys", "values", "entries"]),
  Set: new Set(["has", "add", "delete", "clear", "forEach", "keys", "values", "entries"]),
  Error: new Set(["toString"]),
  Promise: new Set(["then", "catch", "finally"]),
};

function brandHasProtoMember(brandName: string, key: string): boolean {
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
const BUILTIN_ERROR_SUPER: Record<string, string> = {
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
function bClassChain(name: string): string[] {
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
const BUILTIN_CTOR_NAMES = new Set([
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
export function $neg(a: Abs): Abs {
  return negAbs(a);
}
export function $typeof(a: Abs): Abs {
  return typeofAbs(a);
}
export function $not(a: Abs): Abs {
  return notAbs(a);
}
export function $eq(a: Abs, b: Abs): Abs {
  const r = strictEqAbs(a, b);
  return r === undefined ? bool() : boolLit(r);
}
export function $ne(a: Abs, b: Abs): Abs {
  const r = strictEqAbs(a, b);
  return r === undefined ? bool() : boolLit(!r);
}
/** `==` / `!=`（C2.3）：双字面量 Abstract Equality，否则回落严格判定 */
export function $eqLoose(a: Abs, b: Abs): Abs {
  const r = looseEqAbs(a, b);
  return r === undefined ? bool() : boolLit(r);
}
export function $neLoose(a: Abs, b: Abs): Abs {
  const r = looseEqAbs(a, b);
  return r === undefined ? bool() : boolLit(!r);
}
export function $lt(a: Abs, b: Abs): Abs {
  return cmp("lt", a, b, phi);
}
export function $le(a: Abs, b: Abs): Abs {
  return cmp("le", a, b, phi);
}
export function $gt(a: Abs, b: Abs): Abs {
  return cmp("gt", a, b, phi);
}
export function $ge(a: Abs, b: Abs): Abs {
  return cmp("ge", a, b, phi);
}
export function $join(a: Abs, b: Abs): Abs {
  return joinAbs(asAbsVal(a), asAbsVal(b));
}

/** apply 型 impl 的占位 body（AbsFnImpl.body 必需；$call 走 apply 不经 body） */
const noBody = { type: "BlockStatement", body: [], directives: [] } as never;

/**
 * transpile 泄漏的 JS 函数值 → 一等 fn Abs。
 * B 路径把函数声明/表达式编译成真实 JS 函数；它们流进对象槽、
 * 元组、join 等 Abs 结构时不能裸存——下游（bridge/leq/join）读 `.shape`。
 * 参数名无法从运行时函数恢复（用 fn.length → argN，与 analyzer 的
 * extractParamNames 回退口径一致）；带真实参数名走 $fnVal（transpile 侧）。
 */
export function asAbsVal(v: unknown): Abs {
  if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
  if (typeof v === "function") {
    const n = Math.max(0, v.length);
    const params = Array.from({ length: n }, (_, i) => `arg${i}`);
    return absFunction(params, {
      body: noBody,
      // 与 $fnVal / $callNamed 同边界：callee 的 NudoReturn 不得冒泡成 caller
      apply: (args) => callAtFunctionBoundary(() => (v as (...a: Abs[]) => Abs)(...args)),
    });
  }
  return $lit(v as never);
}

/**
 * 函数调用边界：callee 的 loop/early-return 不得冒泡成 caller 结果。
 * 每个 B 路径调用帧独立 ALS；NudoReturn 收成该调用的返回值。
 */
export function callAtFunctionBoundary<T>(body: () => T): T {
  return runWithLoopExits(() => {
    try {
      return body();
    } catch (e) {
      if (isNudoReturn(e)) return e.absValue as unknown as T;
      throw e;
    }
  });
}

/** 函数表达式 → 一等 fn Abs（transpile 侧带真实参数名；异步 body 包 $async）
 *  opts.bindThis：对象方法——$invoke 会把 receiver 作为 impl 首参注入。 */
export function $fnVal(
  params: string[],
  impl: (...args: Abs[]) => Abs,
  opts?: { bindThis?: boolean },
): Abs {
  return absFunction(params, {
    body: noBody,
    // bindThis（对象方法）：receiver 走首参注入，无宿主 this；
    // 非方法 fn：宿主 this 传递（call/apply/bind 的 thisArg 经 $rawThis 进入函数体）
    apply: opts?.bindThis
      ? (args) => callAtFunctionBoundary(() => impl(...args))
      : (args, thisVal) => callAtFunctionBoundary(() => impl.apply(thisVal as never, args)),
    ...(opts?.bindThis ? { bindThis: true } : {}),
  });
}

/**
 * 宿主 this → Abs：函数体 prologue 用它承接 call/apply/bind 传入的 thisArg。
 * Abs 原样返回；宿主 undefined（普通调用/call 缺 thisArg）→ $lit(undefined)。
 * B 路径产物是 new Function 拼接（sloppy），裸调用的宿主 this 泄漏为
 * globalThis——归一到 $lit(undefined)（strict 模块语义下的 this）。
 */
export function $rawThis(v: unknown): Abs {
  if (v === undefined || v === globalThis) return $lit(undefined);
  if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
  return $lit(v as never);
}

/**
 * strict 模块语义下写不可变目标（frozen/sealed 新键/nonext 新键/
 * writable:false/getter-only/non-configurable 删）→ hard TypeError。
 * 抛 NudoThrow 由 catch 转译吸收为 TypeError 绑定；无 catch 时函数中断
 * （never + throws），callTranspiledExportFull 上报 L2 entry-may-throw。
 */
function throwStrictWrite(): never {
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

/** 字面量 → Abs（transpile 侧数字/字符串/布尔/null/undefined） */
export function $lit(v: unknown): Abs {
  if (v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object)) {
    return v as Abs;
  }
  return litAbsFromJs(v);
}

function litAbsFromJs(v: unknown): Abs {
  if (v === null || v === undefined) {
    return abs({ k: "unknown" }, { op: "lit", value: v as never }, pTrue, "exact");
  }
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean" || t === "bigint") {
    return abs(
      { k: "prim", type: t as "number" | "string" | "boolean" | "bigint" },
      { op: "lit", value: v as never },
      pTrue,
      "exact",
    );
  }
  return unknown;
}

/** JS 真值：字面量按 Boolean(v)；对象形恒真；不可判 → undefined */
export function litTruth(a: Abs): boolean | undefined {
  if (a.term?.op === "lit") {
    // lit(undefined) 与「无 lit」都经 litValue 折叠成 undefined，须先看 term
    return Boolean(a.term.value);
  }
  switch (a.shape.k) {
    case "obj":
    case "arr":
    case "tuple":
    case "fn":
    case "brand":
    case "eff":
      return true;
    case "prim":
      return a.shape.type === "symbol" || a.shape.type === "bigint" ? true : undefined;
    case "never":
      return false;
    default:
      return undefined;
  }
}

export function isDefinitelyTrue(a: Abs): boolean {
  return litTruth(a) === true;
}

export function isDefinitelyFalse(a: Abs): boolean {
  const t = litTruth(a);
  if (t === false) return true;
  if (a.shape.k === "never") return true;
  return false;
}

function undef(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined as never }, pTrue, "exact");
}

/**
 * if：两侧都探索（抽象条件），具体条件短路。
 * 循环/函数体内 early-return：抽象分支把 NudoReturn 记入 loop-exit
 * 侧信道并让另一侧继续，避免只保留「先跑完的那一侧」而低估结果域。
 * throw 同理：记录 throw-exit，兄弟臂继续探索（P0-4）。
 */
const loopExitsAls = new AsyncLocalStorage<Abs[]>();
const throwExitsAls = new AsyncLocalStorage<Abs[]>();
const tryMarksAls = new AsyncLocalStorage<number[]>();
/** 每个 try 是否仍有未消化的 soft may-throw 帧（digest/release 幂等） */
const softFrameActiveAls = new AsyncLocalStorage<boolean[]>();

/** 函数求值作用域：收集抽象分支上的 early-return / throw 值；try 标记栈同边界 */
export function runWithLoopExits<T>(body: () => T): T {
  return loopExitsAls.run([], () =>
    throwExitsAls.run([], () =>
      tryMarksAls.run([], () => softFrameActiveAls.run([], body)),
    ),
  );
}

export function takeLoopExits(): Abs[] {
  return loopExitsAls.getStore() ?? [];
}

export function takeThrowExits(): Abs[] {
  return throwExitsAls.getStore() ?? [];
}

export function pushLoopExit(v: Abs): void {
  loopExitsAls.getStore()?.push(v);
}

export function pushThrowExit(v: Abs): void {
  throwExitsAls.getStore()?.push(v);
}

/** transpile 生成代码用：`$pushLoopExit` */
export function $pushLoopExit(v: Abs): void {
  pushLoopExit(v);
}

/** try 块开始：压栈 hard/soft 标记 */
export function $tryMark(): number {
  $tryMarkSoft();
  softFrameActiveAls.getStore()?.push(true);
  const store = throwExitsAls.getStore();
  const m = store?.length ?? 0;
  tryMarksAls.getStore()?.push(m);
  return m;
}

/** 当前最内层 try 的 mark（return 时 drain 用；嵌套调用不串栈） */
export function $tryCurrentMark(): number {
  const stack = tryMarksAls.getStore();
  return stack && stack.length > 0 ? stack[stack.length - 1]! : 0;
}

export function $tryPopMark(): void {
  tryMarksAls.getStore()?.pop();
  const soft = softFrameActiveAls.getStore();
  if (soft && soft.length > 0) {
    if (soft[soft.length - 1]) $tryReleaseSoftOut();
    soft.pop();
  }
}

/** 取出 mark 之后新记录的 throw（try 吸收 / catch 合并） */
export function $tryTakeSince(mark: number): Abs[] {
  const store = throwExitsAls.getStore();
  if (!store) return [];
  return store.splice(Math.min(mark, store.length));
}

/** catch 入口消化 try 内 soft may-throw（幂等；design §3.3） */
export function $tryDigestSoftCatch(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryDigestSoft();
  soft[soft.length - 1] = false;
}

/**
 * 正常完成路径 + catch 可能 rethrow：soft 效果不得消化——假想 soft throw
 * 经 catch rethrow 逃逸（try { u.name } catch (e) { throw e; } 的 L2）。
 * 摘帧上浮（collector / 外层 try 帧可再消化），并清 soft 标记防二次释放。
 */
export function $tryReleaseSoftCatch(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryReleaseSoft();
  soft[soft.length - 1] = false;
}

/**
 * catch 入口摘下 soft 效果（不消化）。catch 正常落出口再 discard；
 * catch rethrow 时 orphan 上浮（外层 try 可再消化）。
 */
export function $tryDetachSoftCatch(): MayThrowEffect[] {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return [];
  const effects = popMayThrowFrame(false);
  soft[soft.length - 1] = false;
  return effects;
}

/** catch 无 rethrow 落出口：丢弃已摘下的 soft（design：catch 消化） */
export function $tryDiscardSoft(_effects: MayThrowEffect[]): void {
  /* digest */
}

/** catch rethrow：摘下的 soft 上浮（嵌套 try 归外层帧） */
export function $tryOrphanSoft(effects: MayThrowEffect[]): void {
  orphanMayThrowEffects(effects);
}

/** 无 handler / 出口：上浮未消化 soft may-throw（幂等） */
export function $tryReleaseSoftOut(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryReleaseSoft();
  soft[soft.length - 1] = false;
}

type ForkArm =
  | { kind: "val"; v: Abs }
  | { kind: "ret"; v: Abs }
  | { kind: "throw"; v: Abs };

/** 生成器 yield 收集：抽象分支时标记路径敏感，禁止 exact 元组出货 */
let yieldStack: Abs[][] = [];
let genPathSensitive = 0;
let genJoinOverride: Abs | null = null;

function withIsolatedYields<T>(fn: () => T): { v: T; ys: Abs[] | null } {
  const top = yieldStack[yieldStack.length - 1];
  // 无收集器：不换槽、不建 armYs（fork 热路径常态）
  if (!top) return { v: fn(), ys: null };
  const armYs: Abs[] = [];
  yieldStack[yieldStack.length - 1] = armYs;
  try {
    return { v: fn(), ys: armYs };
  } finally {
    yieldStack[yieldStack.length - 1] = top;
  }
}

function mergeArmYields(armYsList: Array<Abs[] | null>): void {
  const top = yieldStack[yieldStack.length - 1];
  if (!top || armYsList.length === 0) return;
  const concrete = armYsList.filter((x): x is Abs[] => x !== null);
  if (concrete.length === 0) return;
  if (concrete.length === 1) {
    top.push(...concrete[0]!);
    return;
  }
  // 多臂：join 各臂 yield 序列，并标记路径敏感
  let joined: Abs | null = null;
  for (const ys of concrete) {
    joined = joined ? joinAbs(joined, $arr(ys)) : $arr(ys);
  }
  genPathSensitive++;
  if (joined) genJoinOverride = joined;
  // 父收集器仍并入全部臂元素（过近似），conf 由 genJoinOverride/path 敏感性压低
  for (const ys of concrete) top.push(...ys);
}

function runForkArm(arm: () => Abs, exits: Abs[] | undefined): ForkArm {
  try {
    return { kind: "val", v: asAbsVal(arm()) };
  } catch (e) {
    if (isNudoReturn(e)) {
      exits?.push(e.absValue);
      return { kind: "ret", v: e.absValue };
    }
    if (isNudoThrow(e)) {
      pushThrowExit(e.absValue);
      return { kind: "throw", v: e.absValue };
    }
    throw e;
  }
}

function settleForkArms(a: ForkArm, b: ForkArm, exits: Abs[] | undefined): Abs {
  // 避开 filter 数组分配：两臂直判
  const aThrow = a.kind === "throw";
  const bThrow = b.kind === "throw";
  if (aThrow && bThrow) {
    // 全 throw：兄弟臂已探索完，再抛 join（调用边界收成 throws）
    throw new NudoThrow(joinAbs(a.v, b.v));
  }
  // 混合 throw + val/ret：throws 已在 throwExits；继续处理非 throw 臂
  const first = aThrow ? b : a;
  const second = aThrow ? a : b;
  if (first.kind === "ret" && second.kind === "ret") {
    throw new NudoReturn(joinAbs(first.v, second.v));
  }
  if (aThrow !== bThrow) {
    // 恰一臂 throw：只携带非 throw 臂
    if (first.kind === "ret") {
      if (!exits) throw new NudoReturn(first.v);
      return undef();
    }
    return first.v;
  }
  if (first.kind === "ret") {
    if (!exits) throw new NudoReturn(first.v);
    return second.kind === "val" ? second.v : undef();
  }
  if (second.kind === "ret") {
    if (!exits) throw new NudoReturn(second.v);
    return first.v;
  }
  return joinAbs(first.v, second.v);
}

/** Φ 规模上限：递归×循环下 Φ 逐层 and 累积（每层 term 不同 → 去重失效）→
 *  cmp 的 implies(Φ,pred) 在巨大 Φ 上爆炸（real-packages lodash _baseFlatten
 *  实测 50+ 项 → 60s+ 卡死；main 无 Φ-native 时 31ms）。超限丢弃新增项
 *  （保留原 Φ）——剪枝更少 = 更保守，安全。 */
const PHI_MAX_NODES = 24;
/** 单 pred 追加进 and 链：避开 and() 全量 flatten 的 O(n²) 去重。 */
function boundedPhi(p: Phi, q: Phi): Phi {
  if (q.op === "true") return p;
  if (p.op === "true") return q.op === "and" && q.args.length > PHI_MAX_NODES ? p : q;
  if (q.op !== "and") {
    if (p.op === "and") {
      if (p.args.length > PHI_MAX_NODES) return p;
      for (let i = 0; i < p.args.length; i++) {
        if (predEquals(p.args[i]!, q)) return p;
      }
      const args = p.args.slice();
      args.push(q);
      return { op: "and", args };
    }
    return predEquals(p, q) ? p : { op: "and", args: [p, q] };
  }
  const r = and(p, q);
  if (r.op !== "and") return r;
  return r.args.length > PHI_MAX_NODES ? p : r;
}

export function $fork(test: Abs, consequent: () => Abs, alternate?: () => Abs): Abs {
  // Promise executor 内分叉：各臂 resolve 需 join（见 evalPromiseCtor）
  notePromiseExecutorFork();
  // 缺参/宿主裸值：先收成 Abs，否则 litTruth 读 .shape 炸掉、被 executor catch 成 unknown
  const testAbs = asAbsVal(test);
  // 分支展开上限（递归×循环爆炸阀）：超限放弃分支 = unknown（最保守）。
  // 截断已由 bumpBForkBudget → noteBForkTruncation 上报（nudo:fork-truncated）
  if (!bumpBForkBudget()) return unknown;
  // Φ-native：测试判定已由 cmp 消费 currentExecPhi（$gt 等传模块级 phi）；
  // 此处把 Φ∧test（真臂）/ Φ∧¬test（假臂）压进臂作用域——嵌套/兄弟分支的
  // 路径事实沿臂累积（外层已证 x>y ⇒ 内层同测试折叠）。
  // 单次 litTruth：isDefinitelyTrue/False 各算一遍是纯浪费。
  const truth = litTruth(testAbs);
  const p = currentExecPhi();
  const tCons = testAbs.pred;
  if (truth === true) {
    return asAbsVal(withExecPhi(tCons ? boundedPhi(p, tCons) : p, consequent));
  }
  if (truth === false || testAbs.shape.k === "never") {
    if (!alternate) return undef();
    const tNeg = falseConstraint(testAbs);
    return asAbsVal(withExecPhi(tNeg ? boundedPhi(p, tNeg) : p, alternate));
  }
  const phiTrue = tCons ? boundedPhi(p, tCons) : p;
  // 假臂 Φ 惰性：隐式 else 不跑 body，用不到 ¬test
  let phiFalse: Phi | undefined;
  const falsePhi = (): Phi => {
    if (phiFalse === undefined) {
      const tNeg = falseConstraint(testAbs);
      phiFalse = tNeg ? boundedPhi(p, tNeg) : p;
    }
    return phiFalse;
  };

  const exits = loopExitsAls.getStore();
  // 集合 side-table：抽象分支各自 overlay，结束后 join（防身份污染）
  // overlay 本身惰性分配——无 Map/Set 写入时零堆分配
  beginCollectionFork();
  const arms: Array<ReturnType<typeof popCollectionArm>> = [];
  const armYsList: Array<Abs[] | null> = [];
  let a: ForkArm;
  let b: ForkArm;
  try {
    pushCollectionArm();
    try {
      const r = withExecPhi(phiTrue, () =>
        withIsolatedYields(() => runForkArm(consequent, exits)),
      );
      a = r.v;
      armYsList.push(r.ys);
    } finally {
      arms.push(popCollectionArm());
    }
    if (alternate) {
      pushCollectionArm();
      try {
        const r = withExecPhi(falsePhi(), () =>
          withIsolatedYields(() => runForkArm(alternate, exits)),
        );
        b = r.v;
        armYsList.push(r.ys);
      } finally {
        arms.push(popCollectionArm());
      }
    } else {
      // 隐式 else：无写也必须占一臂，否则条件写入会被 merge 成必然（P0）
      pushCollectionArm();
      try {
        b = { kind: "val", v: undef() };
        armYsList.push(null);
      } finally {
        arms.push(popCollectionArm());
      }
    }
  } finally {
    endCollectionFork(arms);
    if (yieldStack.length > 0) mergeArmYields(armYsList);
  }

  return settleForkArms(a, b, exits);
}

export const DEFAULT_MAX_LOOP_ITERS = 8;

/**
 * for 的惰性展开：生成器只负责「按上限吐状态」。
 * 抽象条件无法诚实终止——消费者必须自带 maxIters。
 */
export function* $forIter(
  init: Abs,
  test: (s: Abs) => Abs,
  step: (s: Abs) => Abs,
  body: (s: Abs) => Abs,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
): Generator<{ state: Abs; test: Abs; afterBody: Abs }, void, void> {
  let s = init;
  for (let i = 0; i < maxIters; i++) {
    const t = test(s);
    if (isDefinitelyFalse(t)) {
      yield { state: s, test: t, afterBody: s };
      return;
    }
    let afterBody: Abs = s;
    let broke = false;
    try {
      afterBody = body(s);
    } catch (e) {
      if (isNudoBreak(e)) broke = true;
      else if (isNudoContinue(e)) afterBody = s; // 体提前结束
      else throw e;
    }
    yield { state: s, test: t, afterBody };
    if (broke) return;
    s = step(afterBody);
  }
}

/**
 * 有界 for：unroll ≤ maxIters，每步「可能退出」的态 join；
 * 相邻态 leq 视为不动点提前停。
 */
export function $for(
  init: Abs,
  test: (s: Abs) => Abs,
  step: (s: Abs) => Abs,
  body: (s: Abs) => Abs,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
  opts?: {
    pack?: () => Abs;
    unpack?: (s: Abs) => void;
    /** 标签循环（`outer: for …`）：仅吸收同标签 break/continue 信号 */
    label?: string;
  },
): Abs {
  let state = init;
  let exitJoin: Abs | undefined;
  let extJoin: Abs | undefined;
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  const snapCounter = (): void => {
    exitJoin = exitJoin ? joinAbs(exitJoin, state) : state;
  };
  const snapExt = (): void => {
    if (!pack) return;
    const p = pack();
    extJoin = extJoin ? joinAbs(extJoin, p) : p;
  };
  const applyExtJoin = (): void => {
    if (!extJoin || !pack || !unpack) return;
    unpack(joinAbs(extJoin, pack()));
  };

  for (let i = 0; i < maxIters; i++) {
    const t = test(state);
    if (isDefinitelyFalse(t)) {
      snapCounter();
      snapExt();
      applyExtJoin();
      return exitJoin ?? state;
    }

    const abstractTest = !isDefinitelyTrue(t);
    if (abstractTest) {
      snapCounter();
      snapExt();
    }

    let afterBody: Abs;
    try {
      afterBody = body(state);
    } catch (e) {
      // break 吸收 → 本轮为最终态后退出；continue 吸收 → 体提前完成，
      // 用 pack 收集已发生的绑定写（continue 前语句的副作用保留）
      if (isNudoBreak(e, opts?.label)) {
        snapCounter();
        snapExt();
        applyExtJoin();
        return exitJoin ?? state;
      }
      if (isNudoContinue(e, opts?.label)) {
        // 体未走完 return；循环变量已发生的写无法从调用点闭包读取
        // （init 以字面量入参，JS 作用域无该绑定）——以 state 近似
        afterBody = state;
      } else if (isNudoReturn(e) || isNudoThrow(e)) {
        throw e;
      } else {
        throw e;
      }
    }
    const next = step(afterBody);
    // 抽象条件：本轮 body 完成后的绑定也是合法出口（下一轮 test 可能为假）
    if (abstractTest) {
      state = afterBody;
      snapExt();
    }

    if (i > 0) {
      const nv = litValue(next);
      const sv = litValue(state);
      const stuck =
        (nv !== undefined && sv !== undefined && nv === sv) ||
        (nv === undefined && sv === undefined && leqAbs(next, state).ok);
      if (stuck) {
        state = next;
        snapCounter();
        snapExt();
        applyExtJoin();
        return exitJoin ?? next;
      }
    }
    state = next;
  }

  snapCounter();
  snapExt();
  applyExtJoin();
  return exitJoin ?? state;
}

// --- 数组 ---

/** 容器策略单点（containers.ts）：≤cap → tuple；>cap → arr（元素 join，path） */
function tupleOrWiden(els: Abs[], conf: Confidence): Abs {
  if (shouldWidenArrayLiteral(els.length)) {
    return abs(
      { k: "arr", element: els.reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      widenedArrayConf(),
    );
  }
  return abs({ k: "tuple", elements: els }, undefined, undefined, conf);
}

/** 数组字面量 → ≤cap tuple（逐元素精确）/ >cap arr；策略与 ast-eval 同源（containers.ts） */
export function $arr(items: Abs[]): Abs {
  return tupleOrWiden(items.map(asAbsVal), "exact");
}

/**
 * `arguments` 对象 → 类数组 tuple（$len/$idx 投影 length/下标；typeof 为 "object"）。
 * strict/ESM 与形参**独立映射**：写 `arguments[i]` 不改形参，写形参不改 `arguments`。
 * （sloppy 非严格是 mapped arguments object，二者互相写回——Nudo 分析按 ESM/strict。）
 * 与 rest 绑定解耦：rest 仍从真实 `arguments`/rest 形参收集，本对象只服务用户写的 `arguments`。
 */
export function $arguments(items: ArrayLike<unknown>): Abs {
  const n = typeof items?.length === "number" && items.length > 0 ? items.length : 0;
  const els: Abs[] = new Array(n);
  for (let i = 0; i < n; i++) els[i] = asAbsVal((items as ArrayLike<unknown>)[i]);
  return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
}

/**
 * 带空洞的数组字面量（[1,,3]）：hole 槽位置为 undefined 值但 `in` 判定 false。
 * 超 cap 退化 arr 时丢弃 hole 精度（元素 join，长度语义已由 arr 承接）。
 */
export function $arrWithHoles(items: Abs[], holes: number[]): Abs {
  const base = $arr(items);
  if (holes.length === 0 || base.shape.k !== "tuple") return base;
  return abs({ k: "tuple", elements: base.shape.elements, holes }, undefined, undefined, base.conf);
}

const ARR_MUTATORS = new Set([
  "push",
  "unshift",
  "pop",
  "shift",
  "splice",
  "reverse",
  "sort",
  "copyWithin",
  "fill",
]);

export function isArrMutator(name: string): boolean {
  return ARR_MUTATORS.has(name);
}

/**
 * C1.4 语句重绑：返回**变更后容器** Abs（不是 JS 返回值）。
 * `a.pop()` 语句应把 `a` 绑成去掉末元的 tuple，而不是被移除的元素。
 */
/** ToIntegerOrInfinity（±Infinity 保持）；返回：数字=可折叠 / null=实参不可判定 / undefined=缺省或显式 undefined（取默认值） */
function toIOI(v: Abs | undefined): number | null | undefined {
  if (v === undefined) return undefined; // 实参缺省（数组越界）
  const lv = litValue(v);
  if (lv === undefined) {
    // 显式 undefined 字面量 → 按缺省（copyWithin/fill 规范：undefined end 取 len）
    return v.term?.op === "lit" ? undefined : null;
  }
  if (lv === null) return 0;
  if (typeof lv === "number") {
    if (Number.isNaN(lv)) return 0;
    return Math.trunc(lv);
  }
  if (typeof lv === "string" || typeof lv === "boolean") {
    return Math.trunc(Number(lv));
  }
  return null; // bigint/symbol/抽象 → 不可判定
}

/** 规范窗口（len 相对化 + clamp）；target≥len 或空窗 → null（no-op） */
function clampWindow(
  len: number,
  target: number,
  start: number,
  end: number,
): { t: number; s: number; e: number } | null {
  const t = target < 0 ? Math.max(len + target, 0) : Math.min(target, len);
  const s = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
  const e = end < 0 ? Math.max(len + end, 0) : Math.min(end, len);
  if (t >= len || s >= len) return null;
  const count = Math.min(e - s, len - t);
  if (count <= 0) return null;
  return { t, s, e: s + count };
}

function copyWithinTuple(
  shape: { k: "tuple"; elements: Abs[]; holes?: number[] } | { k: "arr"; element: Abs },
  vals: Abs[],
): Abs {
  const t = toIOI(vals[0]);
  const s = toIOI(vals[1]);
  const e = toIOI(vals[2]);
  if (shape.k === "tuple") {
    if (t === null || s === null || e === null) {
      // 不可判定边界：任一槽可能被写 → 元素 join 回退（sound）
      const joined = shape.elements.length
        ? shape.elements.reduce((x, y) => joinAbs(x, y))
        : unknown;
      return abs({ k: "arr", element: joined }, undefined, undefined, "partial");
    }
    const len = shape.elements.length;
    const win = clampWindow(len, t ?? 0, s ?? 0, e ?? len);
    const origHoles = shape.holes ?? [];
    if (win) {
      const els = [...shape.elements];
      const holesSet = new Set(origHoles);
      // 重叠且源在目标之后（s < t）：按规范倒序复制
      const backwards = (s ?? 0) < (t ?? 0) && win.s + (win.e - win.s) > win.t;
      const count = win.e - win.s;
      // 源存在性按**原始** holes 快照判定（集合在循环中会变）
      for (let kk = 0; kk < count; kk++) {
        const k = backwards ? count - 1 - kk : kk;
        const from = win.s + k;
        const to = win.t + k;
        const present = from < len && !origHoles.includes(from);
        if (present) {
          els[to] = els[from]!;
          holesSet.delete(to);
        } else {
          // 源 hole/越界：删除目标槽（ES2023 DeletePropertyOrThrow）
          els[to] = $lit(undefined);
          holesSet.add(to);
        }
      }
      const holes = [...holesSet];
      return abs(
        { k: "tuple", elements: els, holes: holes.length > 0 ? holes : undefined },
        undefined,
        undefined,
        "path",
      );
    }
    // 合法边界但 no-op（如 target≥len）：保持 tuple 与 holes
    return abs(
      {
        k: "tuple",
        elements: [...shape.elements],
        holes: origHoles.length > 0 ? [...origHoles] : undefined,
      },
      undefined,
      undefined,
      "path",
    );
  }
  // 抽象 arr：copyWithin 保持元素类型（sound）
  return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
}

export function fillTuple(
  shape: { k: "tuple"; elements: Abs[]; holes?: number[] } | { k: "arr"; element: Abs },
  vals: Abs[],
  arr: Abs,
): Abs {
  const v = vals[0] ?? unknown;
  const s = toIOI(vals[1]);
  const e = toIOI(vals[2]);
  if (shape.k === "tuple") {
    const len = shape.elements.length;
    if (s === null || e === null) {
      // 不可判定边界：任一槽可能被写 → 元素 join 回退；hole 可能被写实，
      // 保守清空 holes（`in` 不得折 false 而原生已写实）
      return abs(
        { k: "tuple", elements: shape.elements.map((el) => joinAbs(el, v)) },
        undefined,
        undefined,
        "partial",
      );
    }
    const start = Math.max(Math.min((s ?? 0) < 0 ? len + (s ?? 0) : (s ?? 0), len), 0);
    const end = Math.max(Math.min((e ?? len) < 0 ? len + (e ?? len) : (e ?? len), len), 0);
    const holes = (shape.holes ?? []).filter((h) => h < start || h >= end);
    if (end <= start) {
      return abs(
        { k: "tuple", elements: [...shape.elements], holes: holes.length > 0 ? holes : undefined },
        undefined,
        undefined,
        "path",
      );
    }
    const els = shape.elements.map((el, i) => (i >= start && i < end ? v : el));
    return abs(
      { k: "tuple", elements: els, holes: holes.length > 0 ? holes : undefined },
      undefined,
      undefined,
      "path",
    );
  }
  return abs(
    { k: "arr", element: joinAbs(shape.element, v) },
    undefined,
    undefined,
    confJoin(arr.conf, "path"),
  );
}

/**
 * 深拷贝可变容器（fork/switch 快照与循环 pack 用）。
 * 容器写就地进行后（引用语义），分析分支/迭代的状态分离必须靠拷贝——
 * 浅引用快照会让臂间/迭代间互相污染。
 */
export function $copy(a: Abs): Abs {
  const s = a.shape;
  // 所有可能挂 extState/propFlags 的形状都必须迁移不变性侧表：
  // fork/switch 用 $copy 做快照，副本丢失 frozen/sealed 会让臂内写不再硬抛
  if (s.k === "tuple") {
    const next = abs(
      {
        k: "tuple",
        elements: s.elements.map($copy),
        holes: s.holes ? [...s.holes] : undefined,
      },
      a.term,
      a.pred,
      a.conf,
    );
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "arr") {
    const next = abs({ k: "arr", element: $copy(s.element) }, a.term, a.pred, a.conf);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "obj") {
    const slots: Record<string, Slot> = {};
    for (const [k, v] of Object.entries(s.slots)) {
      slots[k] = { ...v, value: $copy(v.value) };
    }
    const next = objOf(slots, {
      index: s.index ? { key: $copy(s.index.key), value: $copy(s.index.value) } : undefined,
      open: s.open,
    });
    next.conf = a.conf;
    migrateAccessors(a, next);
    migrateInvariants(a, next);
    migrateNullProto(a, next);
    return next;
  }
  if (s.k === "brand") {
    const inner = $copy(s.shape);
    const next = abs({ k: "brand", name: s.name, shape: inner }, a.term, a.pred, a.conf);
    const clsName = classNameOfValue(a as object);
    if (clsName) markClassValue(next as object, clsName);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "eff") {
    const next = abs({ k: "eff", eff: s.eff, inner: $copy(s.inner) }, a.term, a.pred, a.conf);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "sum") {
    return abs({ k: "sum", members: s.members.map($copy) }, a.term, a.pred, a.conf);
  }
  return a;
}

/** 数组/元组方法（push/pop/shift/unshift/splice/reverse/sort/copyWithin/fill）
 *  的就地 mutator：Abs 身份不变（JS 引用语义——`const b = a; b.push(4)` 对 a
 *  可见）；transpile 重绑 `a = $arrMutContainer(a, …)` 仍写回同一对象。 */
export function $arrMutContainer(arr: Abs, method: string, args: Abs[]): Abs {
  const shape = arr.shape;
  if (shape.k !== "tuple" && shape.k !== "arr") return arr;
  const st = extStateOf(arr);
  // frozen：任何 mutator 原生 TypeError（strict 硬抛）；
  // sealed/nonext：结构性扩展（push/unshift/splice 加元素）TypeError
  if (st === "frozen") throwStrictWrite();
  if (
    (st === "sealed" || st === "nonext") &&
    (method === "push" || method === "unshift" || method === "splice")
  ) {
    throwStrictWrite();
  }
  const vals = args.map((a) => asAbsVal(a));
  const asArrEl = (els: Abs[]): Abs =>
    els.length > 0 ? els.reduce((x, y) => joinAbs(x, y)) : unknown;
  // 就地写回：shape/conf 替换但 Abs 身份不变 → 别名（const b=a / 实参）同步；
  // 旧 term/pred 不再描述新 shape，一并清除
  const writeBack = (next: Abs): Abs => writeInPlace(arr, next);

  if (method === "push" || method === "unshift") {
    if (shape.k === "tuple") {
      const els =
        method === "push"
          ? [...shape.elements, ...vals]
          : [...vals, ...shape.elements];
      // holes 迁移：push 原下标不变；unshift 整体右移 vals.length
      const holes = shape.holes
        ? shape.holes.map((h) => (method === "push" ? h : h + vals.length))
        : undefined;
      const conf = vals.reduce(
        (acc, v) => confJoin(acc, v.conf),
        arr.conf as Confidence,
      );
      return writeBack(
        abs({ k: "tuple", elements: els, holes }, undefined, undefined, conf),
      );
    }
    const el = vals.reduce((acc, v) => joinAbs(acc, v), shape.element);
    return writeBack(
      abs({ k: "arr", element: el }, undefined, undefined, confJoin(arr.conf, "path")),
    );
  }
  if (method === "pop") {
    if (shape.k === "tuple") {
      if (shape.elements.length === 0) return arr;
      const newLen = shape.elements.length - 1;
      // 弹出末槽：holes 截断到新长度（末位是 hole 则随之消失）
      const holes = shape.holes
        ? shape.holes.filter((h) => h < newLen)
        : undefined;
      return writeBack(
        abs(
          { k: "tuple", elements: shape.elements.slice(0, -1), holes: holes && holes.length > 0 ? holes : undefined },
          undefined,
          undefined,
          arr.conf,
        ),
      );
    }
    return arr;
  }
  if (method === "shift") {
    if (shape.k === "tuple") {
      if (shape.elements.length === 0) return arr;
      // 移除首槽：holes 整体左移 1（0 号 hole 随之消失）
      const holes = shape.holes
        ? shape.holes.map((h) => h - 1).filter((h) => h >= 0)
        : undefined;
      return writeBack(
        abs(
          { k: "tuple", elements: shape.elements.slice(1), holes: holes && holes.length > 0 ? holes : undefined },
          undefined,
          undefined,
          arr.conf,
        ),
      );
    }
    return arr;
  }
  if (method === "splice") {
    if (shape.k === "tuple") {
      return writeBack(
        abs(
          { k: "arr", element: asArrEl(shape.elements) },
          undefined,
          undefined,
          confJoin(arr.conf, "path"),
        ),
      );
    }
    return arr;
  }
  if (method === "reverse") {
    if (shape.k === "tuple") {
      // holes 随元素镜像翻转：新下标 = len - 1 - 原下标
      const len = shape.elements.length;
      const holes = shape.holes
        ? shape.holes.map((h) => len - 1 - h)
        : undefined;
      return writeBack(
        abs(
          { k: "tuple", elements: [...shape.elements].reverse(), holes },
          undefined,
          undefined,
          arr.conf,
        ),
      );
    }
    return arr;
  }
  if (method === "copyWithin") {
    return writeBack(copyWithinTuple(shape, vals));
  }
  if (method === "fill") {
    return writeBack(fillTuple(shape, vals, arr));
  }
  if (method === "sort") {
    // 顺序未建模：位次不可信，tuple 降为 arr（元素 join），避免 a[0] 假精确
    if (shape.k === "tuple") {
      return writeBack(
        abs(
          { k: "arr", element: asArrEl(shape.elements) },
          undefined,
          undefined,
          confJoin(arr.conf, "path"),
        ),
      );
    }
    return arr;
  }
  return arr;
}

/** 下标读 a[i]；字面量 i 走 tuple 精确投影，否则并所有元素；string[i] → 单字符 */
export function $idx(a: Abs, i: Abs): Abs {
  // any 下标：无约束读（any ≠ unknown）
  if (a?.shape?.k === "any") return anyMemberResult();
  const iv = litValue(i);
  if (a.shape.k === "tuple") {
    const els = a.shape.elements;
    if (typeof iv === "number" && Number.isInteger(iv)) {
      if (iv >= 0 && iv < els.length) return els[iv]!;
      return undef();
    }
    if (els.length === 0) return undef();
    return els.reduce((x, y) => joinAbs(x, y));
  }
  if (a.shape.k === "arr") return a.shape.element;
  if (a.shape.k === "sum") {
    return a.shape.members.map((m) => $idx(m, i)).reduce((x, y) => joinAbs(x, y));
  }
  // C1.3：对象 + key 投影；闭 shape miss / 未知 key 必须并入 undefined
  if (a.shape.k === "obj" || (a.shape.k === "brand" && a.shape.shape.shape.k === "obj")) {
    const objShape = (a.shape.k === "obj" ? a.shape : a.shape.shape.shape) as ObjShape;
    const slots = Object.values(objShape.slots).map((s) => s.value);
    if (slots.length === 0) return objShape.open ? unknown : undef();
    const joinSlotsWithUndef = (): Abs =>
      joinAbs(slots.reduce((x, y) => joinAbs(x, y)), undef());
    if (typeof iv === "string" || typeof iv === "number" || typeof iv === "boolean") {
      const slot = objShape.slots[String(iv)];
      if (slot) return slot.value;
      if (objShape.open) return unknown;
      // 闭 shape 字面量 key miss：键确定不存在 → 仅 undefined（与 $get / Map miss 一致）
      return undef();
    }
    if (objShape.open && slots.length > 0) {
      // open shape：已知槽 ∪ unknown
      return joinAbs(slots.reduce((x, y) => joinAbs(x, y)), unknown);
    }
    // 闭 shape 未知 key：已知槽 ∪ undefined（键可能不存在）
    return joinSlotsWithUndef();
  }
  // 字符串下标：s[i] → 第 i 个字符（字面量精确）
  const sv = litValue(a);
  if (typeof sv === "string") {
    if (typeof iv === "number" && Number.isInteger(iv)) {
      if (iv >= 0 && iv < sv.length) {
        return abs(
          { k: "prim", type: "string" },
          { op: "lit", value: sv[iv] as never },
          pTrue,
          "exact",
        );
      }
      return undef();
    }
    return unknown;
  }
  return unknown;
}

/** 巨下标/巨 length 写入：不物化稀疏段（原生稀疏数组），就地降 arr 形状。
 *  元素域 = 已知元素 ∪ undefined（hole/延长槽读 undefined）∪ 写入值。 */
function widenTupleToArr(
  els: Abs[],
  holes: number[] | undefined,
  value: Abs | undefined,
): { k: "arr"; element: Abs } {
  let joined: Abs = els.length > 0 ? els.reduce((x, y) => joinAbs(x, y)) : unknown;
  if (holes && holes.length > 0) joined = joinAbs(joined, undef());
  if (value !== undefined) joined = joinAbs(joined, value);
  return { k: "arr", element: joined };
}

/** 下标写 a[i]=v → 新 tuple（越界写按 JS 语义增长，空洞为 undefined） */
export function $idxSet(a: Abs, i: Abs, value: Abs): Abs {
  const iv = litValue(i);
  if (a.shape.k === "tuple" && typeof iv === "number" && Number.isInteger(iv) && iv >= 0) {
    const st = extStateOf(a);
    if (st === "frozen") throwStrictWrite(); // frozen 数组：下标写 TypeError
    if (
      (st === "sealed" || st === "nonext") &&
      iv >= a.shape.elements.length
    ) {
      throwStrictWrite(); // 不可扩展：越界写（新下标）TypeError
    }
    // i ≥ 2^32-1：非数组下标，原生是 expando 属性（length 不变、`i in a` 可见）。
    // 数组模型无 expando 槽：就地降 arr（读/keys/in 全保守），不得假精确
    if (iv >= 4294967295) {
      a.shape = widenTupleToArr(a.shape.elements, a.shape.holes, value);
      a.conf = confJoin(a.conf, "path");
      clearStaleTermPred(a);
      return a;
    }
    // 巨大合法下标：原生 length 增长到 iv+1 的稀疏数组；
    // 分析不物化巨 tuple（OOM/DoS），就地降 arr
    if (iv + 1 > TUPLE_MATERIALIZE_CAP) {
      a.shape = widenTupleToArr(a.shape.elements, a.shape.holes, value);
      a.conf = confJoin(a.conf, "path");
      clearStaleTermPred(a);
      return a;
    }
    const els = [...a.shape.elements];
    const holes = [...(a.shape.holes ?? [])];
    while (els.length < iv) {
      holes.push(els.length); // 越界写增长段是 hole（原生 [1].x=3 中间槽不存在）
      els.push(undef());
    }
    els[iv] = asAbsVal(value);
    // 写 hole 位置：槽被填实，清除 hole 标记
    const hi = holes.indexOf(iv);
    if (hi >= 0) holes.splice(hi, 1);
    // 就地写回：别名（const b=a）同步（JS 引用语义）
    a.shape = { k: "tuple", elements: els, holes: holes.length > 0 ? holes : undefined };
    clearStaleTermPred(a);
    return a;
  }
  // 非（整数下标 tuple）目标：按目标种类分派（strict/ESM 语义；此前一律
  // `return a` 静默——o[k]=v 计算键写对象假精确 no-op、空值/prim 不抛）
  const sk = a.shape.k;
  if (sk === "prim" || sk === "never" || isNullishAbs(a)) throwStrictWrite();
  if (sk === "any") {
    noteAnyMemberMayThrow(a, iv === undefined ? "<computed>" : String(iv), "property");
    return a;
  }
  if (sk === "obj") {
    if (iv === undefined) {
      // 抽象键：无槽位模型——标记 open（缺失键读不再折 undefined 假精确）
      a.shape = { ...a.shape, open: true };
      a.conf = confJoin(a.conf, "path");
      clearStaleTermPred(a);
      return a;
    }
    return $set(a, String(iv), value);
  }
  if (sk === "brand") {
    if (iv === undefined) return a;
    // 仅用户类（注册表）委派 $set——内建 brand（TypedArray/String 包装等）
    // 下标写语义未建模，保持保守不写（差分抓到：Uint8Array 截断被写穿假精确）
    if (getBClass(a.shape.name)) return $set(a, String(iv), value);
    return a;
  }
  if (sk === "tuple") {
    // 非整数/抽象下标（expando 属性）：就地降 arr（长度/元素保持）
    a.shape = widenTupleToArr(a.shape.elements, a.shape.holes, value);
    a.conf = confJoin(a.conf, "path");
    clearStaleTermPred(a);
    return a;
  }
  return a;
}

/** 数组/字符串长度 */
export function $len(a: Abs): Abs {
  // any 上的 .length：无约束成员（any ≠ unknown——不得报引擎债）
  if (a?.shape?.k === "any") return anyMemberResult();
  if (a.shape.k === "tuple") {
    return abs(
      { k: "prim", type: "number" },
      { op: "lit", value: a.shape.elements.length },
      pTrue,
      "exact",
    );
  }
  if (a.shape.k === "arr") {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  if (a.shape.k === "sum") {
    // 全成员长度同字面量 → 折叠（fork join 后 a.length 常见场景）；
    // 否则 number（成员长度可能不同）
    const lens = a.shape.members.map((m) => $len(m));
    const lits = lens.map(litValue);
    if (lits.length > 0 && lits.every((v) => v !== undefined && v === lits[0])) {
      return lens[0]!;
    }
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  const sv = litValue(a);
  if (typeof sv === "string") {
    return abs(
      { k: "prim", type: "number" },
      { op: "lit", value: sv.length },
      pTrue,
      "exact",
    );
  }
  // String 包装对象（Object('ab') / new String）：内层 length 槽
  if (a.shape.k === "brand" && a.shape.name === "String") {
    const inner = a.shape.shape;
    if (inner.shape.k === "obj") {
      const lenSlot = inner.shape.slots["length"];
      if (lenSlot && !lenSlot.optional) return lenSlot.value;
    }
  }
  // RegExpStringIterator（matchAll 结果）：无 length 属性 → undefined
  if (a.shape.k === "brand" && a.shape.name === "RegExpMatchIterator") {
    return undef();
  }
  return unknown;
}

// --- 对象 / 成员 ---

/** 对象字面量 → Abs obj */
export function $obj(slots: Record<string, Abs>): Abs {
  const s: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) s[k] = { value: asAbsVal(v) };
  return objOf(s);
}

/** 对象展开 { ...a, b } */
export function $spread(a: Abs, b: Abs): Abs {
  let bb = asAbsVal(b);
  // 原生展开会**调用**源对象 getter 并把结果作为数据槽拷入
  const acc = bb && typeof bb === "object" ? accessorTable.get(bb as object) : undefined;
  if (acc && bb.shape.k === "obj") {
    let changed = false;
    const slots = { ...(bb.shape as ObjShape).slots };
    for (const [k, fn] of acc) {
      if (fn.get && slots[k]) {
        slots[k] = { value: fn.get(bb) };
        changed = true;
      }
    }
    if (changed) {
      bb = abs({ k: "obj", slots }, undefined, undefined, bb.conf);
    }
  }
  // any 展开：无约束键 → open obj（不是空 {} / unknown）
  const aa = asAbsVal(a);
  const b0 = asAbsVal(b);
  if (aa?.shape?.k === "any" || b0?.shape?.k === "any") {
    const base = spreadObj(
      aa?.shape?.k === "any" ? abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial") : aa,
      b0?.shape?.k === "any" ? abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial") : b0,
    );
    return base;
  }
  return spreadObj(aa, b0);
}

/**
 * 解构 rest：`const { a, ...rest } = o` → rest = o 去掉 named keys。
 * closed obj：剩余槽 closed；open / optional 键：rest 仍 open（可能有未知键）。
 */
export function $objRest(o: Abs, keys: string[]): Abs {
  o = asAbsVal(o);
  if (o.shape.k === "sum") {
    return o.shape.members
      .map((m) => $objRest(m, keys))
      .reduce((a, b) => joinAbs(a, b));
  }
  if (!isObj(o)) {
    // any 解构 rest：无约束对象面（open），不是 unknown
    if (o.shape.k === "any") {
      const shape: Abs["shape"] = { k: "obj", slots: {}, open: true };
      return { shape, conf: "partial" };
    }
    return unknown;
  }
  const drop = new Set(keys);
  const slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = {};
  let openRest = o.shape.open === true;
  for (const [k, s] of Object.entries(o.shape.slots)) {
    if (drop.has(k)) continue;
    slots[k] = s;
    // optional 源键可能仍以 undefined 出现在 rest 的动态面；闭槽无需 open
  }
  // 提取的 optional 键：JS rest 会排除该键，但 open 对象上未知键仍可能进 rest
  if (o.shape.open) openRest = true;
  const shape: Abs["shape"] = { k: "obj", slots };
  if (openRest) (shape as { open?: boolean }).open = true;
  return { shape, conf: o.conf === "exact" ? "exact" : confJoin(o.conf, "partial") };
}

/** 数组 rest：`const [a, ...rest] = arr` → rest = 从 start 起的尾段 */
export function $arrRest(a: Abs, start: number): Abs {
  a = asAbsVal(a);
  if (a.shape.k === "sum") {
    return a.shape.members.map((m) => $arrRest(m, start)).reduce((x, y) => joinAbs(x, y));
  }
  if (a.shape.k === "tuple") {
    return tupleOrWiden(a.shape.elements.slice(start), a.conf);
  }
  if (a.shape.k === "arr") return a;
  if (a.shape.k === "any") return abs({ k: "arr", element: anyMemberResult() }, undefined, undefined, "path");
  return unknown;
}

/** 数组连接 [...a, ...b] / [...a, x]；结果超 cap 时与字面量同策略降 arr */
export function $concat(a: Abs, b: Abs): Abs {
  a = asAbsVal(a);
  b = asAbsVal(b);
  // 字符串 spread：按 code points 拆（surrogate pair 合并；原生迭代语义）
  const av = litValue(a);
  if (typeof av === "string") {
    return $concat($arr([...av].map((c) => $lit(c))), b);
  }
  const bv = litValue(b);
  if (typeof bv === "string") {
    return $concat(a, $arr([...bv].map((c) => $lit(c))));
  }
  const as = a.shape;
  const bs = b.shape;
  if (as.k === "tuple" && bs.k === "tuple") {
    return tupleOrWiden([...as.elements, ...bs.elements], confJoin(a.conf, b.conf));
  }
  // 一侧是抽象数组（arr）：spread 语义按元素并入（元素 join），
  // 不得整体嵌为单元素——字面量链超 cap 降级为 arr 后继续吸收后续元素也走此分支
  if (as.k === "arr" || bs.k === "arr") {
    const ea: Abs = as.k === "tuple"
      ? as.elements.reduce((x, y) => joinAbs(x, y))
      : as.k === "arr"
        ? as.element
        : a;
    const eb: Abs = bs.k === "tuple"
      ? bs.elements.reduce((x, y) => joinAbs(x, y))
      : bs.k === "arr"
        ? bs.element
        : b;
    return abs({ k: "arr", element: joinAbs(ea, eb) }, undefined, undefined, "path");
  }
  // 剩余：至少一侧非 tuple/arr/string 字面量。
  // 字面量不可迭代值 spread → 原生 TypeError（[...5]/[...null]/[...true]）
  const throwIfNonIterable = (x: Abs): void => {
    if (x.term?.op !== "lit") return;
    const v = x.term.value;
    if (
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "bigint" ||
      typeof v === "symbol" ||
      v === null ||
      v === undefined
    ) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  };
  throwIfNonIterable(a);
  throwIfNonIterable(b);
  // Set/Map/matchAll 迭代器：条目精确展开（Map 是 entry 元组）；其余非容器
  // （unknown/any/brand/obj/抽象字符串）长度未知——必须 arr join，不得折单元素
  // tuple（[...x].length 假精确 1 的根因）
  const expand = (x: Abs): Abs[] | null => {
    if (isSetAbs(x)) return setElementsAbs(x);
    if (isMapAbs(x)) return mapEntriesAbs(x);
    const mi = matchIterElements(x);
    if (mi) return mi;
    return null;
  };
  if (as.k === "tuple") {
    const be = expand(b);
    if (be) {
      return tupleOrWiden([...as.elements, ...be], confJoin(a.conf, b.conf));
    }
    // b 可能可迭代：spread 并入的是 b 的元素而非 b 本身。
    // any 的元素域是 any（无约束），不是 unknown（引擎债）。
    const bEl = b?.shape?.k === "any" ? anyMemberResult() : unknown;
    return abs(
      { k: "arr", element: [...as.elements, bEl].reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      "path",
    );
  }
  const ae = expand(a);
  if (ae && bs.k === "tuple") {
    return tupleOrWiden([...ae, ...bs.elements], confJoin(a.conf, b.conf));
  }
  // 双侧皆非精确容器：元素 join（any → any；空 tuple 不贡献元素）
  const sideEl = (x: Abs, expanded: Abs[] | null): Abs => {
    if (expanded) return expanded.reduce((u, y) => joinAbs(u, y));
    if (x?.shape?.k === "any") return anyMemberResult();
    if (x?.shape?.k === "tuple") {
      const els = x.shape.elements;
      // 空 tuple spread 不贡献元素 → never；join(never, any) = any
      return els.length ? els.reduce((u, y) => joinAbs(u, y)) : abs({ k: "never" }, undefined, undefined, "exact");
    }
    return unknown;
  };
  return abs(
    { k: "arr", element: joinAbs(sideEl(a, ae), sideEl(b, expand(b))) },
    undefined,
    undefined,
    "path",
  );
}

/** 元素列表（tuple 展开；arr 抽象；C1 Set/Map 逐条目；matchAll 迭代器逐匹配项；
 *  字符串按 code points）。Map 迭代语义是 entry `[key, value]` 元组，不是裸 value。 */
export function $elems(a: Abs): Abs[] {
  if (a.shape.k === "tuple") return [...a.shape.elements];
  if (a.shape.k === "arr") return [a.shape.element];
  if (isSetAbs(a)) return setElementsAbs(a);
  if (isMapAbs(a)) return mapEntriesAbs(a);
  const mi = matchIterElements(a);
  if (mi) return mi;
  const sv = litValue(a);
  if (typeof sv === "string") return [...sv].map((c) => $lit(c));
  return [unknown];
}

/**
 * for-of：对 iterable 每个元素跑 body；有界展开。
 * body(item, i) 可返回 void；状态由外部 JS 变量承接。
 * - 具体空 tuple：体 0 次（不得用 `length || maxIters` 展开成 maxIters）
 * - 抽象 arr / 未知长度：0..maxIters 出口与 pack 状态 join
 */
/**
 * for-in 键序列：原生顺序为整数键升序 → 其余键按插入序；
 * 数组 hole 槽不出键（读值为 undefined 但不可枚举）。仅自有可枚举键。
 */
export function $forInKeys(o: Abs): Abs {
  const shape = o.shape;
  if (shape.k === "sum") {
    const members = shape.members.map((m) => $forInKeys(m));
    return members.reduce((a, b) => joinAbs(a, b));
  }
  const isArrayIndexKey = (k: string): boolean => {
    const n = Number(k);
    return (
      k !== "" &&
      String(n) === k &&
      Number.isInteger(n) &&
      n >= 0 &&
      n < 4294967295
    );
  };
  if (shape.k === "obj") {
    const keys = Object.keys(shape.slots);
    const intKeys = keys.filter(isArrayIndexKey).sort((a, b) => Number(a) - Number(b));
    const strKeys = keys.filter((k) => !isArrayIndexKey(k));
    return $arr([...intKeys, ...strKeys].map((k) => $lit(k)));
  }
  if (shape.k === "tuple") {
    const idxs: number[] = [];
    for (let i = 0; i < shape.elements.length; i++) {
      if (shape.holes?.includes(i)) continue;
      idxs.push(i);
    }
    return $arr(idxs.map((i) => $lit(String(i))));
  }
  if (shape.k === "arr") {
    // 抽象数组：索引域未知，单代表元素迭代（与 $forOf 抽象近似同口径）
    return abs({ k: "arr", element: $lit("0") }, undefined, undefined, "partial");
  }
  const sv = litValue(o);
  if (typeof sv === "string") {
    return $arr(Array.from({ length: sv.length }, (_, i) => $lit(String(i))));
  }
  return $arr([]);
}

export function $forOf(
  iterable: Abs,
  body: (item: Abs, index: Abs) => void,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
  opts?: {
    pack?: () => Abs;
    unpack?: (s: Abs) => void;
    /** 标签循环：仅吸收同标签 break/continue 信号 */
    label?: string;
  },
): void {
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  let exitJoin: Abs | undefined;
  const snapExit = (): void => {
    if (!pack) return;
    const s = pack();
    exitJoin = exitJoin ? joinAbs(exitJoin, s) : s;
  };
  const applyExitJoin = (): void => {
    if (!exitJoin || !pack || !unpack) return;
    unpack(joinAbs(exitJoin, pack()));
  };

  const shape = iterable.shape;
  const items = $elems(iterable);
  const sv = litValue(iterable);
  // tuple / 确切 Set·Map 条目数 / 字符串字面量 code points → 有界展开；
  // 抽象 arr 与 maybeAbsent 仍 0..max join
  const knownLen =
    shape.k === "tuple"
      ? shape.elements.length
      : typeof sv === "string"
        ? [...sv].length
        : collectionExactLen(iterable);
  // 非具体容器：长度未知（可能空、可能更长）→ 单代表元素只跑一次
  // （同一元素重复 join 幂等，maxIters 次展开只会让索引假精确 + 大数组
  // 反复深拷贝把分析拖死）；0 次出口由下方 snapExit join，保持 sound。
  const unbounded = knownLen === undefined;

  if (unbounded) snapExit();

  const n =
    knownLen !== undefined
      ? Math.min(knownLen, maxIters)
      : items.length > 0
        ? 1
        : 0;

  for (let i = 0; i < n; i++) {
    const item =
      items.length > 0 ? items[Math.min(i, items.length - 1)]! : unknown;
    try {
      body(
        item,
        unbounded
          ? abs({ k: "prim", type: "number" }, undefined, undefined, "partial")
          : abs(
              { k: "prim", type: "number" },
              { op: "lit", value: i },
              pTrue,
              "exact",
            ),
      );
    } catch (e) {
      if (isNudoBreak(e, opts?.label)) {
        applyExitJoin();
        return;
      }
      if (isNudoContinue(e, opts?.label)) continue; // 下一个元素；已发生副作用保留
      if (isNudoReturn(e) || isNudoThrow(e)) throw e;
      throw e;
    }
    if (unbounded) snapExit();
  }
  if (unbounded && n === 0) snapExit();
  applyExitJoin();
}

/**
 * 命名空间身份表：transpile 后 `Math.max(0, x)` 的接收者是宿主 JS 全局对象
 * （非 Abs）。按对象身份识别命名空间，路由到 Abs builtin 表。
 */
export function namespaceNameOf(v: unknown): string | undefined {
  if (typeof v !== "object" && typeof v !== "function") return undefined;
  if (v === Math) return "Math";
  if (v === Number) return "Number";
  if (v === JSON) return "JSON";
  if (v === Object) return "Object";
  if (v === Array) return "Array";
  if (v === String) return "String";
  if (v === Date) return "Date";
  if (v === Promise) return "Promise";
  return undefined;
}

/** 正则字面量 → RegExp brand（source/flags/lastIndex 进 slots，供 exec/test 精确执行） */
export function $regex(pattern: string, flags = ""): Abs {
  return regexBrandAbsFrom(pattern, flags);
}

/** 成员读：obj.slots[key]；缺失 → undefined 字面量；brand 解包内层 */
export function $get(
  o: Abs,
  key: string,
  opts?: { /** 调用方已负责诊断（如 $invoke） */ silent?: boolean },
): Abs {
  // 宿主 JS 对象（Math/JSON…）：属性按命名空间/真值投影
  if (!o || typeof o !== "object" || !("shape" in (o as object))) {
    // Object.prototype / Object.prototype.X（含 host 身份）
    if (o === Object.prototype) {
      if (OBJECT_PROTO_METHOD_NAMES.has(key)) return objectProtoMethodAbs(key);
      return unknown;
    }
    const ns = namespaceNameOf(o);
    if (ns === "Object" && key === "prototype") return objectProtoBrand();
    if (ns) {
      try {
        const raw = (o as Record<string, unknown>)[key];
        if (typeof raw === "function") {
          return absFunction([`${ns}.${key}`], {
            body: noBody,
            apply: (args) => evalNamespaceCall(ns, key, args) ?? unknown,
          });
        }
        return $lit(raw);
      } catch {
        return unknown;
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
    });
  }
  if (o.shape.k === "brand") {
    const isClassVal = classNameOfValue(o as object) === o.shape.name;
    // 内建 brand 原型方法读取（typeof m.forEach / m[Symbol.iterator]）：
    // 方法实现由 $invoke 派发，此处给可 typeof 的 fn 形状
    // （class 声明值同名内建时不误伤：类方法走 registry）
    const builtinM = BUILTIN_BRAND_METHODS[o.shape.name];
    if (builtinM && !isClassVal && (key === "@@iterator" || builtinM.has(key))) {
      return absFunction([], { body: noBody });
    }
    // JS Map/Set 的 size 是属性不是方法；brand 内层为空 obj，须在 $get 委托
    if (key === "size" && o.shape.name === "Map") return mapSizeAbs(o);
    if (key === "size" && o.shape.name === "Set") return setSizeAbs(o);
    const inner = o.shape.shape;
    // 自有数据属性优先于原型访问器（原生属性查找：own → prototype）
    // 必须 getSlot：constructor/toString 等键裸读会踩宿主 Object.prototype
    if (inner?.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      if (slot && !slot.optional) return slot.value;
    }
    if (isClassVal) {
      const sacc = findStaticClassAccessor(o.shape.name, key);
      if (sacc) return sacc.get ? sacc.get(o) : undef();
      // 类值上读实例访问器键 → 原生 undefined
      if (findClassAccessor(o.shape.name, key)) return undef();
      // 静态方法一等读取（typeof A.m / 高阶传递）：沿继承链在 registry 找
      // 未调用方法槽带 AST 形参展示名（不再假零参）
      for (const n of bClassChain(o.shape.name)) {
        const spec = getBClass(n);
        if (spec?.staticMethods?.[key]) {
          return absFunction(spec.staticMethodParams?.[key] ?? [], { body: noBody });
        }
      }
      // 类值是 constructor 函数：prototype 对象与 Function.prototype 成员
      if (key === "prototype") {
        return abs({ k: "obj", slots: {} }, undefined, undefined, "path");
      }
      if (key === "call" || key === "apply" || key === "bind") {
        return absFunction([], { body: noBody });
      }
    } else {
      const acc = findClassAccessor(o.shape.name, key);
      if (acc) return acc.get ? acc.get(o) : undef();
      // 实例上读静态访问器键 → 原生 undefined（属性在构造器上）
      if (findStaticClassAccessor(o.shape.name, key)) return undef();
      // 实例方法读取（typeof a.m / 一等值）：沿继承链在 registry 找方法
      // 未调用方法槽带 AST 形参展示名（不再假零参）
      for (const n of bClassChain(o.shape.name)) {
        const spec = getBClass(n);
        if (spec?.methods?.[key]) {
          return absFunction(spec.methodParams?.[key] ?? [], { body: noBody });
        }
      }
    }
    // 原型链 constructor：内建 brand（Error/Date/…）→ 对应构造器 Abs
    if (key === "constructor") {
      const cn = ctorNameOfRecv(o);
      if (cn) return builtinCtorAbs(cn);
    }
    return $get(inner, key, opts);
  }
  // 数组 length：成员路径（a.length += 1 等复合写）与 a.length 读同源
  if ((o.shape.k === "tuple" || o.shape.k === "arr") && key === "length") {
    return $len(o);
  }
  // 元组/数组/prim 上的 Object.prototype 方法读取
  if (
    (o.shape.k === "tuple" || o.shape.k === "arr" || o.shape.k === "prim") &&
    OBJECT_PROTO_METHOD_NAMES.has(key) &&
    !(o.shape.k === "prim" && o.shape.type === "string" && key === "toString")
  ) {
    // string.toString/valueOf 由 callAbsMethod 处理调用；一等读取仍给 OP 函数
    return objectProtoMethodAbs(key);
  }
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
    if (acc) return acc.get ? acc.get(o) : undef();
    const slot = getSlot((o.shape as ObjShape).slots, key);
    if (slot) {
      // optional 槽在 JS 中可能缺席 → 读到 undefined，不能报 definite presence
      if (slot.optional) return joinAbs(slot.value, undef());
      return slot.value;
    }
    // Object.prototype 方法（非 null-proto）：一等函数读取
    if (!isNullProtoObj(o) && OBJECT_PROTO_METHOD_NAMES.has(key)) {
      return objectProtoMethodAbs(key);
    }
    if ((o.shape as ObjShape).open) return unknown;
    // Object.prototype.constructor（null-proto 无 → undef）
    if (key === "constructor" && !isNullProtoObj(o)) {
      return builtinCtorAbs("Object");
    }
    // C0.5：闭 shape 缺槽且求值命中 → 可选 nudo:missing-slot（默认 off）
    noteObjSlotMissing(o, key);
    return undef();
  }
  if (o.shape.k === "sum") {
    const parts = o.shape.members.map((m) => $get(m, key, opts));
    return parts.reduce((a, b) => joinAbs(a, b));
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

/**
 * Map/Set forEach：条目表逐条调用回调（value, key, recv）。
 * 回调是 B 路径 JS 函数（transpile 内联箭头）直接调用；Abs fn 走 $call。
 * 回调返回值丢弃；forEach 表达式值恒 undefined。
 */
export function $collectionForEach(recv: Abs, cb: unknown): Abs | undefined {
  const invokeCb = (args: Abs[]): void => {
    if (typeof cb === "function") {
      callAtFunctionBoundary(() => {
        (cb as (...a: Abs[]) => unknown)(...args);
      });
      return;
    }
    if (cb && typeof cb === "object" && "shape" in (cb as object)) {
      $call(cb as Abs, args);
    }
  };
  if (isMapAbs(recv)) {
    for (const entry of mapEntriesAbs(recv)) {
      if (entry.shape.k === "tuple" && entry.shape.elements.length >= 2) {
        const key = entry.shape.elements[0]!;
        const value = entry.shape.elements[1]!;
        invokeCb([value, key, recv]);
      }
    }
    return undef();
  }
  if (isSetAbs(recv)) {
    for (const el of setElementsAbs(recv)) {
      invokeCb([el, el, recv]);
    }
    return undef();
  }
  return undefined;
}

/** 成员写：返回新 obj/brand（不可变更新）；frozen/sealed/只读目标按 sloppy 静默失败 */
export function $set(o: Abs, key: string, value: Abs): Abs {
  if (o.shape.k === "brand") {
    if (extStateOf(o) === "frozen") throwStrictWrite();
    const isClassVal = classNameOfValue(o as object) === o.shape.name;
    if (isClassVal) {
      const sacc = findStaticClassAccessor(o.shape.name, key);
      if (sacc) return sacc.set ? sacc.set(o, value) : o;
      if (findClassAccessor(o.shape.name, key)) return o;
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
        const st = extStateOf(o);
        if ((st === "sealed" || st === "nonext") && !getSlot(inner.shape.slots, key)) {
          throwStrictWrite(); // 不可扩展：新键写 TypeError
        }
        if (getPropFlags(o)?.get(key)?.writable === false) throwStrictWrite();
        inner.shape.slots[key] = { value: asAbsVal(value) };
        clearStaleTermPred(o);
        return o;
      }
    }
    const inner = $set(o.shape.shape, key, value);
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
    if (extStateOf(o) === "frozen") throwStrictWrite();
    const v = litValue(value);
    if (typeof v === "number") {
      // 负数/小数/NaN/Infinity/≥2^32：原生 hard RangeError（catch 可吸收）
      if (!Number.isInteger(v) || v < 0 || v > 4294967295) {
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
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
    const v = litValue(value);
    // 抽象数组也是数组：非法 length 字面量同样原生 RangeError
    if (typeof v === "number" && (!Number.isInteger(v) || v < 0 || v > 4294967295)) {
      throw new NudoThrow(errorTypeAbs("RangeError"));
    }
    o.conf = "partial";
    clearStaleTermPred(o);
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
  // 就地写槽（引用语义：const b = o; b.x = v 对 o 可见）——Abs 身份不变
  shape.slots[key] = { value: asAbsVal(value) };
  o.conf = confJoin(o.conf, value.conf);
  clearStaleTermPred(o);
  return o;
}

/**
 * 有界 while：state 线程穿 test/step（与 $for 同折叠语义）。
 * 抽象条件无法诚实终止——必须 maxIters。
 */
export function $while(
  init: Abs,
  test: (s: Abs) => Abs,
  step: (s: Abs) => Abs,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
): Abs {
  let state = init;
  let exitJoin: Abs | undefined;

  for (let i = 0; i < maxIters; i++) {
    const t = test(state);
    if (isDefinitelyFalse(t)) {
      return exitJoin ? joinAbs(exitJoin, state) : state;
    }
    if (!isDefinitelyTrue(t)) {
      exitJoin = exitJoin ? joinAbs(exitJoin, state) : state;
    }
    const next = step(state);
    if (i > 0) {
      const nv = litValue(next);
      const sv = litValue(state);
      const stuck =
        (nv !== undefined && sv !== undefined && nv === sv) ||
        (nv === undefined && sv === undefined && leqAbs(next, state).ok);
      if (stuck) {
        return exitJoin ? joinAbs(exitJoin, next) : next;
      }
    }
    state = next;
  }
  return exitJoin ? joinAbs(exitJoin, state) : state;
}

/**
 * 顺序 while（具体/可变闭包）：body 内对 JS 变量赋值。
 * 提供 pack/unpack 时，抽象条件的可能出口会 join 回绑定（P0 健全）；
 * 未 instrument 的调用保持旧语义（预算截断，文档已声明）。
 */
export function $whileSeq(
  test: () => Abs,
  body: () => void,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
  opts?: {
    /** 把当前绑定收成 Abs 状态（transpile 注入） */
    pack?: () => Abs;
    /** 把 join 后的状态写回绑定 */
    unpack?: (s: Abs) => void;
    /** 标签循环：仅吸收同标签 break/continue 信号 */
    label?: string;
  },
): void {
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  let exitJoin: Abs | undefined;
  const snapExit = (): void => {
    if (!pack) return;
    const s = pack();
    exitJoin = exitJoin ? joinAbs(exitJoin, s) : s;
  };
  const applyExitJoin = (): void => {
    if (!exitJoin || !pack || !unpack) return;
    unpack(joinAbs(exitJoin, pack()));
  };
  for (let i = 0; i < maxIters; i++) {
    const t = test();
    if (isDefinitelyFalse(t)) {
      applyExitJoin();
      return;
    }
    // 抽象条件：当前绑定是合法出口之一，先 snapshot 再进 body
    if (!isDefinitelyTrue(t)) snapExit();
    try {
      body();
    } catch (e) {
      if (isNudoBreak(e, opts?.label)) {
        applyExitJoin();
        return;
      }
      if (isNudoContinue(e, opts?.label)) continue; // 体提前结束，副作用已在绑定
      if (isNudoReturn(e) || isNudoThrow(e)) throw e;
      throw e;
    }
  }
  // 预算耗尽：最后一轮条件仍可能为真 → 当前态也是出口
  snapExit();
  applyExitJoin();
}

// --- early return from loop bodies (C2.1) ---

/** B 路径「函数提前 return」信号（区别于 throw） */
export class NudoReturn extends Error {
  readonly absValue: Abs;
  constructor(absValue: Abs) {
    super("nudo:return");
    this.name = "NudoReturn";
    this.absValue = absValue;
  }
}

export function isNudoReturn(e: unknown): e is NudoReturn {
  return e instanceof NudoReturn;
}

/** transpile `return x` inside for/while → `$loopReturn(x)` */
export function $loopReturn(v: Abs): never {
  throw new NudoReturn(v);
}

/**
 * break/continue 信号：transpile 在循环体内生成 $loopBreak/$loopContinue，
 * $for/$whileSeq/$forOf 在 body 调用点捕获。带标签信号只被同标签循环吸收，
 * 不匹配继续冒泡到外层循环（`break outer` / `continue outer` 语义）。
 */
export class NudoLoopSignal extends Error {
  readonly kind: "break" | "continue";
  readonly label: string | undefined;
  constructor(kind: "break" | "continue", label?: string) {
    super("nudo:loop");
    this.name = "NudoLoopSignal";
    this.kind = kind;
    this.label = label;
  }
}

export function $loopBreak(label?: string): never {
  throw new NudoLoopSignal("break", label || undefined);
}

export function $loopContinue(label?: string): never {
  throw new NudoLoopSignal("continue", label || undefined);
}

/** 无标签信号匹配任何循环；带标签信号仅匹配同名循环 */
function loopSignalMatches(e: NudoLoopSignal, label: string | undefined): boolean {
  return e.label === undefined || e.label === label;
}

export function isNudoBreak(e: unknown, label?: string): boolean {
  return e instanceof NudoLoopSignal && e.kind === "break" && loopSignalMatches(e, label);
}

export function isNudoContinue(e: unknown, label?: string): boolean {
  return e instanceof NudoLoopSignal && e.kind === "continue" && loopSignalMatches(e, label);
}

/** 非循环 labeled block：判断 break 信号是否指向本标签（transpile 生成代码用） */
export function $isBreakTo(e: unknown, label: string): boolean {
  return e instanceof NudoLoopSignal && e.kind === "break" && e.label === label;
}

/** catch 转译辅助：控制流信号透传（生成代码只注入 `$` 前缀符号） */
export function $rethrowIfNudoReturn(e: unknown): void {
  if (isNudoReturn(e)) throw e;
}

// --- throws ---

/** transpile `throw x` → `$throw(x)` */
export function $throw(v: Abs): never {
  throw new NudoThrow(v);
}

/**
 * fork 臂是否以控制流退出（return / throw）。
 * 生成代码用此决定 continue-path free-write 标志：退出臂的写
 * 不得污染 join 后的 continue 绑定。
 */
export function $isForkExit(e: unknown): boolean {
  return isNudoReturn(e) || isNudoThrow(e);
}

/** catch 参数：从 NudoThrow 取出 Abs；宿主 Error 补 name/message；否则 unknown */
export function $catchVal(e: unknown): Abs {
  if (isNudoThrow(e)) return e.absValue;
  if (e instanceof Error) {
    const name = e.name || "Error";
    const msgAbs: Abs =
      typeof e.message === "string"
        ? abs(
            { k: "prim", type: "string" },
            { op: "lit", value: e.message as never },
            pTrue,
            "exact",
          )
        : abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    return abs(
      {
        k: "brand",
        name,
        shape: objOf({
          name: {
            value: abs(
              { k: "prim", type: "string" },
              { op: "lit", value: name as never },
              pTrue,
              "exact",
            ),
          },
          message: { value: msgAbs },
        }),
      },
      undefined,
      undefined,
      "path",
    );
  }
  return unknown;
}

// --- async / await ---

function wrapPromiseAbs(inner: Abs): Abs {
  inner = asAbsVal(inner);
  return abs(
    { k: "eff", eff: "promise", inner },
    undefined,
    undefined,
    confJoin(inner.conf, "path"),
  );
}

function awaitAbsVal(v: Abs): Abs {
  if (v.shape.k === "eff" && v.shape.eff === "promise") return v.shape.inner;
  return v;
}

/**
 * async 函数体包进 thunk，返回值经 wrapPromise。
 */
export function $async(thunk: () => Abs): Abs {
  return wrapPromiseAbs(thunk());
}

/** await → 解包 eff("promise") */
export function $await(v: Abs): Abs {
  return awaitAbsVal(v);
}

/** async 直接 return 的 coerce */
export function $asyncReturn(v: Abs): Abs {
  if (v.shape.k === "eff") return v;
  return wrapPromiseAbs(v);
}

// --- 生成器 ---
// yieldStack / genPathSensitive / genJoinOverride 在文件前部（fork 隔离用）

/** function* 体：收集所有 yield 值为 tuple Abs；抽象分支时降 conf（P0-6） */
export function $gen(body: () => void): Abs {
  const ys: Abs[] = [];
  const marker = genPathSensitive;
  const prevOverride = genJoinOverride;
  genJoinOverride = null;
  yieldStack.push(ys);
  try {
    body();
  } finally {
    yieldStack.pop();
  }
  if (genJoinOverride) {
    const joined: Abs = genJoinOverride;
    genJoinOverride = prevOverride;
    return { ...joined, conf: joined.conf === "exact" ? ("path" as Confidence) : joined.conf };
  }
  genJoinOverride = prevOverride;
  const arr = $arr(ys);
  if (genPathSensitive > marker) {
    return { ...arr, conf: arr.conf === "exact" ? ("path" as Confidence) : arr.conf };
  }
  return arr;
}

/** yield v：压入当前生成器收集器；表达式值用 unknown */
export function $yield(v: Abs): Abs {
  const top = yieldStack[yieldStack.length - 1];
  if (top) top.push(v);
  return unknown;
}

/**
 * switch：具体 disc 选中匹配 case；抽象 disc 并所有分支。
 * 抽象路径与 $fork 同构：集合 side-table 按臂 overlay，共享 body 只跑一次；
 * 臂内 NudoReturn/NudoThrow 不冒泡污染兄弟臂。
 * **无 default 时必须隐式 fall-through 臂（undef）**，否则无匹配路径被丢掉（P0-2）。
 */
export function $switch(
  disc: Abs,
  cases: Array<{ test: Abs; run: () => Abs }>,
  dflt?: () => Abs,
): Abs {
  const dv = litValue(disc);
  if (dv !== undefined) {
    for (const c of cases) {
      const tv = litValue(c.test);
      // switch case 匹配是严格相等（===）：NaN 不匹配 NaN case；0 与 -0 互配。
      // Object.is 是 SameValue（NaN 相等），会假匹配 NaN case（假精确）。
      if (tv !== undefined && tv === dv) return asAbsVal(c.run());
    }
    return dflt ? asAbsVal(dflt()) : undef();
  }

  const exits = loopExitsAls.getStore();
  beginCollectionFork();
  const armOverlays: Array<ReturnType<typeof popCollectionArm>> = [];
  const armYsList: Array<Abs[] | null> = [];
  const runArm = (fn: () => Abs): ForkArm => {
    pushCollectionArm();
    try {
      const r = withIsolatedYields(() => runForkArm(fn, exits));
      armYsList.push(r.ys);
      return r.v;
    } finally {
      armOverlays.push(popCollectionArm());
    }
  };
  const results: ForkArm[] = [];
  try {
    // 共享 body（case 1: case 2: …）只执行一次，避免非幂等副作用被放大
    const seenRuns = new Set<() => Abs>();
    for (const c of cases) {
      if (seenRuns.has(c.run)) continue;
      seenRuns.add(c.run);
      results.push(runArm(c.run));
    }
    if (dflt) {
      if (!seenRuns.has(dflt)) results.push(runArm(dflt));
    } else {
      // 隐式 no-match 臂：全 case 不命中时 fall-through（P0-2）
      pushCollectionArm();
      try {
        results.push({ kind: "val", v: undef() });
        armYsList.push(null);
      } finally {
        armOverlays.push(popCollectionArm());
      }
    }
  } finally {
    endCollectionFork(armOverlays);
    if (yieldStack.length > 0) mergeArmYields(armYsList);
  }
  if (results.length === 0) return undef();

  const throws = results.filter((r): r is { kind: "throw"; v: Abs } => r.kind === "throw");
  const nonThrow = results.filter((r) => r.kind !== "throw");
  if (nonThrow.length === 0) {
    throw new NudoThrow(throws.map((t) => t.v).reduce((x, y) => joinAbs(x, y)));
  }
  const allRet = nonThrow.every((r) => r.kind === "ret");
  if (allRet) {
    throw new NudoReturn(nonThrow.map((r) => r.v).reduce((a, b) => joinAbs(a, b)));
  }
  // 混合：ret/throw 臂已进 exits；语句位只携带 val 臂值继续
  const valParts = nonThrow.filter((r) => r.kind === "val").map((r) => r.v);
  if (valParts.length === 0) return undef();
  return valParts.reduce((a, b) => joinAbs(a, b));
}

/** `??` / `??=` 测试：确定非 nullish → false；lit nullish → true；否则抽象 boolean */
export function $nullishTest(v: Abs): Abs {
  if (definitelyNotNullishShape(v.shape)) return boolLit(false);
  if (isNullishLitAbs(v)) return boolLit(true);
  const t = v.term;
  if (t?.op === "lit" && t.value !== null && t.value !== undefined) return boolLit(false);
  return bool();
}
