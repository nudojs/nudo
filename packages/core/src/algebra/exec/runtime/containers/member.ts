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
 */
import type { Abs } from "../../../abs.ts";
import { abs, confJoin, litValue, numLit, str, strLit, unknown } from "../../../abs.ts";
import { lit } from "../../../term.ts";
import { absFunction, hostFnCtorFacet } from "../../../abs-fn.ts";
import {
  joinAbs,
  isObj,
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
  objectProtoBrand,
  builtinCtorAbs,
  ctorNameOfRecv,
  protoBrandAbs,
  protoOfRecv,
  makeIntlCtorAbs,
} from "../../../builtins.ts";
import { arrayMethodAbs } from "../../../builtins/array.ts";
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
import { markFreshInstance } from "../../../instance-id.ts";
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
} from "../state.ts";
import { $typeof } from "../ops.ts";
import { findClassAccessor, findStaticClassAccessor, $in, BUILTIN_BRAND_METHODS, BUILTIN_BRAND_ACCESSORS, ITERABLE_BRANDS, evalClassChain, builtinSuperCtorOf, chainProtoSlotOf, classChainHasHole, chainHasOpaqueFnParent } from "../members.ts";
import { lookupObjAccessor } from "../../../accessors.ts";
import { $call } from "../../call.ts";
import { privateNameGuard, $setProto } from "./obj.ts";
import { widenTupleToArr } from "./arr-make.ts";
import { $len } from "./arr-index.ts";

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
  ["Float16Array", Float16Array],
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
  const fn = markFreshInstance(absFunction(params ?? [], { body: noBody }, { ctor: false }));
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

/** 成员读：obj.slots[key]；缺失 → undefined 字面量；brand 解包内层 */
export function $get(
  o: Abs,
  key: string,
  opts?: { /** 调用方已负责诊断（如 $invoke） */ silent?: boolean },
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
      if (ns) return protoBrandAbs(ns);
    }
    // Bug 44：Intl 两个格式化构造器——带 locale 校验的构造器值（fn name
    // "Intl.<Sub>" → $new 按名派发 evalBuiltinNew；调用面 apply 同 builder）
    if (ns === "Intl" && (key === "NumberFormat" || key === "DateTimeFormat")) {
      return makeIntlCtorAbs(key);
    }
    if (ns) {
      try {
        const raw = (o as Record<string, unknown>)[key];
        if (typeof raw === "function") {
          // Bug 44：宿主成员函数的可构造性 facet 透传（hostFnCtorFacet）——
          // 成员值被 $new 时不再记假 may TypeError（Intl.Collator 等原生可
          // 构造成员；Math.max 等方法值原生确定不可构造 → ctor:false 定抛）
          const ctor = hostFnCtorFacet(raw);
          return absFunction([`${ns}.${key}`], {
            body: noBody,
            apply: (args) => evalNamespaceCall(ns, key, args) ?? unknown,
          }, ctor !== undefined ? { ctor } : undefined);
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
        // 箭头/async/generator（去种类化宿主函数）原生无 prototype → undefined
        if (fn.prototype === undefined || hostFnCtorFacet(o as never) === false) {
          return undef();
        }
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
    // Bug 57/71：Proxy——get 陷阱优先（handler 提供 → $call 派发，实参
    // (target, key, receiver)、this = handler）；无陷阱回退**靶读取**
    //（inner 即 target Abs——含靶原型链）；陷阱不可判/不可调用 → 诚实
    // unknown（原生是每次触达 TypeError，sound 降级）
    if (o.shape.name === "Proxy") {
      const parts = proxyPartsOf(o);
      if (parts) {
        const trap = proxyTrapOf(parts.handler, "get");
        if (trap.k === "fn") {
          return $call(trap.fn, [parts.target, strLit(key), o], parts.handler);
        }
        if (trap.k === "dead" || trap.k === "opaque") {
          recordMayThrow({ kind: "TypeError", cause: `Proxy get trap for '${key}' not callable / unknown` });
          return unknown;
        }
        return $get(parts.target, key, opts);
      }
      // 无侧表（退化副本）：沿通用 brand 内层（inner = target）路径
    }
    if (o.shape.name.endsWith(".prototype")) {
      const ctorName = o.shape.name.slice(0, -".prototype".length);
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
      // P3b：constructor → 注册类值优先（B.prototype.constructor === B 折
      // exact——protoBrandAbs 的 constructor 槽是 builtinCtorAbs 名义面，
      // 与 $class 类值不同引用）。类值/内建名未注册 → 沿旧口径。
      if (key === "constructor") {
        const cv = lookupClassValue(ctorName);
        if (cv) return cv;
      }
    }
    const isClassVal = classNameOfValue(o as object) === o.shape.name;
    // 内建 brand 原型方法读取（typeof m.forEach / m[Symbol.iterator]）：
    // Bug 13：具名方法值走方法值读通道——protoMethodValueAbs 的 apply 钩子
    // 把借用调用（m.get.call(m,k) / .apply / .bind 产物）转发回 $invoke 既有
    // 派发；此前 no-op fn 被直接调用折精确 undefined。@@iterator 维持 no-op
    // 形状（迭代协议派发另走，与数组臂同口径）。
    // （class 声明值同名内建时不误伤：类方法走 registry）
    const builtinM = BUILTIN_BRAND_METHODS[o.shape.name];
    // Bug 40：@@iterator 只对原生可迭代 brand（Map/Set/TA，ITERABLE_BRANDS）
    // 折函数——此前任意有表 brand（Date/WeakMap/Error…）都折 "function"，
    // 非可迭代 brand 原生 undefined（wrong-exact）。
    if (builtinM && !isClassVal && (builtinM.has(key) || (key === "@@iterator" && ITERABLE_BRANDS.has(o.shape.name)))) {
      if (key !== "@@iterator") return protoMethodValueAbs(o.shape.name, key);
      return absFunction([], { body: noBody }, { ctor: false });
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
      if (sacc) return sacc.get ? sacc.get(o) : undef();
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
          if (spec?.staticMethods?.[key]) {
            return classMethodValueAbs(spec, "static", key, spec.staticMethodParams?.[key]);
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
      if (acc) return acc.get ? acc.get(o) : undef();
      // 实例上读静态访问器键 → 原生 undefined（属性在构造器上）
      if (findStaticClassAccessor(o.shape.name, key)) return undef();
      // 实例方法读取（typeof a.m / 一等值）：沿继承链在 registry 找方法
      // 未调用方法槽带 AST 形参展示名（不再假零参）。
      // P2a：驻留按（定义 spec, 键）——a.m 与 b.m（跨实例/跨派生）解析到
      // 同一 spec 条目返回同一函数 Abs（原生挂 .prototype，=== 折 true）。
      for (const n of evalClassChain(o.shape.name)) {
        const spec = getEvalClass(n);
        if (spec?.methods?.[key]) {
          return classMethodValueAbs(spec, "inst", key, spec.methodParams?.[key]);
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
    // 类值接收者不经此（B.constructor 原生继承 Function——保持既有口径）。
    if (key === "constructor") {
      const cn = ctorNameOfRecv(o);
      if (cn) {
        if (!isClassVal) {
          const cv = lookupClassValue(cn);
          if (cv) return cv;
        }
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
    // Bug 40：已知原型访问器名（BUILTIN_BRAND_ACCESSORS，$in presence 表）
    // 的值读若槽面未建模 → 诚实 unknown——不得落闭 obj 槽 miss 折精确
    // undefined（`typeof ab.detached` / `typeof ta.buffer` 曾断言成员缺席，
    // wrong-exact）。own 槽已在上方优先（byteLength/resizable 等精确面
    // 不回退）；类值（isClassVal）走静态面，不在此列。
    if (!isClassVal && BUILTIN_BRAND_ACCESSORS[o.shape.name]?.has(key)) {
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
      return typeof nm === "string" && nm ? strLit(nm) : str();
    }
    if (key === "length") return $len(o);
    if (key === "prototype") {
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
    // string.toString/valueOf 由 callAbsMethod 处理调用；一等读取仍给 OP 函数
    if (
      primProtoMethods?.has(key) === true &&
      (!OBJECT_PROTO_METHOD_NAMES.has(key) ||
        // 唯一例外：string prim 的 toString（此前被显式排除落 unknown，
        // Bug 49 值读面）——OP 泛型 toString 会折 "[object String]"，走
        // prim 通道才有 String.prototype.toString 域
        ((o.shape as { type?: string }).type === "string" && key === "toString"))
    ) {
      // Bug 49：prim 专有原型方法（trim/toFixed/…）——方法值读通道：
      // apply 钩子转发 callAbsMethod 既有派发
      return protoMethodValueAbs((o.shape as { type: string }).type, key);
    }
    return objectProtoMethodAbs(key);
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
    return o;
  }
  if (o.shape.k === "brand") {
    // Bug 71：Proxy——set 陷阱优先（实参 (target, key, value, receiver)、
    // this = handler）；返回字面量 false → strict TypeError（硬抛，catch 可
    // 吸收）；无陷阱回转发写靶（原地；brand inner 即 target 引用，身份不
    // 变）。陷阱体内 t[k]=v 经 $set 原地突变对代理读可见
    if (o.shape.name === "Proxy") {
      const parts = proxyPartsOf(o);
      if (parts) {
        const trap = proxyTrapOf(parts.handler, "set");
        if (trap.k === "fn") {
          const res = $call(trap.fn, [parts.target, strLit(key), value, o], parts.handler);
          const rv = litValue(res);
          if (rv.ok && rv.value === false) throwStrictWrite();
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
    if (extStateOf(o) === "frozen") throwStrictWrite();
    const vR = litValue(value);
    const v = vR.ok ? vR.value : undefined;
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
    const vR = litValue(value);
    const v = vR.ok ? vR.value : undefined;
    // 抽象数组也是数组：非法 length 字面量同样原生 RangeError
    if (typeof v === "number" && (!Number.isInteger(v) || v < 0 || v > 4294967295)) {
      throw new NudoThrow(errorTypeAbs("RangeError"));
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
