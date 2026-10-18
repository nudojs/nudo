/**
 * 调用派发总入口：$invoke(recv, method, args)。
 *
 * Invariants:
 * - protoMethodDispatch 注册语句在本模块体**加载期**执行且必须直连
 *   containers/member.ts（不经 barrel——vite SSR 下 re-export 不是
 *   实例化期可用绑定；原单文件拓扑中 setter 是提升函数声明）。
 * - 数组方法（map/filter/reduce/…）委派 invokeArrMethod（invoke-arr.ts）；
 *   mutator 语句快路径在 transpile 层（emitArrMutatorRebinds），两条路径
 *   的元素域语义必须同口径（issue #153：SpreadElement 折 $unknown 的教训）。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown, litValue, strLit } from "../../abs.ts";
import { joinAbs, getSlot, propertyKeyOf } from "../../objects.ts";
import { TYPED_ARRAY_CALLBACK_METHODS, builtinSuperCtorOf, brandHasProtoMember, classChainHasHole } from "../runtime/members.ts";
import { typedArrayElementOf } from "../../builtins/shared.ts";
import { typedArrayEnumKeyView } from "../../builtins/object/enum-entries.ts";
import { MAX_CONCRETE_LOOP_ITERS } from "../runtime/loop-budget.ts";
import { $get, $lit, namespaceNameOf, callAtFunctionBoundary } from "../runtime.ts";
import { withNewTargetReset, undef, asAbsVal } from "../runtime/state.ts";
import { $call } from "../call.ts";
import { callHostGlobalFn } from "../calls.ts";
import { getFnImpl, absFunction, hostFnCtorFacet } from "../../abs-fn.ts";
import { evalNamespaceCall, evalBuiltinInstanceMethod, isSymbolAbs, stringOfSymbol, evalPromiseMethod, boxedPrimitiveValue, sumHasPrimMember, evalArrayStatic, collectionIteratorAbs, abstractSeqIteratorAbs } from "../../builtins.ts";
import { isErrorCtorName } from "../../builtins/error.ts";
import {
  validateCallableArg,
} from "../../hof.ts";
import { privateNameGuard } from "../runtime/containers.ts";
// 直连 member.ts（不经 containers barrel）：本模块体加载期即回调本 setter，
// vite SSR 下 barrel 的 re-export 不是实例化期可用绑定（原单文件拓扑中
// setter 是本模块提升函数声明）。barrel 间接层会在此处拿到 undefined。
import { setProtoMethodDispatch } from "../runtime/containers/member.ts";
import {
  noteEvalCallRecord,
} from "../calls.ts";
import {
  notePrimMemberMissing,
  noteUnknownMemberMissing,
  noteAnyMemberMayThrow,
  noteNullishMemberThrows,
  anyMemberResult,
  definitelyUncallableMember,
  BIGINT_PROTO_METHODS,
  OBJECT_PROTO_NAMES,
} from "../member-diag.ts";
import { errorTypeAbs, throwPayloadOf, recordMayThrow } from "../may-throw.ts";
import { isNullishLitAbs } from "../../surface.ts";
import { NudoThrow, $collectionForEach } from "../runtime.ts";
import { callAbsMethod } from "../../methods.ts";
import {
  classNameOfValue,
} from "../class-registry.ts";

import { invokeArrMethod } from "./invoke-arr.ts";
import { findMethod, findStaticMethod, instanceOwnFaceHasMember, chainHasStaticMember } from "./declare.ts";
import { runtimeAssignObject } from "./assign.ts";
import { execRegexBrand, stringRegexMethod } from "../class-regex.ts";

/**
 * Bug 107：Number.prototype digits/radix 字面量实参域检查（接收者无关——
 * 提升于接收者字面量守卫之前）。非字面量实参直接 return——各方法臂既有
 * recordMayThrow 口径不变。toLocaleString/valueOf 不转换实参，不在面内。
 */
function enforceNumProtoArgDomain(method: string, argAbs: Abs | undefined): void {
  if (
    method !== "toFixed" &&
    method !== "toExponential" &&
    method !== "toPrecision" &&
    method !== "toString"
  ) {
    return;
  }
  if (argAbs === undefined) return;
  if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (argAbs.term?.op !== "lit") return;
  const v = argAbs.term.value;
  if (v === undefined) return; // 显式 undefined ≡ 缺省
  if (typeof v === "bigint") throw new NudoThrow(errorTypeAbs("TypeError")); // ToNumber(1n) 定抛
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" || typeof v === "boolean" || v === null) n = Number(v);
  else return;
  if (Number.isNaN(n)) n = 0; // ToIntegerOrInfinity(NaN) = +0（node 实测 (1.5).toFixed(NaN) === "2"）
  else n = Math.trunc(n); // 截断（100.9 → 100 合法）
  let bad: boolean;
  if (method === "toFixed" || method === "toExponential") bad = !(n >= 0 && n <= 100);
  else if (method === "toPrecision") bad = !(n >= 1 && n <= 100);
  else bad = !(n >= 2 && n <= 36); // toString radix
  if (bad) throw new NudoThrow(errorTypeAbs("RangeError"));
}

/** 实例方法调用：沿继承链；类 Abs 上回落 staticMethods；obj 上回落属性函数 */
export function $invoke(
  thisVal: Abs,
  method: string,
  args: Abs[],
  loc?: [number, number],
): Abs {
  // Bug 85：函数声明绑定是裸宿主函数（statement.ts 直发 host function），
  // 作实参流入 Object/Reflect 静态、$in、JSON.stringify、强制转换全局的
  // Abs 解引用点 → 内部 TypeError 冒泡（无 try 折 unknown / 有 try 被用户
  // catch 吞成引擎错误消息）。此处统一归一化实参（函数边界 prologue 的
  // $absVal 同口径，copy-on-write：全 Abs 时不分配新数组）。callee 位
  // （thisVal）不动——宿主函数直调路径依赖裸值 apply
  let normArgs = args;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as unknown;
    if (!(a && typeof a === "object" && "shape" in a)) {
      if (normArgs === args) normArgs = args.slice();
      normArgs[i] = asAbsVal(a);
    }
  }
  // Bug 79：方法调用是普通调用面——调用期间 new.target 读 undefined
  return withNewTargetReset(() => $invokeInner(thisVal, method, normArgs, loc));
}

// ---------------------------------------------------------------------------
// 计算键成员调用（obj[key]()，key 是运行时求值的非字面量键——标识符/调用/
// 成员链/Symbol 常量读等）。修复前 transpile 把这类 callee 落通用
// $call($idx(obj, key))：$call 无接收者通道 → 方法体 this 读失败 / 内建
// brand 校验假定抛 → 整调用折 never。此处键折叠成槽名后复用 $invoke 既有
// 派发（实例槽/原型链/类注册表，接收者绑 recv）。
// ---------------------------------------------------------------------------

/** well-known symbol lit → "@@name" 槽名。与 transpile 静态投影
 *  m[Symbol.iterator] → $get(m,"@@iterator")（expr/member.ts）同口径：按
 *  宿主 Symbol 静态位身份映射（well-known 的 description 是
 *  "Symbol.iterator"，不可直接当槽名用）；Symbol("x") / Symbol.for 的用户
 *  符号无槽名模型 → undefined。 */
const WELL_KNOWN_SYMBOL_SLOTS: ReadonlyMap<symbol, string> = (() => {
  const m = new Map<symbol, string>();
  for (const name of Object.getOwnPropertyNames(Symbol)) {
    const v = (Symbol as unknown as Record<string, unknown>)[name];
    if (typeof v === "symbol") m.set(v, `@@${name}`);
  }
  return m;
})();

/** 计算键 → 槽名：ToPropertyKey 字面量折叠（propertyKeyOf：数字/布尔/
 *  nullish → String(v)）在前，well-known symbol 投影兜底；抽象键 / 用户
 *  symbol → undefined（方法身份不可判）。 */
function invokeKeySlotOf(key: Abs): string | undefined {
  if (key.term?.op === "lit") {
    const v = key.term.value;
    if (typeof v === "symbol") return WELL_KNOWN_SYMBOL_SLOTS.get(v);
  }
  return propertyKeyOf(key);
}

/** @@iterator 协议面：tuple/arr/字符串接收者的迭代器对象不在 $invoke 派发
 *  内（原生 Array.prototype[Symbol.iterator] === values，%StringPrototype%
 *  上是字符串迭代器）——数组/元组复用 invokeArrMethod 的 values 臂（单一
 *  事实源，产 collectionIteratorAbs/abstractSeqIteratorAbs，可 .next()/
 *  spread）；字符串按 code point 展开（与 elemsOf 的字符串臂同口径）。
 *  obj 接收者（生成器 @@iterator 自返槽 / match-iter 侧表等）不由本臂
 *  接管，落 $invoke 的槽派发。 */
function iteratorFaceOf(recv: Abs): Abs | undefined {
  const s = recv.shape;
  if (s.k === "arr" || s.k === "tuple") {
    return invokeArrMethod(recv, "values", []);
  }
  let strRecv: Abs | undefined;
  if (s.k === "prim" && s.type === "string") {
    strRecv = recv;
  } else if (s.k === "brand" && s.name === "String") {
    // new String("ab")：拆箱后按字符串迭代（boxed → [[PrimitiveValue]]）
    const un = boxedPrimitiveValue(recv);
    if (un?.shape.k === "prim" && un.shape.type === "string") strRecv = un;
  }
  if (strRecv) {
    const svR = litValue(strRecv);
    const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
    if (sv !== undefined) {
      // 字面量字符串：code point 精确展开（[...sv] 按 Unicode 码点切，
      // 代理对不拆半）
      return collectionIteratorAbs([...sv].map((c) => strLit(c)));
    }
    // 抽象字符串：单代表 string 元素（长度不可知，与 arr 臂同口径）
    return abstractSeqIteratorAbs(
      abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
    );
  }
  return undefined;
}

/** obj[key]()：计算键成员调用（键运行时求值）。键折叠成槽名后走 $invoke
 *  既有派发；@@iterator 键按接收者形态折迭代器对象。键不可折叠（抽象键 /
 *  用户 symbol）→ 诚实 unknown（与 $call 对 unknown callee 同口径——
 *  unknown 是 fail-closed 令牌，不记 may-throw）。 */
export function $invokeKey(
  thisVal: Abs,
  key: Abs,
  args: Abs[],
  loc?: [number, number],
): Abs {
  const k = invokeKeySlotOf(key);
  if (k === undefined) return unknown;
  if (k === "@@iterator") {
    const it = iteratorFaceOf(thisVal);
    if (it !== undefined) return it;
  }
  return $invoke(thisVal, k, args, loc);
}

/** 可选链计算键调用（a?.[k]() / a[k]?.() 的非链路径）：nullish 接收者
 *  短路 undefined 字面量（$optionalInvoke 同口径）；键折叠与派发同
 *  $invokeKey。 */
export function $optionalInvokeKey(thisVal: Abs, key: Abs, args: Abs[]): Abs {
  if (
    thisVal?.term?.op === "lit" &&
    (thisVal.term.value === null || thisVal.term.value === undefined)
  ) {
    return abs(
      { k: "unknown" },
      { op: "lit", value: undefined },
      undefined,
      "exact",
    );
  }
  return $invokeKey(thisVal, key, args);
}

function $invokeInner(
  thisVal: Abs,
  method: string,
  args: Abs[],
  loc?: [number, number],
): Abs {
  // 私有方法调用（"#" 键）：foreign-receiver brand check
  // （原生 PrivateCall：接收者必须是声明类实例）
  privateNameGuard(thisVal, method);
  // Function.prototype.call/apply/bind：fn Abs **或** 求值引擎 JS 函数（P1）
  if (method === "call" || method === "apply" || method === "bind") {
    // apply 第二参：tuple 精确展开；JS 数组逐项；Abs arr 长度未知 → 单 element
    // （类型层欠近似）；null/undefined → 无参（JS 语义）；其它 → unknown 槽位
    const expandApplyArgs = (list: unknown): Abs[] => {
      if (list === null || list === undefined) return [];
      if (Array.isArray(list)) {
        return list.map((x) =>
          x && typeof x === "object" && "shape" in (x as object)
            ? (x as Abs)
            : unknown,
        );
      }
      if (typeof list === "object" && "shape" in (list as object)) {
        const a = list as Abs;
        const s = a.shape;
        if (s.k === "tuple") return [...s.elements];
        if (s.k === "arr") return [s.element];
        // Bug 17：原生 CreateListFromArrayLike 要求 argArray 是 Object——
        // 非 nullish 原始值（1/"ab"/true/1n/symbol）确定 TypeError（hard）；
        // nullish 字面量（shape k:"unknown"+lit）→ 无参；any/unknown/含 prim
        // 成员 union → may TypeError；obj/fn/brand 全定（[unknown] 欠近似，
        // 闭对象无 length 槽 → 精确 0 参）
        if (isNullishLitAbs(a)) return [];
        if (s.k === "prim") {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        if (s.k === "any" || s.k === "unknown" || sumHasPrimMember(a)) {
          recordMayThrow({
            kind: "TypeError",
            cause: "Function.prototype.apply argArray may not be an object",
          });
        }
        if (s.k === "obj" && s.open !== true) {
          const lenAbs = getSlot(s.slots, "length")?.value;
          if (!lenAbs || isNullishLitAbs(lenAbs)) return [];
          const lv = litValue(lenAbs);
          if (lv.ok && lv.value === 0) return [];
        }
        return [unknown];
      }
      return [unknown];
    };
    /** bind 后剩余形参：尽量保留原 params 面（dts/inlay） */
    const boundFnParams = (fnVal: unknown, boundCount: number): string[] => {
      if (fnVal && typeof fnVal === "object" && "shape" in (fnVal as object)) {
        const s = (fnVal as Abs).shape;
        if (s.k === "fn" && Array.isArray(s.params)) {
          return s.params.slice(boundCount);
        }
      }
      if (typeof fnVal === "function") {
        const arity = (fnVal as { length?: number }).length ?? 0;
        const rem = Math.max(0, arity - boundCount);
        return Array.from({ length: rem }, (_, i) => `_a${boundCount + i}`);
      }
      return ["_rest"];
    };
    if (typeof thisVal === "function") {
      const fn = thisVal as (...a: Abs[]) => Abs;
      // Bug 26：宿主全局函数接收者（parseInt.call(null, "1") 等）——Abs
      // 实参直喂宿主函数产 ToPrimitive 假值；经桥按被调用位语义分派
      //（thisArg 对宿主全局无意义，原生忽略）
      if (method === "call") {
        const bridged = callHostGlobalFn(thisVal, args.slice(1));
        if (bridged !== undefined) return bridged;
        // thisArg（Abs）作为宿主 this 传入；函数体 prologue $rawThis(this) 承接。
        // 缺 thisArg（call() 无实参）→ 宿主 undefined ≡ strict this undefined。
        return callAtFunctionBoundary(() => fn.apply(args[0] as never, args.slice(1)));
      }
      if (method === "apply") {
        const bridged = callHostGlobalFn(thisVal, expandApplyArgs(args[1]));
        if (bridged !== undefined) return bridged;
        return callAtFunctionBoundary(() => fn.apply(args[0] as never, expandApplyArgs(args[1])));
      }
      const boundThis = args[0];
      const bound = args.slice(1);
      // Bug 9：bind 产物可构造性随目标（目标可构造 → bound 可构造）
      const hostFacet = hostFnCtorFacet(thisVal);
      return absFunction(
        boundFnParams(thisVal, bound.length),
        {
          apply: (callArgs) => {
            // Bug 26：宿主全局 bind 产物同样经桥（boundThis 宿主全局原生忽略）
            const bridged = callHostGlobalFn(thisVal, [...bound, ...callArgs]);
            if (bridged !== undefined) return bridged;
            return callAtFunctionBoundary(() => fn.apply(boundThis as never, [...bound, ...callArgs]));
          },
        },
        hostFacet !== undefined ? { ctor: hostFacet } : undefined,
      );
    }
    if (thisVal && typeof thisVal === "object" && "shape" in thisVal) {
      const fnImpl = getFnImpl(thisVal);
      const isCallable = thisVal.shape.k === "fn" || fnImpl !== undefined;
      if (isCallable) {
        // Bug 46：thisArg 统一经 $call 第三参传递——bindThis impl（对象方法）
        // 由 $call 派发注入首参；普通 fn 经 apply 钩子进宿主 this。
        // 缺 thisArg（call() 无实参）→ undefined ≡ strict this undefined。
        if (method === "call") {
          return $call(thisVal, args.slice(1), args[0]);
        }
        if (method === "apply") {
          return $call(thisVal, expandApplyArgs(args[1]), args[0]);
        }
        const boundThis = args[0];
        const bound = args.slice(1);
        // Bug 9：bind 产物可构造性随目标（fn facet 传播；类 brand 可构造）
        const tShape = (thisVal as Abs).shape;
        const boundCtor =
          tShape.k === "fn" ? tShape.ctor : tShape.k === "brand" ? true : undefined;
        return absFunction(
          boundFnParams(thisVal, bound.length),
          {
            apply: (callArgs) =>
              callAtFunctionBoundary(() =>
                $call(thisVal, [...bound, ...callArgs], boundThis),
              ),
          },
          boundCtor !== undefined ? { ctor: boundCtor } : undefined,
        );
      }
    }
  }
  // 宿主 JS 命名空间对象（Math/Number/JSON…）→ Abs builtin 表
  if (!thisVal || typeof thisVal !== "object" || !("shape" in thisVal)) {
    const ns = namespaceNameOf(thisVal);
    if (ns === "Object" && method === "assign") {
      return runtimeAssignObject(args);
    }
    return (ns ? evalNamespaceCall(ns, method, args) : undefined) ?? unknown;
  }
  // Promise 实例方法（then/catch/finally）：映射 resolved 通道
  if (thisVal.shape.k === "eff" && thisVal.shape.eff === "promise") {
    const pr = evalPromiseMethod(method, thisVal, args);
    if (pr !== undefined) return pr;
  }
  // union：只在「声称支持」该方法的成员上派发，再 join（string|Buffer.split
  // 不应因 Buffer 分支无 split 而整体 unknown）
  if (thisVal.shape.k === "sum") {
    const results = thisVal.shape.members
      .filter((m) => memberLikelyHasMethod(m, method))
      .map((m) => $invoke(m, method, args, loc));
    if (results.length === 0) return unknown;
    return results.reduce((a, b) => joinAbs(a, b));
  }
  // RegExp brand exec/test（字面量 pattern 精确执行）
  {
    const reR = execRegexBrand(thisVal, method, args);
    if (reR !== undefined) return reR;
  }
  const brandName = thisVal.shape.k === "brand" ? thisVal.shape.name : undefined;
  if (brandName) {
    // Bug 22：装箱 brand（new String/Number/Boolean / Object(prim)）实例方法
    // → 拆箱 [[PrimitiveValue]] 后走 prim 方法面（charAt/toFixed/… 的字面量
    // 折叠与抽象臂全复用；valueOf/toString 原生语义即包装原始值的同名方法）
    const boxedPrim = boxedPrimitiveValue(thisVal);
    if (boxedPrim) {
      return $invokeInner(boxedPrim, method, args, loc);
    }
    // Bug 36：TypedArray 原型回调族（forEach/map/filter/reduce/reduceRight/
    // every/some/find/findIndex/findLast/findLastIndex）。TA 实例是 $new 兜底
    // 的空 brand（长度/条目不建模），evalBuiltinInstanceMethod 与
    // BUILTIN_BRAND_METHODS 此前皆无 TA 条目——HOF 调用落 $get → undef →
    // unknown：回调静默不跑（副作用计数器折 wrong-exact 0）、GetCallback
    // 校验缺失（非函数回调不抛、L2 假阴）。按抽象数组视图复用数组 HOF
    // 机器（invokeArrMethod，单一事实源）：元素域 = TYPED_ARRAY_ELEMENT 的
    // prim（BigInt64/BigUint64 → bigint），各分支内置 validateCallableArg
    //（零迭代也定抛）+ 代表元素回调执行（副作用/抛错传播）+ 返回面对齐
    // 数组口径。回调收到的第 3 实参（数组本尊）是本视图而非 TA brand——
    // instanceof 面的诚实不精确（长度未建模同源）。map 原生结果 = 同族
    // TA，元素经 ToNumber/ToBigInt 收敛回元素 prim（回调返回 string 不渗入
    // 元素域）；回调返回 symbol/number↔bigint 交 ConvertThrow 面未建模
    //（同长度口径，接受）。
    const taElem = typedArrayElementOf(brandName);
    if (taElem && TYPED_ARRAY_CALLBACK_METHODS.has(method)) {
      const taElemPrim = abs(
        { k: "prim", type: taElem },
        undefined,
        undefined,
        "exact",
      );
      // Bug 100：按已知计数建视图——TA 内层 length 槽（makeTypedArrayAbs
      // 数字形态 Bug 38 / 字面量源形态 Bug 125 折入；typedArrayEnumKeyView
      // 与 keys/values/entries 同口径读）可知 → tuple 视图，invokeArrMethod
      // 的逐下标臂跑 length 次（回调计数/副作用精确；元素域仍是单代表
      // prim——值域 imprecision 保持既有口径）。抽象长度或超展开上限 →
      // 维持单代表元素 arr 视图（长度不可判的既有口径，回调只跑一次）。
      const lenView = typedArrayEnumKeyView(thisVal);
      const count = lenView?.k === "exact" ? lenView.count : undefined;
      const arrView =
        count !== undefined && count <= MAX_CONCRETE_LOOP_ITERS
          ? abs(
              {
                k: "tuple",
                elements: Array.from({ length: count }, () => taElemPrim),
              },
              undefined,
              undefined,
              thisVal.conf,
            )
          : abs(
              { k: "arr", element: taElemPrim },
              undefined,
              undefined,
              thisVal.conf,
            );
      const taR = invokeArrMethod(arrView, method, args);
      if (taR !== undefined) {
        if (method === "map") {
          // map 原生结果 = 同族 TA：元素经 ToNumber/ToBigInt 收敛回元素
          // prim（回调返回 string 不渗入元素域）；tuple 视图保长度精确
          //（Bug 100），抽象长度折 arr
          if (taR.shape.k === "tuple") {
            return abs(
              {
                k: "tuple",
                elements: taR.shape.elements.map(() => taElemPrim),
              },
              undefined,
              undefined,
              taR.conf,
            );
          }
          if (taR.shape.k === "arr") {
            return abs({ k: "arr", element: taElemPrim }, undefined, undefined, taR.conf);
          }
        }
        return taR;
      }
    }
    // 内建 brand 实例方法（Date/RegExp/Map/Set/Error 家族）：统一经 builtin 表分派。
    // 此前只对 Map/Set 调 evalBuiltinInstanceMethod，Date.getTime 等落到
    // findMethod 未命中 → 折 lit(undefined)，Number.isNaN(getTime()) 假 false。
    const viaBuiltin = evalBuiltinInstanceMethod(brandName, method, thisVal, args);
    if (viaBuiltin !== undefined) return viaBuiltin;
    // C1：Map/Set forEach（条目表回调）
    if ((brandName === "Map" || brandName === "Set") && method === "forEach") {
      // Bug 31：GetCallback 前置校验（空接收者零迭代也要抛）——Bug 55
      // 数组 HOF 同口径；此前回调可调用性只在 invokeCb 内经 $call 逐条目
      // 触发，空 Map/Set 与对象回调形态静默不抛（L2 假阴）。
      validateCallableArg(args[0], `${brandName}.prototype.forEach callback may not be callable`);
      const r = $collectionForEach(thisVal, args[0]);
      if (r !== undefined) return r;
    }
    const m = findMethod(brandName, method);
    if (m) {
      // 类实例方法调用点收集（T5）：`Class.method`
      let result: Abs = unknown;
      let threw = false;
      try {
        result = m(thisVal, ...args);
        return result;
      } catch (e) {
        threw = true;
        result = throwPayloadOf(e);
        throw e;
      } finally {
        noteEvalCallRecord({
          fnName: `${brandName}.${method}`,
          args,
          result,
          callLoc: loc ? { line: loc[0], column: loc[1] } : undefined,
          threw,
        });
      }
    }
    // Bug 18：静态方法沿 superName 继承链查找（空派生类 B.m() 不断链）。
    // N2：只对类值接收者派发——实例接收者的 [[Prototype]] 是 X.prototype，
    // 静态成员不在其链上（原生 a.staticM() 定抛 TypeError，此前误派发成
    // 静态结果）。
    if (classNameOfValue(thisVal as object) === brandName) {
      const sm = findStaticMethod(brandName, method);
      if (sm) {
        let result: Abs = unknown;
        let threw = false;
        try {
          // R5：接收者（thisVal = 调用类值）作 __this 首参注入——沿链
          // 调用时 this 是调用类（B.m() 继承 A.m：this === B）
          result = sm(thisVal, ...args);
          return result;
        } catch (e) {
          threw = true;
          result = throwPayloadOf(e);
          throw e;
        } finally {
          noteEvalCallRecord({
            fnName: `${brandName}.${method}`,
            args,
            result,
            callLoc: loc ? { line: loc[0], column: loc[1] } : undefined,
            threw,
          });
        }
      }
      // N2：内建父构造器静态调用（B extends Object → B.keys / E extends
      // Error → E.captureStackTrace）——宿主静态通道（$get namespace 投影
      // → $call，与直接 Object.keys 调用同派发面）。无通道（mock/桥接父
      // 类）→ 落下方通用诊断面（unknown，不折 undefined）。
      const sup = builtinSuperCtorOf(brandName);
      if (sup) {
        const prop = $get(sup.host as Abs, method);
        if (prop && prop.shape.k === "fn") {
          return $call(prop, args, thisVal);
        }
      }
    }
    // P4a：实例接收者 + 类注册面证明成员 STATIC-ONLY——实例的
    // [[Prototype]] 是 X.prototype（静态成员不在其链上），`c.m()` 原生
    // c.m === undefined → 调用确定 TypeError（N2 曾折 unknown 的精确化）。
    // 全部条件满足才抛，缺一即保守落通用诊断面：
    // - 接收者是实例（类值标记 ≠ brand——类值接收者走上方静态派发）；
    // - 实例继承链完整（classChainHasHole：extends 未注册父的原型面不可
    //   判定）；
    // - 实例面缺席：链上无方法/访问器/内建 brand 成员（brandHasProtoMember，
    //   findMethod 已 miss 是其子集）、无同名实例字段（instanceFields——
    //   字段值可能是函数）、接收者无自有槽（ctor `this.m = fn` 写入的
    //   承载者）；
    // - 非 Object.prototype 名（c.toString() 原生沿 OP 链恒可得，不得抛）；
    // - 静态面在场（chainHasStaticMember）——static-only 证明。这同时是
    //   保守门：内建 brand 的未建模真实原型方法（BUILTIN_BRAND_METHODS
    //   非全列）名不在任何静态面上，不会误抛。
    if (
      classNameOfValue(thisVal as object) !== brandName &&
      !classChainHasHole(brandName) &&
      !brandHasProtoMember(brandName, method) &&
      !OBJECT_PROTO_NAMES.has(method) &&
      !instanceOwnFaceHasMember(thisVal, brandName, method) &&
      chainHasStaticMember(brandName, method)
    ) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  // bigint 字面量：toString(radix)/valueOf 精确折叠——字面量实参真执行，
  // 非法 radix 原生 RangeError / 符号实参 TypeError 硬抛（catch 可吸收）
  if (thisVal.shape.k === "prim" && thisVal.shape.type === "bigint") {
    const bvR = litValue(thisVal);
    const bv = bvR.ok ? (bvR.value as bigint | undefined) : undefined;
    if (typeof bv === "bigint") {
      if (method === "valueOf") return thisVal;
      // toLocaleString：BigInt 原型真方法（M3 白名单成员）——宿主 ICU 真执行
      //（千分位随 locale 精确；此前落通用路径折 "[object BigInt]" 假精确）；
      // 实参不参与（ICU 路径不转换，symbol 实参原生不抛——Number 口径同）
      if (method === "toLocaleString") {
        try {
          const impl = BigInt.prototype as unknown as Record<string, (...a: unknown[]) => string>;
          return strLit(impl.toLocaleString.call(bv));
        } catch {
          return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
        }
      }
      if (method === "toString") {
        const argAbs = args[0];
        // Bug 65：radix 经 ToIntegerOrInfinity——symbol 按 shape 判定（无
        // lit 项）确定 TypeError；抽象 → may TypeError；字面量真执行
        // （RangeError catch 保留）
        if (argAbs !== undefined) {
          if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
          if (argAbs.term?.op !== "lit") {
            recordMayThrow({
              kind: "TypeError",
              cause: "BigInt.prototype.toString radix may not be convertible to a number",
            });
            return unknown;
          }
        }
        const avR = argAbs === undefined ? undefined : litValue(argAbs);
        const av = avR?.ok ? avR.value : undefined;
        try {
          return strLit(bv.toString(av as never));
        } catch (e) {
          if (e instanceof TypeError) throw new NudoThrow(errorTypeAbs("TypeError"));
          if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
          return unknown;
        }
      }
    } else if (method === "toLocaleString") {
      // 抽象 bigint：toLocaleString 恒成功（ICU 不转换实参）→ 抽象 string
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    } else if (method === "valueOf") {
      // Bug 105：抽象 bigint prim 的 valueOf = 接收者自身（thisBigIntValue
      // 恒成功）——此前落通用路径被 Object.prototype.toString 吞
      return thisVal;
    } else if (method === "toString") {
      // Bug 105：抽象 bigint prim 的 toString → BigInt.prototype.toString
      //（结果恒 string），不落 Object.prototype.toString（"[object Bigint]"
      // 假精确）。radix 实参口径与字面量接收者臂一致：symbol 定抛
      // TypeError、字面量真查域（ToIntegerOrInfinity 后 [2,36] 否则
      // RangeError）、抽象 may TypeError。
      const argAbs = args[0];
      if (argAbs !== undefined) {
        if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
        const avR = litValue(argAbs);
        const av = avR.ok ? avR.value : undefined;
        if (avR.ok && av !== undefined) {
          const radix = Math.trunc(Number(av));
          if (!Number.isFinite(radix) || radix < 2 || radix > 36) {
            throw new NudoThrow(errorTypeAbs("RangeError"));
          }
        } else if (!avR.ok) {
          recordMayThrow({
            kind: "TypeError",
            cause: "BigInt.prototype.toString radix may not be convertible to a number",
          });
        }
      }
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
    // 未接管的其它方法不得在此 return——继续后续诊断路径（M3：原型外
    // 方法名（toFixed 等）在下方定抛 TypeError；toLocaleString 等软保守）
  }
  // number 字面量：toString(radix)/toFixed/toExponential/toPrecision/valueOf
  // 精确折叠——字面量实参真执行（ToIntegerOrInfinity 截断、NaN→缺省等由原生
  // 处理），非法参数硬抛 RangeError、符号实参硬抛 TypeError；抽象实参保守。
  // 未接管的其它方法不得在此 return——继续后续诊断路径（no-method）。
  if (thisVal.shape.k === "prim" && thisVal.shape.type === "number") {
    if (method === "valueOf") return thisVal;
    // Bug 107：字面量 digits/radix 实参的域检查与接收者是否字面量无关——
    // 提升到接收者 guard 之前（此前 Math.random().toFixed(500) 等抽象
    // number 接收者在下方各方法臂早折抽象 string，漏掉确定的 RangeError
    // → throws 域 never 的假 total）。方法界：toFixed/toExponential
    // [0,100]、toPrecision [1,100]、toString radix [2,36]（ToIntegerOrInfinity
    // 后判；symbol 实参 ToNumber 定抛、bigint 字面量同）；toLocaleString
    // 的 ICU 路径不转换实参（(1.5).toLocaleString(Symbol()) → "1.5"）——
    // 不在提升面。抽象实参 return——各方法臂既有 recordMayThrow 口径不变。
    enforceNumProtoArgDomain(method, args[0]);
    if (method === "toString" || method === "toLocaleString") {
      const nvR = litValue(thisVal);
      const nv = nvR.ok ? nvR.value : undefined;
      if (typeof nv !== "number") return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      const argAbs = args[0];
      // Bug 65：radix 经 ToNumber——symbol（shape 判定）确定 TypeError、
      // 抽象 → may TypeError；toLocaleString 例外：原生 ICU 路径不转换实参
      // （(1).toLocaleString(Symbol()) → "1"），恒不抛
      if (method === "toString" && argAbs !== undefined) {
        if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (argAbs.term?.op !== "lit") {
          recordMayThrow({
            kind: "TypeError",
            cause: "Number.prototype.toString radix may not be convertible to a number",
          });
          return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
        }
      }
      if (argAbs !== undefined && argAbs.term?.op !== "lit") {
        return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      }
      const avR = argAbs === undefined ? undefined : litValue(argAbs);
      const av = avR?.ok ? avR.value : undefined;
      try {
        const impl = Number.prototype as unknown as Record<string, (...a: unknown[]) => string>;
        // toLocaleString 的 ICU 路径不转换实参（(1.5).toLocaleString(1n) →
        // "1.5"）——重定向宿主 toString 时必须丢实参（此前透传 av 让字面量
        // bigint/symbol 折假 never）
        const hostArgs = method === "toLocaleString" ? [] : av === undefined ? [] : [av];
        return strLit(impl[method === "toLocaleString" ? "toString" : method]!.call(nv, ...hostArgs));
      } catch (e) {
        if (e instanceof TypeError) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
        return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      }
    }
    if (
      method === "toFixed" ||
      method === "toExponential" ||
      method === "toPrecision"
    ) {
      const nvR = litValue(thisVal);
      const nv = nvR.ok ? nvR.value : undefined;
      if (typeof nv !== "number") return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      const argAbs = args[0];
      // Bug 65：digits 经 ToIntegerOrInfinity——symbol（shape 判定）确定
      // TypeError；抽象 → may TypeError；字面量真执行（RangeError catch 保留）
      if (argAbs !== undefined) {
        if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (argAbs.term?.op !== "lit") {
          recordMayThrow({
            kind: "TypeError",
            cause: `Number.prototype.${method} digits may not be convertible to a number`,
          });
          return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
        }
      }
      const avR = argAbs === undefined ? undefined : litValue(argAbs);
      const av = avR?.ok ? avR.value : undefined;
      try {
        const impl = Number.prototype as unknown as Record<string, (...a: unknown[]) => string>;
        return strLit(impl[method]!.call(nv, av));
      } catch (e) {
        if (e instanceof TypeError) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
        return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      }
    }
  }
  // boolean 字面量：toString/valueOf
  if (thisVal.shape.k === "prim" && thisVal.shape.type === "boolean") {
    if (method === "valueOf") return thisVal;
    if (method === "toString" || method === "toLocaleString") {
      const bvR = litValue(thisVal);
      const bv = bvR.ok ? bvR.value : undefined;
      if (typeof bv === "boolean") return strLit(String(bv));
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
  }
  // 数组/元组方法
  if (thisVal.shape.k === "arr" || thisVal.shape.k === "tuple") {
    const arrR = invokeArrMethod(thisVal, method, args);
    if (arrR !== undefined) return arrR;
  }
  // Symbol：toString/valueOf（String(sym) 由 evalGlobalFn 处理；隐式 ToString 才抛）
  if (isSymbolAbs(thisVal)) {
    if (method === "toString") return stringOfSymbol(thisVal);
    if (method === "valueOf") return thisVal;
  }
  // string.match(/re/) / string.search(/re/)（字面量 pattern 精确执行）
  {
    const sm = stringRegexMethod(thisVal, method, args);
    if (sm !== undefined) return sm;
  }
  // 字符串/模板方法表
  {
    const viaTable = callAbsMethod(thisVal, method, args);
    if (viaTable) return viaTable;
  }
  // 属性上的可调用值（require namespace / 对象方法）；method 诊断由下方统一报
  // Bug 56：protoMethod kind（方法值读通道产物）跳过——$call 不传 receiver，
  // 回环 dispatch 会在 undefined 接收者上假定抛（copyWithin 假 throw）；
  // 借用调用走 $invoke 的 call/apply 分支（receiver 传递正确）
  const prop = $get(thisVal, method, { silent: true });
  const impl = prop && typeof prop === "object" && "shape" in (prop as object)
    ? getFnImpl(prop as Abs)
    : undefined;
  if (impl && impl.kind !== "protoMethod") {
    // 对象方法（ObjectMethod / 方法型 FunctionExpression）：注入 receiver
    const brand = thisVal.shape.k === "brand" ? thisVal.shape.name : undefined;
    // 调用点收集（T5）：`Class.method` / 裸 `method`，供 call@ 合成
    const recordName = brand ? `${brand}.${method}` : method;
    let result: Abs = unknown;
    let threw = false;
    try {
      // Bug 46：receiver 统一经 thisVal 通道传入（bindThis impl 由 $call
      // 派发注入首参；普通 fn 经 apply 钩子进宿主 this——$rawThis 承接）。
      // 动态赋值的方法（o.get = function(){…}）不再因定义位点无 bindThis
      // 标记而丢接收者（此前 undefined.v 假 TypeError + never）。
      result = $call(prop as Abs, args, thisVal);
      return result;
    } catch (e) {
      threw = true;
      result = throwPayloadOf(e);
      throw e;
    } finally {
      noteEvalCallRecord({
        fnName: recordName,
        args,
        result,
        callLoc: loc ? { line: loc[0], column: loc[1] } : undefined,
        threw,
      });
      // 方法槽 returnType 渐进填入（未调用前展示 `() => ?` 的残余）
      refineFnReturnType(prop as Abs, result);
    }
  }
  // 结构上确定不可调用（null-proto 缺失名 / 闭 exact 对象非 OP 名缺失 /
  // 字面量非函数槽）→ 原生 TypeError hard throw（catch 可吸收）
  if (definitelyUncallableMember(thisVal, method)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // bigint prim 接收者的原型外方法（M3）：BigInt.prototype 自有方法集是
  // **封闭**的 {toString, toLocaleString, valueOf}（规范全列，无宿主扩展
  // 面）——方法调用确定 TypeError（`(5n).toFixed(1)` 原生同抛）。与
  // string/number 的软判定（STRING_METHODS 近似面，漏列会假抛）不同，
  // bigint 面可枚举所以可定抛。属性读（$get 通道）不受影响。
  if (
    thisVal?.shape?.k === "prim" &&
    (thisVal.shape as { type?: string }).type === "bigint" &&
    !OBJECT_PROTO_NAMES.has(method) &&
    !BIGINT_PROTO_METHODS.has(method)
  ) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // prim 接收者上的未知方法 → no-method
  if (notePrimMemberMissing(thisVal, method, "method", loc)) return unknown;
  // nullish → may-throw TypeError（soft）；any → may-throw + 结果 any
  if (noteNullishMemberThrows(thisVal, method, "method", loc)) {
    return unknown;
  }
  if (noteAnyMemberMayThrow(thisVal, method, "method", loc)) {
    return anyMemberResult();
  }
  // unknown（推导失败）→ unknown-recv 引擎债
  noteUnknownMemberMissing(thisVal, method, "method", loc);
  return unknown;
}

/** 首次/后续方法调用后，把观测结果 join 进 fn.returnType 槽（展示用，不回写分析） */
export function refineFnReturnType(fn: Abs, result: Abs): void {
  if (!fn || typeof fn !== "object" || !("shape" in fn)) return;
  const s = fn.shape as { k?: string; returnType?: Abs };
  if (s.k !== "fn") return;
  if (s.returnType === undefined) {
    s.returnType = result;
    return;
  }
  try {
    s.returnType = joinAbs(s.returnType, result);
  } catch {
    /* join 失败保持原槽 */
  }
}

/** union 成员是否可能持有该方法（避免 Buffer 无 split 拖垮 string 分支） */
function memberLikelyHasMethod(m: Abs, method: string): boolean {
  const k = m.shape.k;
  if (k === "prim" && m.shape.type === "string") return true;
  if (k === "brand" || k === "obj") return true;
  if (k === "arr" || k === "tuple") return true;
  if (k === "eff") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Bug 49/56「方法值读」通道的调用派发（containers.protoMethodValueAbs 注册）。
// home = 值属主（prim 类型名 / 构造器名）；借用调用（v() / v.call(recv,…) /
// v.apply / v.bind）按接收者走**既有**方法调用机器，不复制派发逻辑：
// - prim / brand home → $invoke（callAbsMethod 的 prim 面 /
//   evalBuiltinInstanceMethod·execRegexBrand 的 brand 面；this 缺省按
//   strict undefined 接收者 → 原生 TypeError 面随 $invoke 记账）；
// - Array home + array-like 接收者（字符串 / 闭 obj）→ Array.from 物化
//   （字符 / 索引槽，Bug 51 面）后走数组派发（slice.call('abc') →
//   ["a","b","c"]）；不可物化形态 → unknown（不折假值）。
// ---------------------------------------------------------------------------
// Bug 108：brand-checking 内建原型表 + 借用调用接收者 brand 判定
const BRAND_CHECK_PROTOS = new Set([
  "Number", "String", "Boolean", "Symbol", "BigInt",
  "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet",
]);
/** prim 型 home（member.ts :832 的 protoMethodValueAbs(type, key)）→ brand 名 */
const PRIM_HOME_BRAND: Record<string, string> = {
  number: "Number",
  string: "String",
  boolean: "Boolean",
  bigint: "BigInt",
  symbol: "Symbol",
};
/** Array.prototype 写方法（prim 接收者上原生定抛；读方法走物化泛型） */
const ARRAY_MUTATOR_METHODS = new Set([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin",
]);
/** 接收者 brand；不可判（any/unknown/sum/Proxy 陷阱壳）→ undefined（不抛）。
 *  nullish 字面量 → "nullish"（与一切 brand 不匹配，定抛）。 */
function borrowedRecvBrandOf(recv: Abs): string | undefined {
  if (isNullishLitAbs(recv)) return "nullish";
  const s = recv.shape;
  if (s.k === "prim") return PRIM_HOME_BRAND[s.type];
  if (s.k === "brand") return s.name === "Proxy" ? undefined : s.name;
  if (s.k === "arr" || s.k === "tuple") return "Array";
  if (s.k === "fn") return "Function";
  if (s.k === "obj") return "Object";
  if (s.k === "eff") return s.eff === "promise" ? "Promise" : "Generator";
  return undefined;
}
setProtoMethodDispatch((home, name, thisVal, args) => {
  const recv: Abs = thisVal ?? $lit(undefined);
  // Bug 108：brand-checking 内建原型的借用调用——home 与接收者 brand 不匹配
  // 定抛 TypeError（原生 thisNumberValue/thisStringValue/… 前置校验：
  // Number.prototype.valueOf.call("5") 折 "5" 是假精确）。Object.prototype
  // （任意接收者合法）与 Array.prototype（上方物化 array-like）保持泛型。
  // Proxy 接收者（get/apply 陷阱可换壳）与 any/unknown/sum 不可判 → 不抛。
  {
    const homeBrand = BRAND_CHECK_PROTOS.has(home)
      ? home
      : BRAND_CHECK_PROTOS.has(PRIM_HOME_BRAND[home] ?? "")
        ? PRIM_HOME_BRAND[home]!
        : isErrorCtorName(home)
          ? "Error"
          : undefined;
    if (homeBrand !== undefined) {
      const recvBrand = borrowedRecvBrandOf(recv);
      const ok =
        recvBrand === undefined ||
        recvBrand === homeBrand ||
        (homeBrand === "Error" ? isErrorCtorName(recvBrand) : false);
      if (!ok) throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  if (home === "Array" && recv.shape.k !== "tuple" && recv.shape.k !== "arr") {
    // Bug 108 邻接面：mutator（push/pop/…）在 prim 接收者上原生定抛
    //（CreateDataProperty/DeleteProperty on primitive——node 实测
    // Array.prototype.push.call("ab",1) → TypeError）。此前字符串接收者
    // 被 Bug 51 物化通道吞成「拷贝元组上成功」的假不抛。读方法（slice/
    // join/at/…）保持物化泛型。
    if (recv.shape.k === "prim" && ARRAY_MUTATOR_METHODS.has(name)) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // 字面量字符串 → code unit 字符 tuple（Array.prototype 借用算法按
    // length+索引读——code unit，非 code point；slice.call('abc') →
    // ["a","b","c"]）；其余 array-like（闭 obj）→ Array.from 物化
    // （Bug 51 索引槽面）后走数组派发；不可物化形态 → unknown（不折假值）
    const svR = litValue(recv);
    const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
    if (sv !== undefined) {
      const chars = abs(
        { k: "tuple", elements: Array.from({ length: sv.length }, (_, i) => strLit(sv[i]!)) },
        undefined,
        undefined,
        "exact",
      );
      return $invoke(chars, name, args);
    }
    const materialized = evalArrayStatic("from", [recv]);
    if (
      materialized !== undefined &&
      (materialized.shape.k === "tuple" || materialized.shape.k === "arr")
    ) {
      return $invoke(materialized, name, args);
    }
    return unknown;
  }
  return $invoke(recv, name, args);
});
