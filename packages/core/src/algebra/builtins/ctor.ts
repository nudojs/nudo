/**
 * 内建构造器注册表 + prototype brand / constructor 解析 + Object.prototype 单例 brand
 */
import type { Abs } from "../abs.ts";
import { abs, strLit, unknown } from "../abs.ts";
import { objOf, isNullProtoObj, getProtoAbs } from "../objects.ts";
import { markClassValue, classNameOfValue } from "../class-mark.ts";
import { getEvalClass, lookupClassValue, BUILTIN_ERROR_SUPER, fnProtoOf } from "../exec/class-registry.ts";
import { pTrue } from "../pred.ts";
import { str, noBody, typedArrayElementOf } from "./shared.ts";
import { absFunction } from "../abs-fn.ts";
import { setPropFlags } from "./invariants.ts";

const builtinCtorByName = new Map<string, Abs>();
const builtinCtorByAbs = new WeakMap<object, string>();

export function builtinCtorAbs(name: string): Abs {
  let a = builtinCtorByName.get(name);
  if (!a) {
    a = abs(
      { k: "brand", name, shape: objOf({ name: { value: strLit(name) } }) },
      undefined,
      undefined,
      "exact",
    );
    markClassValue(a as object, name);
    builtinCtorByName.set(name, a);
    builtinCtorByAbs.set(a as object, name);
  }
  return a;
}

/** Abs 侧内建构造器身份（与宿主构造器名对齐） */
export function builtinCtorNameOf(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  return builtinCtorByAbs.get(v as object);
}

/** 宿主全局构造器身份（Number === (42).constructor 折叠用） */
export function hostBuiltinCtorName(v: unknown): string | undefined {
  if (typeof v !== "function") return undefined;
  if (v === Number) return "Number";
  if (v === String) return "String";
  if (v === Boolean) return "Boolean";
  if (v === BigInt) return "BigInt";
  if (v === Symbol) return "Symbol";
  if (v === Array) return "Array";
  if (v === Object) return "Object";
  if (v === Function) return "Function";
  if (v === Promise) return "Promise";
  if (v === Date) return "Date";
  if (v === RegExp) return "RegExp";
  if (v === Map) return "Map";
  if (v === Set) return "Set";
  if (v === WeakMap) return "WeakMap";
  if (v === WeakSet) return "WeakSet";
  if (v === Error) return "Error";
  if (v === TypeError) return "TypeError";
  if (v === RangeError) return "RangeError";
  if (v === ReferenceError) return "ReferenceError";
  if (v === SyntaxError) return "SyntaxError";
  if (v === URIError) return "URIError";
  if (v === EvalError) return "EvalError";
  if (v === AggregateError) return "AggregateError";
  return undefined;
}

/**
 * 接收者 → 原型链 constructor 名（`.constructor` 折叠）。
 * null-proto 无 Object.prototype.constructor → undefined（读侧走 undef）。
 */
export function ctorNameOfRecv(recv: Abs): string | undefined {
  const s = recv.shape;
  switch (s.k) {
    case "prim":
      return s.type === "number"
        ? "Number"
        : s.type === "string"
          ? "String"
          : s.type === "boolean"
            ? "Boolean"
            : s.type === "bigint"
              ? "BigInt"
              : s.type === "symbol"
                ? "Symbol"
                : undefined;
    case "tuple":
    case "arr":
      return "Array";
    case "obj":
      return isNullProtoObj(recv) ? undefined : "Object";
    case "fn":
      return "Function";
    case "eff":
      return s.eff === "promise" ? "Promise" : "Generator";
    case "brand": {
      if (s.name === "Object.prototype") return "Object";
      // Bug 56/57：Arguments 不是构造器名（原生 arguments.constructor 是
      // Object）；Proxy 的 constructor 沿靶原型链
      if (s.name === "Arguments") return "Object";
      if (s.name === "Proxy") return ctorNameOfRecv(s.shape);
      if (s.name.endsWith(".prototype")) return s.name.slice(0, -".prototype".length);
      return s.name;
    }
    case "sum": {
      let first: string | undefined;
      for (const m of s.members) {
        const n = ctorNameOfRecv(m);
        if (n === undefined) return undefined;
        if (first === undefined) first = n;
        else if (first !== n) return undefined;
      }
      return first;
    }
    default:
      return undefined;
  }
}

/** `X.prototype` 形态（getPrototypeOf 结果；带 constructor 槽）。
 *  Bug 64：按名驻留——X.prototype 原生是唯一共享对象，两次读出 ===；
 *  protoOfRecv(B.prototype) 与 $get(ns,"prototype") 各自新建会让
 *  `Object.getPrototypeOf(RangeError.prototype) === Error.prototype`
 *  这类恒等丢精度（also 原地可变性跨读存活，原生语义）。 */
const protoBrandByName = new Map<string, Abs>();

/** Bug 58/85/92 复盘：Function.prototype 原生是唯一 callable 的 prototype
 *  （typeof "function"；调用返 undefined）。**单一驻留 fn 面**——
 *  protoOfRecv(fn 形态/基类值) 与宿主 fn 的 .prototype 成员读
 *  （member.ts Bug 92 分支）必须同引用，`Object.getPrototypeOf(g) ===
 *  Function.prototype` 才能折 exact true；两套表示（fn 面 facade vs
 *  obj 面 protoBrandAbs("Function")）曾让恒等折 wrong-exact false。 */
let functionProtoCache: Abs | undefined;
export function functionProtoAbs(): Abs {
  if (!functionProtoCache) {
    functionProtoCache = absFunction([], { body: noBody }, { ctor: false });
  }
  return functionProtoCache;
}

/**
 * Bug 321：**Error 家族原型**的自有数据属性 name / message。
 * 原生（node v26 实测 `Object.getOwnPropertyNames(X.prototype)`）：
 *   Error → ["constructor","name","message","toString"]
 *   TypeError / RangeError / SyntaxError / ReferenceError / EvalError /
 *   URIError / AggregateError → ["constructor","name","message"]
 * 八个家族原型**都**有自有 `name`（值 = 家族名）与 `message`（值 = ""），
 * 描述符 {writable:true, enumerable:false, configurable:true}。
 * 其余内建原型**无**自有 name/message（Array.prototype / Object.prototype /
 * Map.prototype / Promise.prototype… 的 gOPN 里没有）——故本表只列 Error
 * 家族。（Function.prototype 有自有 name 但无 message——原生面单列，不在
 * 本表：protoBrandAbs 的 Function 面另走 functionProtoAbs 的 fn 面。）
 */
const ERROR_FAMILY_PROTO_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
]);

export function protoBrandAbs(ctorName: string): Abs {
  // Object.prototype 与 objectProtoBrand() 单例同身份（constructor 槽 +
  // 不可枚举标记），分身会让 === 恒等丢精度
  if (ctorName === "Object") return objectProtoBrand();
  let a = protoBrandByName.get(ctorName);
  if (!a) {
    // Bug 321：Error 家族原型带**自有数据属性** name / message（原生同上）——
    // 此前原型面只装 constructor 槽 ⇒ `hasOwnProperty("name")` /
    // `Object.hasOwn(prototype,"name")` / `"name" in prototype` 全折 false
    // （原生 true）。槽装**内层 obj**（原型对象的自有面 = 内层槽面）。
    const isErrFamily = ERROR_FAMILY_PROTO_NAMES.has(ctorName);
    const slots: Record<string, { value: Abs }> = {
      constructor: { value: builtinCtorAbs(ctorName) },
    };
    if (isErrFamily) {
      slots.name = { value: strLit(ctorName) };
      slots.message = { value: strLit("") };
    }
    const inner = objOf(slots);
    a = abs(
      {
        k: "brand",
        name: `${ctorName}.prototype`,
        shape: inner,
      },
      undefined,
      undefined,
      "exact",
    );
    // 原生：类 / 内建构造器的 prototype 上的 `constructor` 是**不可枚举**
    // 数据属性（{writable:true, enumerable:false, configurable:true}）⇒
    // for-in / Object.keys 看不到它。缺这个标记 ⇒ 引擎把 `constructor`
    // 当可枚举键发布（`for (const k in A.prototype)` 得 ["constructor"]，
    // 原生是 []）。
    setPropFlags(a, "constructor", { enumerable: false, writable: true, configurable: true });
    if (isErrFamily) {
      // Bug 321：name / message 同为**不可枚举**数据属性（原生描述符
      // enumerable:false）——标记与 `constructor` 同挂**brand 自身**
      // （枚举视图 isNonEnumerable 与 propertyIsEnumerable 的 flags 兜底
      // 都读 brand 的表；挂内层会顶掉 propertyIsEnumerable 对
      // `constructor` 的品牌级标记）。
      setPropFlags(a, "name", { enumerable: false, writable: true, configurable: true });
      setPropFlags(a, "message", { enumerable: false, writable: true, configurable: true });
    }
    protoBrandByName.set(ctorName, a);
  }
  return a;
}

/**
 * Bug 328：%TypedArray%.prototype 的引擎名（TypedArray 家族原型的父原型）。
 * 原生 `Object.getPrototypeOf(Uint8Array.prototype)` 是 %TypedArray%.prototype
 * （再上一级才是 Object.prototype）——引擎用同一驻留 brand 表达 ⇒ 家族内
 * 任意两族的原型恒等（原生同款）。
 */
const TYPED_ARRAY_PROTO_NAME = "TypedArray";

/**
 * Object.getPrototypeOf 的具体原型投影（constructor 链可解）。
 * null-proto → null 字面量；不可判形态 → unknown（不假装精确原型）。
 */
export function protoOfRecv(a: Abs): Abs {
  const s = a.shape;
  const nullProtoLit = abs(
    { k: "unknown" },
    { op: "lit", value: null },
    pTrue,
    "exact",
  );
  if (s.k === "tuple" || s.k === "arr") return protoBrandAbs("Array");
  if (s.k === "prim") {
    const ctor =
      s.type === "number"
        ? "Number"
        : s.type === "string"
          ? "String"
          : s.type === "boolean"
            ? "Boolean"
            : s.type === "bigint"
              ? "BigInt"
              : s.type === "symbol"
                ? "Symbol"
                : undefined;
    return ctor ? protoBrandAbs(ctor) : unknown;
  }
  if (s.k === "fn") {
    // Bug 307：Function.prototype 自身的 [[Prototype]] 是 Object.prototype
    //（原生 `Object.getPrototypeOf(Function.prototype) === Object.prototype`
    // 为 true、`typeof` 折 "object"）——通用 fn 臂把「自己」当原型返回
    //（wrong-exact false + typeof "function"）。驻留单例比对即可精确识别
    //（用户函数的原型仍是 Function.prototype，走下方通用臂）。
    if (a === functionProtoAbs()) return objectProtoBrand();
    return functionProtoAbs();
  }
  if (s.k === "eff" && s.eff === "promise") return protoBrandAbs("Promise");
  if (s.k === "brand") {
    if (s.name === "Object.prototype") return nullProtoLit;
    // Bug 56/57：arguments 的 [[Prototype]] 是 Object.prototype；Proxy 的
    // [[Prototype]] 即靶的（[[GetPrototypeOf]] 透明转发）
    if (s.name === "Arguments") return objectProtoBrand();
    if (s.name === "Proxy") return protoOfRecv(s.shape);
    // Bug 58：类值（$class markClassValue / builtinCtorAbs）——[[Prototype]]
    // 是父构造器（派生）或 Function.prototype（基类），不是实例原型。
    // 父构造器取注册类值（=== 引用恒等折 exact）；内建父（Error 等）标识符
    // 读出是宿主 fn 面——brand 折叠会与 fn 面 === 折错精确 false（原生
    // true），保守 unknown（抽象优于 wrong-exact）。
    if (classNameOfValue(a as object) !== undefined) {
      const spec = getEvalClass(s.name);
      const superName = (spec?.superName ?? BUILTIN_ERROR_SUPER[s.name]) || undefined;
      if (superName) {
        return lookupClassValue(superName) ?? unknown;
      }
      // 基类值（含 extends null——[[Proto]] 仍 Function.prototype）
      return functionProtoAbs();
    }
    // Bug 67/64：类原型品牌（protoBrandAbs）——owner 类的 extends 决定
    // [[Prototype]]：extends null → null；extends A → A.prototype（内建
    // 父走 BUILTIN_ERROR_SUPER：RangeError.prototype → Error.prototype）；
    // 基类 → Object.prototype
    if (s.name.endsWith(".prototype")) {
      const owner = s.name.slice(0, -".prototype".length);
      const spec = getEvalClass(owner);
      if (spec) {
        if (spec.superNull) return nullProtoLit;
        if (spec.superName) {
          // P3b：fn 伪父——父原型是 fn 的驻留 prototype（同一 Abs 引用，
          // gPo(B.prototype) === Base.prototype 折 exact）；注册类值名面
          // 走既有 protoBrandAbs。
          const pcv = lookupClassValue(spec.superName);
          if (pcv && pcv.shape.k === "fn") return fnProtoOf(pcv);
          return protoBrandAbs(spec.superName);
        }
        return objectProtoBrand();
      }
      const be = BUILTIN_ERROR_SUPER[owner];
      if (be) return be ? protoBrandAbs(be) : objectProtoBrand();
      // Bug 328：内建原型的 [[Prototype]] **不都是** Object.prototype——
      // TypedArray 家族（Uint8Array/Int8Array/Float64Array/BigInt64Array…）
      // 继承 %TypedArray%.prototype（其上才是 Object.prototype）。此前
      // 一律折 Object.prototype ⇒ 原型链压扁一级：
      // `Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype`
      // 折 exact true（原生 false），二级链反向也错（原生 true / 引擎
      // false）。原生 oracle 逐个核对：其余内建原型（Map/Set/Date/RegExp/
      // Promise/ArrayBuffer/DataView/URL/…）确为 Object.prototype 直系
      // ⇒ 保留既有折法（退 unknown 会丢正确精度）。
      if (typedArrayElementOf(owner)) return protoBrandAbs(TYPED_ARRAY_PROTO_NAME);
      return objectProtoBrand();
    }
    return protoBrandAbs(s.name);
  }
  if (s.k === "obj") {
    if (isNullProtoObj(a)) return nullProtoLit;
    // Bug 41：open obj（Object.create(<obj>) / setProtoAbs 产物）原型不保证
    // 是 Object.prototype——不得折共享单例（gPo(create({x:1})) ===
    // gPo(create({x:1})) 会假折 true，differential 语料钉 native=false）。
    // setProtoAbs 记录过的 protoTable 优先；未记录 → 保守 unknown。
    if ((s as { open?: boolean }).open) {
      return getProtoAbs(a) ?? unknown;
    }
    return objectProtoBrand();
  }
  return unknown;
}

export const OBJECT_PROTO_METHOD_NAMES = new Set([
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "valueOf",
  "toString",
  "toLocaleString",
  // Bug 164：legacy 四访问器（`Object.getOwnPropertyNames(Object.prototype)`
  // 实测恒有）——此前**只**登记在 `in` 判定用的那张表（member-diag.ts 的
  // `OBJECT_PROTO_NAMES`，Bug 15 补的），**值读面**这张表漏了 ⇒
  // `({}).__defineGetter__ === undefined` 折 exact undefined（假绿）而
  // `"__defineGetter__" in {}` 折 true ⇒ 同一引擎两面结论相反。
  // 两张表必须同口径（`__proto__` / `constructor` 走专门臂，不在此列）。
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

let objectProtoSingleton: Abs | undefined;

/** Object.prototype 单例（$get(Object, "prototype") 与 host Object.prototype 共用）。
 *  带 constructor 槽（不可枚举）供 `.constructor` / `.constructor.name` 链折叠。 */
export function objectProtoBrand(): Abs {
  if (!objectProtoSingleton) {
    const a = abs(
      {
        k: "brand",
        name: "Object.prototype",
        shape: objOf({ constructor: { value: builtinCtorAbs("Object") } }),
      },
      undefined,
      undefined,
      "exact",
    );
    setPropFlags(a, "constructor", { enumerable: false, writable: true, configurable: true });
    objectProtoSingleton = a;
  }
  return objectProtoSingleton;
}

export function isObjectProtoBrand(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "brand" && a.shape.name === "Object.prototype";
}

