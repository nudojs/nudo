/**
 * 求值引擎 class：brand 实例 + ctor/method 闭包 + 继承链。
 * 方法内 this 由 transpile 改写为 thisVal 参数。
 */

import type { Abs } from "../abs.ts";
import { abs, unknown, confJoin, litValue, bool, boolLit, str, strLit, numLit } from "../abs.ts";
import { objOf, joinAbs, isObj, canonicalArrayIndex, getSlot, setSlot, propertyKeyOf, getProtoAbs } from "../objects.ts";
import { findClassAccessor } from "./runtime/members.ts";
import { $get, $set, $lit, asAbsVal, namespaceNameOf, $regex, $arrMutContainer, callAtFunctionBoundary, lookupObjAccessor, fillTuple, clearStaleTermPred } from "./runtime.ts";
import { pushCtorFrame, popCtorFrame, withNewTargetReset } from "./runtime/state.ts";
import { $call } from "./call.ts";
import { evalEnterCall, evalExitCall, evalTruncatedAbs, isHostGlobalFn } from "./calls.ts";
import { getFnImpl, absFunction, hostFnCtorFacet, isAbsApplyResult } from "../abs-fn.ts";
import { evalNamespaceCall, errorBrandAbs, isErrorCtorName, evalBuiltinInstanceMethod, evalBuiltinNew, extStateOf, getPropFlags, isEnumerableView, tryMakeRegexAbs, makeArrayCtorAbs, assignSourceSlots, isSymbolAbs, stringOfSymbol, evalPromiseCtor, evalPromiseMethod, builtinCtorNameOf, hostBuiltinCtorName, makeProxyAbs, makeArrayBufferAbs, makeDataViewAbs, makeUrlAbs, noteBoxedCtorArg, sumHasPrimMember, evalDateCtor } from "../builtins.ts";
import { arrayJoinToString, arrayJoinWithSep, validateJoinElements } from "../builtins/array.ts";
import { isMapAbs, isSetAbs, makeMapAbs, makeSetAbs, collectionElementJoin, ctorArgDefinitelyInvalid, makeWeakCollectionAbs } from "../collections.ts";
import { registerMatchIter } from "./match-iter.ts";
import { TUPLE_MATERIALIZE_CAP } from "../containers.ts";
import {
  applyCallbackAbs,
  asAbs,
  instantiateReturn,
  isRelFn,
  mapElementFallback,
  projectFlatMapResult,
  undefAbs,
  validateCallableArg,
  validateIndexArg,
} from "../hof.ts";
import { toIOI, privateNameGuard } from "./runtime/containers.ts";
import { emptyEnv } from "../ast-env.ts";
import { defaultLeakBudget } from "../leak.ts";
import { pTrue } from "../pred.ts";
import {
  noteEvalCallRecord,
  blockHostSideEffect,
} from "./calls.ts";
import {
  notePrimMemberMissing,
  noteUnknownMemberMissing,
  noteAnyMemberMayThrow,
  noteNullishMemberThrows,
  anyMemberResult,
  definitelyUncallableMember,
} from "./member-diag.ts";
import { errorTypeAbs, throwPayloadOf, recordMayThrow } from "./may-throw.ts";
import { isNullishLitAbs } from "../surface.ts";
import { NudoThrow, $collectionForEach } from "./runtime.ts";
import { callAbsMethod, toIntegerOrInfinityLit } from "../methods.ts";
import {
  registerEvalClass,
  markClassValue,
  getEvalClass,
  type EvalClassSpec,
} from "./class-registry.ts";

export type { EvalClassSpec } from "./class-registry.ts";
export { registerEvalClass, getEvalClass, clearBClasses } from "./class-registry.ts";

const classImpl = new WeakMap<object, EvalClassSpec>();

/** 定义类 → 可 new 的 Abs（brand 标记；静态字段挂在 slots） */
export function $class(
  name: string,
  spec: Omit<EvalClassSpec, "name"> & { extends?: string | Abs | unknown; hasExtends?: boolean },
): Abs {
  // extends 是活引用：类值取 brand 名、宿主 ctor 取 .name、字符串向后兼容。
  // 原生 ClassDefinitionEvaluation：superclass 须为 null 或 constructor，否则
  // **定义期** TypeError（Bug 11 前非 Identifier 表达式被静默丢弃、无校验）。
  // hasExtends 标记区分「extends undefined（babel Identifier → 活引用 raw
  // undefined）」与「无 extends 子句」——前者定义期即 TypeError。
  const ext = spec.extends;
  // bindImport 的 JS 可调用 wrapper（fn Abs → 箭头）：回 Abs 面（同 $new）——
  // wrapper 是箭头，hostFnCtorFacet 会误判不可构造
  const extAbsFn = (ext as { __nudoAbsFn?: Abs } | undefined)?.__nudoAbsFn;
  const extVal = extAbsFn ?? ext;
  let superName: string | undefined;
  let superNull = false;
  if (spec.hasExtends) {
    if (extVal === null) {
      // extends null 合法：无 super 原型链；new 时隐式/显式 super() 原生抛
      superNull = true;
    } else if (extVal === undefined) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    } else if (typeof extVal === "function") {
      // 宿主函数（extends Map / 求值引擎函数声明）：generator/async/箭头不可 new
      if (hostFnCtorFacet(extVal) === false) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      superName = (extVal as { name?: string }).name || undefined;
    } else if (typeof extVal === "string") {
      superName = extVal; // 向后兼容：名字字符串
    } else if (extVal && typeof extVal === "object" && "shape" in (extVal as object)) {
      const s = (extVal as Abs).shape;
      if (s.k === "brand") {
        superName = s.name;
      } else if (s.k === "fn") {
        // Bug 9 facet：非构造函数（箭头/方法/async/generator）→ 定义期 TypeError；
        // 未知可构造性（mock/桥接）→ may-throw。可构造 fn 取名作 super 链键。
        if (s.ctor === false) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (s.ctor === undefined) {
          recordMayThrow({
            kind: "TypeError",
            cause: `class extends ${s.k} function value (may not be a constructor)`,
          });
        }
        superName = s.name;
      } else if (isNullishLitAbs(extVal as Abs)) {
        const lv = litValue(extVal as Abs);
        if (lv.ok && lv.value === null) superNull = true;
        else throw new NudoThrow(errorTypeAbs("TypeError")); // extends undefined → TypeError
      } else if (s.k === "prim" || s.k === "arr" || s.k === "tuple" || s.k === "eff") {
        // prim（含字面量）/数组/迭代产物绝非构造器 → 定义期确定 TypeError
        throw new NudoThrow(errorTypeAbs("TypeError"));
      } else if (s.k === "any" || s.k === "obj" || s.k === "sum") {
        // 抽象 superclass：可能不是构造器 → may-throw（sum 臂可能含可构造 fn）
        recordMayThrow({
          kind: "TypeError",
          cause: `class extends ${s.k} value (may not be a constructor)`,
        });
      }
      // unknown：引擎 fail-closed 令牌，不记（与 $call/$in 口径一致）
    } else {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  } else if (extVal !== undefined) {
    // 无 hasExtends 的旧调用面：原归一化（brand / 宿主函数 / 字符串）
    if (typeof extVal === "string") superName = extVal;
    else if (extVal && typeof extVal === "object" && "shape" in (extVal as object)) {
      const s = (extVal as Abs).shape;
      superName = s.k === "brand" ? s.name : undefined;
    } else if (typeof extVal === "function") {
      superName = (extVal as { name?: string }).name;
    }
  }
  const full: EvalClassSpec = {
    name,
    superName,
    ...(superNull ? { superNull: true } : {}),
    ctor: spec.ctor,
    methods: spec.methods,
    methodParams: spec.methodParams,
    staticMethods: spec.staticMethods,
    staticMethodParams: spec.staticMethodParams,
    statics: spec.statics,
    instanceFields: spec.instanceFields,
    accessors: spec.accessors,
    staticAccessors: spec.staticAccessors,
  };
  // Bug 60：计算键折叠——键表达式已在 spec 对象字面量构造时求值（定义期，
  // throws 效果已记录）。字面量 string/number 键 → 挂真名；抽象键
  // （any/symbol/…）无法静态列举 → 摘除 synth 名成员（不静默挂错名）。
  if (spec.computedKeys) {
    const renames = new Map<string, string>();
    const drops = new Set<string>();
    for (const [synth, keyVal] of Object.entries(spec.computedKeys)) {
      const k = asAbsVal(keyVal);
      const lv = litValue(k);
      if (lv.ok && (typeof lv.value === "string" || typeof lv.value === "number")) {
        renames.set(synth, String(lv.value));
      } else {
        drops.add(synth);
      }
    }
    const rekey = (rec: Record<string, unknown> | undefined): void => {
      if (!rec) return;
      for (const [synth, real] of renames) {
        if (synth in rec && !(real in rec)) {
          rec[real] = rec[synth];
          delete rec[synth];
        }
      }
      for (const d of drops) delete rec[d];
    };
    rekey(full.methods);
    rekey(full.methodParams);
    rekey(full.staticMethods);
    rekey(full.staticMethodParams);
    rekey(full.statics);
    rekey(full.accessors);
    rekey(full.staticAccessors);
  }
  registerEvalClass(full);
  const slots: Record<string, { value: Abs }> = {};
  if (full.statics) {
    for (const [k, v] of Object.entries(full.statics)) setSlot(slots, k, { value: asAbsVal(v) });
  }
  // 类值自有 name 属性（原生 Function.name；类表达式/声明均可读）
  setSlot(slots, "name", { value: strLit(name) });
  const val = abs(
    // ctor: true —— 类值 brand facet（构造器值本身）。实例 brand 无此
    // facet：严格相等可直接判定「实例 ≠ 类值」（new C() === C → false，
    // 原生两类值永不恒等）。leq/指纹按名义比较，facet 不参与。
    { k: "brand", name, shape: objOf(slots), ctor: true },
    undefined,
    undefined,
    "exact",
  );
  classImpl.set(val as object, full);
  markClassValue(val as object, name);
  return val;
}

function specOf(cls: Abs): EvalClassSpec | undefined {
  if (classImpl.has(cls as object)) return classImpl.get(cls as object);
  if (cls.shape.k === "brand") return getEvalClass(cls.shape.name);
  return undefined;
}

/** 沿继承链找方法 */
function findMethod(
  startName: string,
  method: string,
): ((thisVal: Abs, ...args: Abs[]) => Abs) | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = getEvalClass(cur);
    if (spec?.methods?.[method]) return spec.methods[method];
    cur = spec?.superName;
  }
  return undefined;
}

/** 沿继承链找静态方法（Bug 18）：原生静态方法挂构造器 [[Prototype]] 链
 *  （ClassDefinitionEvaluation 设 B.__proto__ = A）——空派生类
 *  `class B extends A {}` 的 B.m() 不得断链（与 findMethod 实例链同口径）。 */
function findStaticMethod(
  startName: string,
  method: string,
): ((...args: Abs[]) => Abs) | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = getEvalClass(cur);
    if (spec?.staticMethods?.[method]) return spec.staticMethods[method];
    cur = spec?.superName;
  }
  return undefined;
}

/**
 * Bug 59：实例字段落地——以 thisVal 为 this 按源序求值（原生
 * InitializeInstanceElements：基类 ctor 体前 / super() 返回后）。
 * $set 对 brand 实例就地写槽，每构造一个新实例各自持有字段。
 */
function applyInstanceFields(spec: EvalClassSpec, thisVal: Abs): Abs {
  let cur = thisVal;
  for (const f of spec.instanceFields ?? []) {
    let key = f.name;
    if (!key && f.key) {
      const kv = asAbsVal(f.key(cur));
      const lv = litValue(kv);
      if (lv.ok && (typeof lv.value === "string" || typeof lv.value === "number")) {
        key = String(lv.value);
      } else {
        continue; // Bug 60：抽象计算键不可静态命名——不挂名（不假精确）
      }
    }
    if (!key) continue;
    cur = $set(cur, key, asAbsVal(f.init(cur)));
  }
  return cur;
}

/**
 * Bug 59：构造链（原生 [[Construct]] 沿继承链逐类初始化实例字段）：
 * - 显式 ctor 基类：实例字段 → ctor 体；
 * - 显式 ctor 派生类：直接跑 ctor 体（内部 super() → $super 递归父链，
 *   super 返回后应用本类实例字段）；
 * - 隐式 ctor（constructor(...a){ super(...a) }）：递归父构造，返回后
 *   应用本类实例字段；extends null 链隐式 super 原生抛 TypeError。
 */
function constructClass(className: string, thisVal: Abs, args: Abs[]): Abs {
  const spec = getEvalClass(className);
  if (!spec) {
    // issue #110：env/宿主内建构造器作基类（class X extends Error）——此前
    // 原样返回 thisVal，super(message) 静默 no-op：args 被丢弃，e.message /
    // e.name 折假精确 undefined（原生为 message 字符串 / 原型链 "Error"）。
    // Error 家族按 errorBrandAbs 落 name/message 槽（与 new Error(...) 同
    // 口径：lit message 保精确、symbol ToString 校验、AggregateError
    // errors/cause）；brand 名保持被构造实例 thisVal（B extends A extends
    // Error 的中间用户类链不换名）。其余内建（Promise/Date/…）无槽建模，
    // 维持原样。用户同名类优先（上方 getEvalClass 命中即不走此分支）。
    if (isErrorCtorName(className)) {
      const eb = errorBrandAbs(className, args);
      const instName = thisVal.shape.k === "brand" ? thisVal.shape.name : className;
      const inner = eb.shape.k === "brand" ? eb.shape.shape : objOf({});
      return abs(
        { k: "brand", name: instName, shape: inner },
        eb.term,
        eb.pred,
        eb.conf,
      );
    }
    return thisVal;
  }
  if (spec.ctor) {
    let tv = thisVal;
    if (!spec.superName && !spec.superNull) tv = applyInstanceFields(spec, tv);
    const after = spec.ctor(tv, ...args);
    if (after && after.shape.k === "brand") return after;
    // Bug 17：ES [[Construct]] 返回值语义——undefined（宿主 undefined / lit
    // undefined）→ this；其余原始值（prim 域或字面量；null 折 unknown+
    // lit(null)）：基类忽略 → this，派生类 TypeError（Derived constructors
    // may only return object or undefined）。
    if (after === undefined || after === null) return tv;
    if (after && typeof after === "object" && "shape" in (after as object)) {
      if (isDefinitelyUndefinedAbs(after)) return tv;
      if (
        after.shape.k === "prim" ||
        (after.term?.op === "lit" && after.term.value === null)
      ) {
        if (spec.superName || spec.superNull) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        return tv;
      }
    }
    return after ?? tv;
  }
  if (spec.superNull) {
    // Bug 11：extends null 链上的隐式构造器等价 super(...args)，原生抛
    // TypeError（Super constructor null … is not a constructor）
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (spec.superName) {
    const afterSuper = constructClass(spec.superName, thisVal, args);
    return applyInstanceFields(spec, afterSuper);
  }
  return applyInstanceFields(spec, thisVal);
}

/** new C(...) → 空 brand 实例 + ctor 写字段；非类构造走 impl/$call */
export function $new(cls: Abs | ((...a: unknown[]) => unknown), args: Abs[]): Abs {
  // bindImport 的 JS 可调用 wrapper（fn Abs → 箭头）：回 Abs 面派发——
  // wrapper 本身是箭头，hostFnCtorFacet 会误判不可构造（Bug 9 假抛）
  const wrappedAbs = (cls as { __nudoAbsFn?: Abs } | undefined)?.__nudoAbsFn;
  if (wrappedAbs) return $new(wrappedAbs, args);
  // Abs 侧内建构造器（builtinCtorAbs / env fn）：按名派发。
  // dual-facet 全局（Array/Date/Promise/Number…）经 env 遮蔽后 cls 是 Abs，
  // 必须走 evalBuiltinNew 按名构造，否则 $call 回退对无 apply 的 obj 折 unknown。
  if (cls && typeof cls === "object" && "shape" in (cls as object)) {
    const cs = (cls as Abs).shape;
    const ctorName =
      cs.k === "brand"
        ? cs.name
        : builtinCtorNameOf(cls) ?? (cs.k === "fn" ? (cs.name ?? undefined) : undefined);
    if (ctorName) {
      const built = evalBuiltinNew(ctorName, args);
      if (built !== undefined) return built;
    }
  }
  // JS 内建构造器（Error/Date/URL…）：直接 brand，避免 $call 对非 Abs 炸掉
  if (typeof cls === "function") {
    const clsName = cls.name || "Object";
    // Bug 37：Proxy 无 .prototype（hostFnCtorFacet 的 prototype 启发式会误判
    // 不可构造 → 假 TypeError），但原生 Proxy 是合法构造器——先按名走
    // target/handler IsObject 校验派发
    if (clsName === "Proxy") return makeProxyAbs(args[0], args[1]);
    // Bug 9：宿主 generator/async 函数（求值引擎的函数声明产物）不可 new——
    // 原生 new g() → TypeError（g is not a constructor），不得落空 brand 假精确
    if (hostFnCtorFacet(cls) === false) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // 宿主副作用构造器（new WebSocket / XMLHttpRequest / EventSource…）：
    // 与 $callNamed 同一 never-execute 守卫——真构造会开真实连接。
    // 命中 fail-closed 为 unknown#opaque，不落入下方空 brand（那是
    // 「碰巧安全」而非显式拦截）。
    const blockedHost = blockHostSideEffect(cls);
    if (blockedHost) return blockedHost;
    // new Array(n) → n 元空洞 tuple；new Array(a,b,c) → 字面量 tuple；
    // 非法 length（1.5/-1/NaN/超 2^32-1）→ RangeError
    // （makeArrayCtorAbs 口径）
    if (cls === Array) {
      return makeArrayCtorAbs(args);
    }
    // new RegExp(pattern, flags)：字面量真构造验证——非法 pattern/flags 硬抛
    // SyntaxError/TypeError；合法折叠精确 brand；抽象/RegExp 实例保守（下方 path brand）
    if (cls === RegExp) {
      const m = tryMakeRegexAbs(args);
      if (m) return m;
    }
    // C2.2：Error 家族携带 name/message 槽（catch 形参可读）
    if (isErrorCtorName(clsName)) {
      return errorBrandAbs(clsName, args);
    }
    // C1.1 / C1.2：Map / Set 条目表（按 ctor 名比对，避开 TS 全局接口无交集）
    // 确定非法实参（非可迭代字面量 / Map prim 条目）→ 原生 TypeError hard throw
    if (clsName === "Map") {
      if (ctorArgDefinitelyInvalid("Map", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeMapAbs(args[0]);
    }
    if (clsName === "Set") {
      if (ctorArgDefinitelyInvalid("Set", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeSetAbs(args[0]);
    }
    // Bug 15：WeakMap/WeakSet 与 Map/Set 同口径 iterable 校验；合法 → 空 brand
    if (clsName === "WeakMap") return makeWeakCollectionAbs("WeakMap", args[0]);
    if (clsName === "WeakSet") return makeWeakCollectionAbs("WeakSet", args[0]);
    // Bug 41：new ArrayBuffer(length) —— ToIndex 校验（负 → RangeError）
    if (clsName === "ArrayBuffer") return makeArrayBufferAbs(args[0]);
    // Bug 63：new DataView(buf, off?, len?) —— IsArrayBuffer + ToIndex 校验
    if (clsName === "DataView") return makeDataViewAbs(args[0], args[1], args[2]);
    // Bug 85：new URL(input, base?) —— ToString + 解析校验（合法带 href 槽）
    if (clsName === "URL") return makeUrlAbs(args[0], args[1]);
    // Bug 53：new Number/String(symbol) —— ToNumber/ToString 确定 TypeError；
    // any 实参 → may。Boolean 的 ToBoolean 全定不校验。值域不变（下方装箱）
    if (clsName === "Number" || clsName === "String") {
      noteBoxedCtorArg(clsName, args[0]);
    }
    // new Symbol() 原生 TypeError（Symbol 只能当函数调用）
    if (clsName === "Symbol") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // new Promise(executor)：调用 executor 收集 resolve 实参 → eff(promise)
    if (clsName === "Promise") {
      return evalPromiseCtor(args);
    }
    // Bug 24：new Date(value) —— 单参 ToPrimitive/ToNumber 校验（symbol/bigint
    // 确定抛，node 实测 new Date(1n) TypeError）；多参逐实参 ToNumber。
    // 与 evalBuiltinNew 的 Abs 面同口径（evalDateCtor 返回同款 brand）。
    if (clsName === "Date") {
      return evalDateCtor(args);
    }
    // new String(prim)：包装箱带 length/下标槽（与 evalGlobalFn Object 装箱
    // 同口径）——此前通用空箱 branch 折 new String('ab')['0'] === undefined、
    // .length === undefined、Object.assign({}, boxed) === {} 假精确。
    if (clsName === "String") {
      const a0R = args[0] ? litValue(args[0]) : undefined;
      const a0 = a0R?.ok ? a0R.value : undefined;
      if (typeof a0 === "string") {
        const slots: Record<string, { value: Abs }> = {
          length: { value: numLit(a0.length) },
        };
        for (let i = 0; i < a0.length; i++) {
          slots[String(i)] = { value: strLit(a0[i]!) };
        }
        return abs(
          { k: "brand", name: "String", shape: objOf(slots) },
          undefined,
          undefined,
          "exact",
        );
      }
      // 非字面量实参：open 空箱保守（成员读非具体，不折假精确 undefined）
      return abs(
        { k: "brand", name: "String", shape: objOf({}, { open: true }) },
        undefined,
        undefined,
        "path",
      );
    }
    // Bug 16：未识别宿主函数（用户 function 声明/表达式——转译产物是真
    // JS 函数，体已 $ 助手化、Abs this 经 $rawThis(this) prologue 承接）
    // 按原生 [[Construct]] 执行：新建空 brand this → 调函数体 → 返回值为
    // Abs 对象（brand/obj）则用之，否则 this（宿主函数皆基类构造器，
    // undefined/原始返回值原生忽略）。宿主内建构造器（Object/Function/
    // Boolean…未进上方派发表）不走体执行——Abs 实参喂真 JS 构造器会产
    // 宿主原值（静默错值），维持既有空 brand 口径。
    if (hostBuiltinCtorName(cls) === undefined && !isHostGlobalFn(cls)) {
      const thisVal = abs(
        { k: "brand", name: clsName, shape: objOf({}) },
        undefined,
        undefined,
        "path",
      );
      // new.target 帧：构造器体内 new.target = 被构造的函数值
      pushCtorFrame(asAbsVal(cls));
      const entered = evalEnterCall(clsName, cls, args);
      if (!entered.ok) {
        popCtorFrame();
        return evalTruncatedAbs();
      }
      try {
        const after = callAtFunctionBoundary(() =>
          (cls as (...a: Abs[]) => Abs).apply(thisVal, args),
        );
        if (
          after &&
          typeof after === "object" &&
          "shape" in (after as object) &&
          (after.shape.k === "brand" || after.shape.k === "obj")
        ) {
          return after;
        }
        return thisVal;
      } finally {
        evalExitCall();
        popCtorFrame();
      }
    }
    const shape = objOf({});
    return abs({ k: "brand", name: clsName, shape }, undefined, undefined, "path");
  }
  const spec = specOf(cls);
  if (!spec) {
    // Bug 9：fn 形 callee 的可构造性校验（箭头/方法/async/generator 不可 new）。
    // 已知非构造 → hard NudoThrow（tier 1）；已知可构造（函数/类表达式值）→
    // 与宿主函数分支同口径的空 brand 实例；未知（mock/桥接/env）→ may-throw
    // （tier 2），值域保持 $call 回退不变。
    const fs = cls && typeof cls === "object" && "shape" in (cls as object)
      ? (cls as Abs).shape
      : undefined;
    if (fs?.k === "fn") {
      if (fs.ctor === false) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (fs.ctor === true) {
        const instName = fs.name ?? "Anonymous";
        // Bug 16：可构造 fn Abs（$fnVal 函数表达式值等）按 [[Construct]]
        // 执行体——apply 钩子承接 Abs thisVal（非 bindThis 的 thisArg 传入），
        // 返回 Abs 对象优先、undefined/原始值忽略（基类语义）
        const impl = getFnImpl(cls as Abs);
        if (impl?.apply) {
          const thisVal = abs(
            { k: "brand", name: instName, shape: objOf({}) },
            undefined,
            undefined,
            "path",
          );
          pushCtorFrame(cls as Abs);
          const entered = evalEnterCall(instName, cls, args);
          if (!entered.ok) {
            popCtorFrame();
            return evalTruncatedAbs();
          }
          try {
            const afterR = impl.apply(args, thisVal);
            const after = isAbsApplyResult(afterR) ? afterR.abs : afterR;
            if (
              after &&
              typeof after === "object" &&
              "shape" in (after as object) &&
              (after.shape.k === "brand" || after.shape.k === "obj")
            ) {
              return after;
            }
            return thisVal;
          } finally {
            evalExitCall();
            popCtorFrame();
          }
        }
        // issue #106：env 声明构造器（ctor:true + 声明 returnType、无 impl）——
        // 空 brand 会丢声明实例面（EventEmitter/AbortController/stream 的方法槽），
        // 回落 $call（与下方 env 构造器注释同口径）取声明实例类型。
        if (!impl || !impl.apply) {
          const rt = (fs as { returnType?: Abs }).returnType;
          if (rt && (rt.shape.k === "brand" || rt.shape.k === "obj")) {
            return $call(cls, args);
          }
        }
        return abs(
          { k: "brand", name: instName, shape: objOf({}) },
          undefined,
          undefined,
          "path",
        );
      }
      recordMayThrow({
        kind: "TypeError",
        cause: "new on function value of unknown constructibility (may be arrow/generator/async)",
      });
    }
    // env 构造器（URL 等）：fn impl / absFunction
    return $call(cls, args);
  }
  const className = spec?.name ?? (cls.shape.k === "brand" ? cls.shape.name : "Anonymous");
  const thisVal = abs(
    { k: "brand", name: className, shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
  // Bug 79：new.target 帧——构造器体/实例字段初始化器内 new.target = 被构造
  // 的类值；嵌套普通调用（$call/$invoke 面已清空）读 undefined（原生语义）。
  pushCtorFrame(cls);
  try {
    return constructClass(className, thisVal, args);
  } finally {
    popCtorFrame();
  }
}

/**
 * Bug 77：静态块在类定义期执行（原生 ClassDefinitionEvaluation 的
 * InitializeStaticElements）。transpile 在 `let C = $class(...)` 绑定完成
 * **之后**发射本调用——块体内类名按词法可见（原生 static 块内类绑定已
 * 初始化）；this 绑定类值；块内 throw 在定义点表面（NudoThrow 上浮）。
 */
export function $staticInit(cls: Abs, thunks: Array<(thisVal: Abs) => unknown>): void {
  for (const t of thunks) t(cls);
}

/**
 * super(...)：父类构造写入字段（this 保持子类 brand）。
 * transpile: super(a,b) → __this = $super(__this, "Child", [a,b])
 */
export function $super(thisVal: Abs, childName: string, args: Abs[]): Abs {
  const child = getEvalClass(childName);
  // Bug 11：extends null 的显式 super()：原生 TypeError
  // （Super constructor null of … is not a constructor）
  if (child?.superNull) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const parentName = child?.superName;
  if (!parentName) return thisVal;
  let after = constructClass(parentName, thisVal, args);
  // Bug 59：super() 返回后初始化子类实例字段（原生 InitializeInstanceElements）
  if (child) after = applyInstanceFields(child, after);
  if (after && after.shape.k === "brand") {
    // 保持子类 brand 名
    return abs(
      { k: "brand", name: childName, shape: after.shape.shape },
      after.term,
      after.pred,
      after.conf,
    );
  }
  return after ?? thisVal;
}

// RegExp brand 面 → class-regex.ts
export {
  regexParts,
  regexExecWithState,
  execRegexBrand,
  $reStateCall,
  stringRegexMethod,
} from "./class-regex.ts";
import {
  regexParts,
  regexExecWithState,
  execRegexBrand,
  $reStateCall,
  stringRegexMethod,
} from "./class-regex.ts";

function throwStrictAssign(): never {
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

function runtimeAssignObject(args: Abs[]): Abs {
  if (!args.length) return unknown;
  // target 字面量：null/undefined → TypeError 硬抛；prim → 装箱语义未建模。
  // 两者都不该折出精确值（假精确 null 的根因）
  const t0 = asAbsVal(args[0]!);
  if (t0.term?.op === "lit") {
    if (t0.term.value === null || t0.term.value === undefined) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    return unknown;
  }
  // Bug 76：symbol prim target（无 lit 项——Symbol() 调用产物）→ 宿主
  // ToObject 定抛「Cannot convert a Symbol value to a string」（node 实测
  // assign(Symbol()) 无源也抛；number/string/boolean/bigint target 装箱合法）
  if (isSymbolAbs(t0)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // Bug 50：抽象 target（无 lit 项）可能 nullish → ToObject may TypeError
  //（与 builtins/object.ts evalObjectMethod "assign" 同口径；仅补 throws 效果）
  {
    const tk = t0.shape.k;
    const memberMayNullish = (m: Abs): boolean =>
      m.shape.k === "any" ||
      m.shape.k === "unknown" ||
      (m.term?.op === "lit" && (m.term.value === null || m.term.value === undefined));
    if (
      tk === "any" ||
      tk === "unknown" ||
      (tk === "sum" && (t0.shape as unknown as { members: Abs[] }).members.some(memberMayNullish))
    ) {
      recordMayThrow({
        kind: "TypeError",
        cause: "Object.assign target may be nullish (ToObject throws)",
      });
    }
  }
  const mergeObj = (accObj: Abs, srcAbs: Abs, st: "nonext" | "sealed" | "frozen" | undefined): void => {
    // 就地写槽（同 $set 引用语义：语句位置无需重绑、别名同步、Abs 身份不变）
    const base = (accObj.shape as Extract<Abs["shape"], { k: "obj" }>).slots;
    const flags = getPropFlags(accObj);
    for (const [k, s] of Object.entries((srcAbs.shape as Extract<Abs["shape"], { k: "obj" }>).slots)) {
      // Object.assign 走 [[OwnPropertyKeys]] + EnumerableOwnProperties：
      // enumerable:false 自有键不拷贝（与 Object.keys 同口径）
      if (!isEnumerableView(srcAbs, k)) continue;
      // sealed/nonext 目标新键 / writable:false 键覆写：strict TypeError
      if (
        (st === "sealed" || st === "nonext") &&
        !Object.prototype.hasOwnProperty.call(base, k)
      ) {
        throwStrictAssign();
      }
      if (flags?.get(k)?.writable === false) throwStrictAssign();
      const a = lookupObjAccessor(srcAbs, k);
      base[k] = a?.get ? { value: a.get(srcAbs) } : s;
    }
    if ((srcAbs.shape as Extract<Abs["shape"], { k: "obj" }>).open) {
      (accObj.shape as Extract<Abs["shape"], { k: "obj" }>).open = true;
    }
  };
  let acc = args[0]!;
  for (let i = 1; i < args.length; i++) {
    acc = asAbsVal(acc);
    const st = extStateOf(acc);
    if (st === "frozen") throwStrictAssign(); // strict：assign 到 frozen 目标 TypeError
    const src = asAbsVal(args[i]!);
    if (src.shape.k === "obj") {
      if (acc.shape.k === "obj") {
        mergeObj(acc, src, st);
        acc.conf = confJoin(acc.conf, src.conf);
        clearStaleTermPred(acc);
      } else if (acc.shape.k === "tuple") {
        // 数组 target：数字键按下标写（扩展 length）、"length" 键截断/延长
        // （延长段 hole；非法 length 原生 RangeError）、非规范键 expando 忽略。
        // 源键序 = 原生 [[OwnPropertyKeys]] 序（整数键升序 → 字符串插入序）。
        assignArrayTarget(acc, src, st);
      }
      continue;
    }
    const srcSlots = assignSourceSlots(src);
    if (srcSlots === undefined) {
      // 键集未知（strPrim 非字面量 / arr / brand / sum / fn…）：保守降级，
      // 不得折「无变化」假精确
      if (acc.shape.k === "obj") {
        acc.shape.open = true;
      } else if (acc.shape.k === "tuple") {
        const els = acc.shape.elements;
        const joined = els.length ? els.reduce((x, y) => joinAbs(x, y)) : str();
        acc.shape = { k: "arr", element: joinAbs(joined, str()) };
        acc.conf = "partial";
        clearStaleTermPred(acc);
      }
      continue;
    }
    if (acc.shape.k === "obj" || acc.shape.k === "tuple") {
      // tuple / 字符串字面量源：合成 obj 源走同一逐键写链（无 getter/length 键）
      const srcObj = abs({ k: "obj", slots: srcSlots }, undefined, undefined, "exact");
      if (acc.shape.k === "obj") {
        mergeObj(acc, srcObj, st);
        acc.conf = confJoin(acc.conf, src.conf);
        clearStaleTermPred(acc);
      } else {
        assignArrayTarget(acc, srcObj, st);
      }
    }
  }
  return acc;
}

/**
 * Object.assign 数组 target 的逐键写（evaluator）：
 * 与原生同序处理 length 键与下标键（先写后截断可抹掉写入）。
 * getter 源键调用 getter；frozen/sealed 新下标 strict TypeError。
 */
function assignArrayTarget(target: Abs, src: Abs, st: "nonext" | "sealed" | "frozen" | undefined): void {
  const ts = target.shape as Extract<Abs["shape"], { k: "tuple" }>;
  const ss = src.shape as Extract<Abs["shape"], { k: "obj" }>;
  // 就地改槽（同 $set 引用语义：语句位置无需重绑、别名同步）
  const elements = ts.elements;
  let holes = ts.holes ?? [];
  let len = elements.length;
  const origLen = len;
  for (const [k, s] of Object.entries(ss.slots)) {
    if (k === "length") {
      const a = lookupObjAccessor(src, k);
      const vAbs = a?.get ? a.get(src) : s.value;
      const lv = vAbs.term?.op === "lit" ? vAbs.term.value : undefined;
      if (typeof lv !== "number" || !Number.isInteger(lv) || lv < 0) {
        // 非法/非字面量 length 写：原生 RangeError（"Invalid array length"）
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
      if (lv > TUPLE_MATERIALIZE_CAP) {
        // 合法但巨大：不物化巨 tuple，就地降 arr
        const el = elements.length ? elements.reduce((x, y) => joinAbs(x, y)) : unknown;
        target.shape = { k: "arr", element: el };
        target.conf = "partial";
        clearStaleTermPred(target);
        return;
      }
      if (lv < len) {
        elements.length = lv;
        holes = holes.filter((h) => h < lv);
      } else {
        for (let j = len; j < lv; j++) holes.push(j);
      }
      len = lv;
      continue;
    }
    const idx = canonicalArrayIndex(k);
    if (idx === undefined) continue; // expando：Abs 数组不存（length 不受影响）
    if (idx >= origLen && (st === "sealed" || st === "nonext")) {
      throwStrictAssign();
    }
    const a = lookupObjAccessor(src, k);
    const vAbs = a?.get ? a.get(src) : s.value;
    if (idx >= len) len = idx + 1;
    if (idx >= elements.length) elements.length = idx + 1;
    elements[idx] = vAbs;
    holes = holes.filter((h) => h !== idx);
  }
  elements.length = len;
  target.shape = { k: "tuple", elements, holes: holes.length > 0 ? holes : undefined };
  clearStaleTermPred(target);
}

/** 实例方法调用：沿继承链；类 Abs 上回落 staticMethods；obj 上回落属性函数 */
export function $invoke(
  thisVal: Abs,
  method: string,
  args: Abs[],
  loc?: [number, number],
): Abs {
  // Bug 79：方法调用是普通调用面——调用期间 new.target 读 undefined
  return withNewTargetReset(() => $invokeInner(thisVal, method, args, loc));
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
      // thisArg（Abs）作为宿主 this 传入；函数体 prologue $rawThis(this) 承接。
      // 缺 thisArg（call() 无实参）→ 宿主 undefined ≡ strict this undefined。
      if (method === "call") {
        return callAtFunctionBoundary(() => fn.apply(args[0] as never, args.slice(1)));
      }
      if (method === "apply") {
        return callAtFunctionBoundary(() => fn.apply(args[0] as never, expandApplyArgs(args[1])));
      }
      const boundThis = args[0];
      const bound = args.slice(1);
      // Bug 9：bind 产物可构造性随目标（目标可构造 → bound 可构造）
      const hostFacet = hostFnCtorFacet(thisVal);
      return absFunction(
        boundFnParams(thisVal, bound.length),
        {
          apply: (callArgs) =>
            callAtFunctionBoundary(() => fn.apply(boundThis as never, [...bound, ...callArgs])),
        },
        hostFacet !== undefined ? { ctor: hostFacet } : undefined,
      );
    }
    if (thisVal && typeof thisVal === "object" && "shape" in thisVal) {
      const fnImpl = getFnImpl(thisVal);
      const isCallable = thisVal.shape.k === "fn" || fnImpl !== undefined;
      if (isCallable) {
        // bindThis（对象方法）：thisArg 注入首参；普通 fn：thisVal 经 apply 钩子传入
        const bindThis = !!fnImpl?.bindThis;
        if (method === "call") {
          return bindThis
            ? $call(thisVal, [args[0] ?? $lit(undefined), ...args.slice(1)])
            : $call(thisVal, args.slice(1), args[0]);
        }
        if (method === "apply") {
          return bindThis
            ? $call(thisVal, [args[0] ?? $lit(undefined), ...expandApplyArgs(args[1])])
            : $call(thisVal, expandApplyArgs(args[1]), args[0]);
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
                bindThis
                  ? $call(thisVal, [boundThis ?? $lit(undefined), ...bound, ...callArgs])
                  : $call(thisVal, [...bound, ...callArgs], boundThis),
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
    // 内建 brand 实例方法（Date/RegExp/Map/Set）：统一经 builtin 表分派。
    // 此前只对 Map/Set 调 evalBuiltinInstanceMethod，Date.getTime 等落到
    // findMethod 未命中 → 折 lit(undefined)，Number.isNaN(getTime()) 假 false。
    const viaBuiltin = evalBuiltinInstanceMethod(brandName, method, thisVal, args);
    if (viaBuiltin !== undefined) return viaBuiltin;
    // C1：Map/Set forEach（条目表回调）
    if ((brandName === "Map" || brandName === "Set") && method === "forEach") {
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
    // Bug 18：静态方法沿 superName 继承链查找（空派生类 B.m() 不断链）
    const sm = findStaticMethod(brandName, method);
    if (sm) {
      let result: Abs = unknown;
      let threw = false;
      try {
        result = sm(...args);
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
  }
  // bigint 字面量：toString(radix)/valueOf 精确折叠——字面量实参真执行，
  // 非法 radix 原生 RangeError / 符号实参 TypeError 硬抛（catch 可吸收）
  if (thisVal.shape.k === "prim" && thisVal.shape.type === "bigint") {
    const bvR = litValue(thisVal);
    const bv = bvR.ok ? (bvR.value as bigint | undefined) : undefined;
    if (typeof bv === "bigint") {
      if (method === "valueOf") return thisVal;
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
    }
    return unknown;
  }
  // number 字面量：toString(radix)/toFixed/toExponential/toPrecision/valueOf
  // 精确折叠——字面量实参真执行（ToIntegerOrInfinity 截断、NaN→缺省等由原生
  // 处理），非法参数硬抛 RangeError、符号实参硬抛 TypeError；抽象实参保守。
  // 未接管的其它方法不得在此 return——继续后续诊断路径（no-method）。
  if (thisVal.shape.k === "prim" && thisVal.shape.type === "number") {
    if (method === "valueOf") return thisVal;
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
        return strLit(impl[method === "toLocaleString" ? "toString" : method]!.call(nv, av));
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
  const prop = $get(thisVal, method, { silent: true });
  const impl = prop && typeof prop === "object" && "shape" in (prop as object)
    ? getFnImpl(prop as Abs)
    : undefined;
  if (impl) {
    // 对象方法（ObjectMethod / 方法型 FunctionExpression）：注入 receiver
    const brand = thisVal.shape.k === "brand" ? thisVal.shape.name : undefined;
    // 调用点收集（T5）：`Class.method` / 裸 `method`，供 call@ 合成
    const recordName = brand ? `${brand}.${method}` : method;
    let result: Abs = unknown;
    let threw = false;
    try {
      result = impl.bindThis
        ? $call(prop as Abs, [thisVal, ...args])
        : $call(prop as Abs, args);
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
function refineFnReturnType(fn: Abs, result: Abs): void {
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

/** arr/tuple 上的 map/reduce/filter/join/includes/flatMap */
function invokeArrMethod(arr: Abs, method: string, args: Abs[]): Abs | undefined {
  const shape = arr.shape as
    | { k: "arr"; element: Abs }
    | { k: "tuple"; elements: Abs[]; holes?: number[] };
  const holes = shape.k === "tuple" ? ((arr.shape as { holes?: number[] }).holes ?? []) : [];
  const isHole = (i: number): boolean => holes.includes(i);
  /** 抽象数组（长度未知）回调收到的索引是未知 number，不得折字面量 0 */
  const unknownIdx = (): Abs =>
    abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  /** 回调结果具体 truthy：true / falsy / undefined=非具体（按 JS ToBoolean） */
  const callbackTruth = (r: Abs): boolean | undefined => {
    if (r.term?.op !== "lit") return undefined;
    const vR = litValue(r);
    const v = vR.ok ? vR.value : undefined;
    if (v === undefined || v === null || v === false || v === "" || (v as unknown) === 0n) return false;
    if (typeof v === "number" && (v === 0 || Number.isNaN(v))) return false;
    return true;
  };
  // 统一委托 applyCallbackAbs（不新增 env.fns）
  const callFn = (fn: unknown, ...fnArgs: Abs[]): Abs => {
    const sumIdx = fnArgs.findIndex(
      (a) => a && typeof a === "object" && "shape" in (a as object) && (a as Abs).shape.k === "sum",
    );
    if (sumIdx >= 0) {
      const members = (fnArgs[sumIdx] as Abs & { shape: { k: "sum"; members: Abs[] } }).shape
        .members;
      let acc: Abs | undefined;
      for (const m of members) {
        const next = fnArgs.map((a, i) => (i === sumIdx ? m : a));
        const r = callFn(fn, ...next);
        acc = acc === undefined ? r : joinAbs(acc, r);
      }
      return acc ?? unknown;
    }
    if (typeof fn === "function") {
      const r = callAtFunctionBoundary(() => (fn as (...a: Abs[]) => unknown)(...fnArgs));
      if (r && typeof r === "object" && "shape" in (r as object)) return r as Abs;
      return unknown;
    }
    const absFn = asAbs(fn);
    if (absFn) {
      return applyCallbackAbs(absFn, fnArgs, emptyEnv(), pTrue, defaultLeakBudget);
    }
    return unknown;
  };
  const isRelationOnly = (fn: unknown): fn is Abs => {
    const a = asAbs(fn);
    if (!a) return false;
    const impl = getFnImpl(a);
    if (impl?.body || impl?.apply) return false;
    return !!(impl?.relation || isRelFn(a));
  };
  if (method === "map") {
    // Bug 55：GetCallback 前置校验——空接收者零迭代也要抛（undefined 同抛）
    validateCallableArg(args[0], "map callback may not be callable");
    if (shape.k === "tuple") {
      const mapped = shape.elements.map((el, i) =>
        isHole(i) ? el : callFn(args[0], el, $lit(i), arr),
      );
      return abs(
        { k: "tuple", elements: mapped, holes: holes.length > 0 ? [...holes] : undefined },
        undefined,
        undefined,
        "path",
      );
    }
    const out = callFn(args[0], shape.element, unknownIdx(), arr);
    const el = mapElementFallback(asAbs(args[0]), shape.element, out);
    // fallback 强制 partial，否则 confJoin(arr, out)
    const conf =
      el === out ? confJoin(arr.conf, out.conf) : "partial";
    return abs({ k: "arr", element: el }, undefined, undefined, conf);
  }
  if (method === "reduce") {
    // Bug 55：GetCallback 前置校验（[1].reduce(Symbol()) 单元素无初值路径
    // 不调回调也原生抛——校验必须在取首元素之前）
    validateCallableArg(args[0], "reduce callback may not be callable");
    const fn = args[0]!;
    const noInitial = args.length < 2;
    let acc = args[1] ?? unknown;
    // Bug 18：抽象数组（长度未知可能为空）无初值 → 原生 may TypeError
    // （Reduce of empty array with no initial value）
    if (noInitial && shape.k === "arr") {
      recordMayThrow({
        kind: "TypeError",
        cause: "reduce of possibly-empty array with no initial value",
      });
    }
    // 仅 relation → 一次 join，不动点只在有 body 时跑
    if (isRelationOnly(fn) && shape.k === "arr") {
      const d = instantiateReturn(fn, [acc, shape.element]);
      return joinAbs(acc, d);
    }
    if (shape.k === "tuple") {
      if (noInitial) {
        // Bug 18：原生无初值语义——acc 取首个在场元素（hole 跳过），回调自
        // 次元素起；空/仅 hole → 确定 TypeError；单元素 → 不调回调直接返回
        const firstIdx = shape.elements.findIndex((_, i) => !isHole(i));
        if (firstIdx === -1) throw new NudoThrow(errorTypeAbs("TypeError"));
        let acc2 = shape.elements[firstIdx]!;
        for (let i = firstIdx + 1; i < shape.elements.length; i++) {
          if (isHole(i)) continue;
          acc2 = callFn(fn, acc2, shape.elements[i]!, $lit(i), arr);
        }
        return acc2;
      }
      for (let i = 0; i < shape.elements.length; i++) {
        if (isHole(i)) continue;
        acc = callFn(fn, acc, shape.elements[i]!, $lit(i), arr);
      }
      return acc;
    }
    return callFn(fn, acc, shape.element, unknownIdx(), arr);
  }
  if (method === "reduceRight") {
    // Bug 55：GetCallback 前置校验（同 reduce——单元素无初值不调回调也抛）
    validateCallableArg(args[0], "reduceRight callback may not be callable");
    const fn = args[0]!;
    const noInitial = args.length < 2;
    let acc = args[1] ?? unknown;
    if (shape.k === "tuple") {
      if (noInitial) {
        // Bug 18：同 reduce（自尾向前）
        let lastIdx = -1;
        for (let i = shape.elements.length - 1; i >= 0; i--) {
          if (!isHole(i)) {
            lastIdx = i;
            break;
          }
        }
        if (lastIdx === -1) throw new NudoThrow(errorTypeAbs("TypeError"));
        let acc2 = shape.elements[lastIdx]!;
        for (let i = lastIdx - 1; i >= 0; i--) {
          if (isHole(i)) continue;
          acc2 = callFn(fn, acc2, shape.elements[i]!, $lit(i), arr);
        }
        return acc2;
      }
      for (let i = shape.elements.length - 1; i >= 0; i--) {
        if (isHole(i)) continue;
        acc = callFn(fn, acc, shape.elements[i]!, $lit(i), arr);
      }
      return acc;
    }
    // Bug 18：抽象数组无初值 → may TypeError
    if (noInitial) {
      recordMayThrow({
        kind: "TypeError",
        cause: "reduceRight of possibly-empty array with no initial value",
      });
    }
    return callFn(fn, acc, shape.element, unknownIdx(), arr);
  }
  if (method === "filter") {
    // Bug 55：GetCallback 前置校验（空元组零谓词也要抛）
    validateCallableArg(args[0], "filter callback may not be callable");
    // 逐位谓词：具体 true 保留、具体 false 丢弃、不确定并入（side effect 计数精确）。
    // hole 跳过谓词且不出现在结果里（原生 filter 收紧数组）。
    if (shape.k === "tuple") {
      const kept: Abs[] = [];
      let anyUncertain = false;
      shape.elements.forEach((el, i) => {
        if (isHole(i)) return;
        const p = callFn(args[0], el, $lit(i), arr);
        const t = callbackTruth(p);
        if (t === false) return;
        if (t === undefined) anyUncertain = true;
        kept.push(el);
      });
      if (kept.length === 0) {
        // 每个现存元素的谓词都 definitely-false（空元组平凡成立）→ 结果恒为 []。
        // 旧口径折 unknown[]（无界长度）既失真又在 assign 对账面制造假
        // mismatch（OSS 语料 semver/bin/semver.js L109 的 L1 FP）。
        return abs({ k: "tuple", elements: [] }, undefined, undefined, confJoin(arr.conf, "path"));
      }
      // 谓词全具体 → 精确子序列保留 tuple 字面量精度
      if (!anyUncertain) {
        return abs({ k: "tuple", elements: kept }, undefined, undefined, confJoin(arr.conf, "path"));
      }
      // 不确定谓词：结果是 kept 的**子序列**（长度 ≤ kept.length，filter 不增元素）。
      // 小元组枚举子集和（精确且有界）；更大的枚举指数膨胀 → 退回无界 arr
      // （sound，旧口径，仅长度上界失真）。
      const conf = confJoin(arr.conf, "path");
      if (kept.length <= 3) {
        let acc: Abs | undefined;
        const total = 1 << kept.length;
        for (let mask = 0; mask < total; mask++) {
          const els = kept.filter((_, bit) => (mask & (1 << bit)) !== 0);
          const sub = abs({ k: "tuple", elements: els }, undefined, undefined, conf);
          acc = acc === undefined ? sub : joinAbs(acc, sub);
        }
        return acc!;
      }
      const el = kept.reduce((a, b) => joinAbs(a, b));
      return abs({ k: "arr", element: el }, undefined, undefined, conf);
    }
    // arr：filter 保持元素类型（不传播回调 pred）
    return arr;
  }
  if (method === "flatMap") {
    // Bug 55：GetCallback 前置校验（空接收者零迭代也要抛）
    validateCallableArg(args[0], "flatMap callback may not be callable");
    if (shape.k === "tuple") {
      const mapped = shape.elements.map((el, i) =>
        isHole(i) ? abs({ k: "tuple", elements: [] }, undefined, undefined, "exact") : callFn(args[0], el, $lit(i), arr),
      );
      return projectFlatMapResult(arr.conf, mapped);
    }
    const out = callFn(args[0], shape.element, unknownIdx(), arr);
    return projectFlatMapResult(arr.conf, [out]);
  }
  if (method === "forEach") {
    // Bug 55：GetCallback 前置校验（空接收者零迭代也要抛）
    validateCallableArg(args[0], "forEach callback may not be callable");
    if (shape.k === "tuple") {
      shape.elements.forEach((el, i) => {
        if (!isHole(i)) callFn(args[0], el, $lit(i), arr);
      });
    } else {
      callFn(args[0], shape.element, unknownIdx(), arr);
    }
    return undefAbs();
  }
  if (method === "some" || method === "every") {
    // Bug 55：GetCallback 前置校验（[].some(Symbol()) 零迭代不再折假 false/true）
    validateCallableArg(args[0], `${method} callback may not be callable`);
    // 逐位短路：具体命中即停（some: truthy / every: falsy），副作用计数与原生一致。
    // 规范 some/every 检查 HasProperty：hole 位置跳过回调（与 find/findIndex 相反）。
    let undecided = false;
    if (shape.k === "tuple") {
      for (let i = 0; i < shape.elements.length; i++) {
        if (isHole(i)) continue;
        const t = callbackTruth(callFn(args[0], shape.elements[i]!, $lit(i), arr));
        if (t === undefined) {
          undecided = true;
          continue;
        }
        if (method === "some" && t) return boolLit(true);
        if (method === "every" && !t) return boolLit(false);
      }
    } else {
      const t = callbackTruth(callFn(args[0], shape.element, unknownIdx(), arr));
      // 抽象 arr 长度未知（可能空）：单代表元素无法下结论
      if (t === undefined) return bool();
      if (method === "some" && t) return boolLit(true);
      if (method === "every" && !t) return boolLit(false);
      return bool();
    }
    if (undecided) return bool();
    return boolLit(method === "some" ? false : true);
  }
  if (method === "find") {
    // Bug 55：GetCallback 前置校验
    validateCallableArg(args[0], "find callback may not be callable");
    if (shape.k === "tuple") {
      let undecided = false;
      for (let i = 0; i < shape.elements.length; i++) {
        const el = shape.elements[i]!;
        const t = callbackTruth(callFn(args[0], el, $lit(i), arr));
        if (t === true) return el;
        if (t === undefined) undecided = true;
      }
      if (undecided) {
        const joined = shape.elements.reduce((a, b) => joinAbs(a, b));
        return joinAbs(joined, undefAbs());
      }
      return undefAbs();
    }
    const el = shape.element;
    const t = callbackTruth(callFn(args[0], el, unknownIdx(), arr));
    if (t === true) return el;
    if (t === false) return undefAbs();
    return joinAbs(el, undefAbs());
  }
  if (method === "findIndex") {
    // Bug 73：GetCallback 前置校验——[].findIndex(Symbol()) 零迭代不得折 -1 #exact
    validateCallableArg(args[0], "findIndex callback may not be callable");
    if (shape.k === "tuple") {
      let undecided = false;
      for (let i = 0; i < shape.elements.length; i++) {
        const t = callbackTruth(callFn(args[0], shape.elements[i]!, $lit(i), arr));
        if (t === true) return $lit(i);
        if (t === undefined) undecided = true;
      }
      if (undecided) return joinAbs(unknownIdx(), $lit(-1));
      return $lit(-1);
    }
    const t = callbackTruth(callFn(args[0], shape.element, unknownIdx(), arr));
    if (t === true) return unknownIdx();
    if (t === false) return $lit(-1);
    return joinAbs(unknownIdx(), $lit(-1));
  }
  if (method === "findLast" || method === "findLastIndex") {
    // Bug 74：find/findIndex 的逆序孪生——自尾向前首个命中
    validateCallableArg(args[0], `${method} callback may not be callable`);
    const wantIndex = method === "findLastIndex";
    if (shape.k === "tuple") {
      let undecided = false;
      for (let i = shape.elements.length - 1; i >= 0; i--) {
        const t = callbackTruth(callFn(args[0], shape.elements[i]!, $lit(i), arr));
        if (t === true) return wantIndex ? $lit(i) : shape.elements[i]!;
        if (t === undefined) undecided = true;
      }
      if (undecided) {
        const joined = shape.elements.length
          ? shape.elements.reduce((a, b) => joinAbs(a, b))
          : unknown;
        return wantIndex ? joinAbs(unknownIdx(), $lit(-1)) : joinAbs(joined, undefAbs());
      }
      return wantIndex ? $lit(-1) : undefAbs();
    }
    const t = callbackTruth(callFn(args[0], shape.element, unknownIdx(), arr));
    if (wantIndex) {
      if (t === true) return unknownIdx();
      if (t === false) return $lit(-1);
      return joinAbs(unknownIdx(), $lit(-1));
    }
    if (t === true) return shape.element;
    if (t === false) return undefAbs();
    return joinAbs(shape.element, undefAbs());
  }
  if (method === "join") {
    // Bug 36：join 逐元素 ToString——symbol 元素确定 TypeError（[Symbol()].join()
    // 原生抛）；any/真 unknown 元素 may（validateJoinElements 与一等 join 路径
    // 共用）。字面量分隔符 + 全字面量元组 → 精确折叠（原生 ToString 语义，
    // 含 hole→""、nullish 元素→""）；其余合法路径保持 path-string（不假精确）。
    const folded = arrayJoinWithSep(arr, args[0]);
    if (folded !== undefined) return folded;
    validateJoinElements(arr);
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  if (method === "toString" || method === "toLocaleString") {
    // Array.prototype.toString = join(",")：全字面量元素折叠；含 symbol 元素 TypeError
    return arrayJoinToString(arr);
  }
  if (method === "keys") {
    if (shape.k === "tuple") {
      // 原生数组迭代器：0..length-1 全下标（不跳过 hole），键是 number
      // （自有属性键才是字符串——Object.keys / for-in 不受此影响）
      return abs(
        {
          k: "tuple",
          elements: shape.elements.map((_, i) => numLit(i)),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    return abs({ k: "arr", element: unknownIdx() }, undefined, undefined, "partial");
  }
  if (method === "values") {
    if (shape.k === "tuple") {
      const holes = shape.holes ?? [];
      // 原生迭代器不跳过 hole：hole 位按 Get 语义产出 undefined
      return abs(
        {
          k: "tuple",
          elements: shape.elements.map((el, i) => (holes.includes(i) ? undefAbs() : el)),
        },
        undefined,
        undefined,
        arr.conf,
      );
    }
    return arr;
  }
  if (method === "entries") {
    if (shape.k === "tuple") {
      const holes = shape.holes ?? [];
      return abs(
        {
          k: "tuple",
          elements: shape.elements.map((el, i) =>
            abs(
              { k: "tuple", elements: [numLit(i), holes.includes(i) ? undefAbs() : el] },
              undefined,
              undefined,
              "exact",
            ),
          ),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    return abs(
      {
        k: "arr",
        element: abs(
          { k: "tuple", elements: [unknownIdx(), shape.element] },
          undefined,
          undefined,
          "partial",
        ),
      },
      undefined,
      undefined,
      "partial",
    );
  }
  if (method === "fill" && args.length >= 1) {
    // 表达式值 = 变更后数组本身；start/end 折叠复用语句级 fillTuple
    // （字面量精确窗口；抽象边界 join 回退；Symbol 等非法参数保守）
    return fillTuple(shape, args, arr);
  }
  if (method === "sort" || method === "toSorted") {
    // Bug 51/74：GetSortComparator——缺省/严格 undefined → 默认比较器；
    // null/prim/非可调用（含 symbol）→ 确定 TypeError；any/抽象 → may。
    // 默认比较器（ToString 序）下全字面量元组精确排序（undefined 恒排尾
    // 不参与比较；≥2 个可比较元素含 symbol → 比较 ToString 确定 TypeError）；
    // 比较器在场 / 抽象元素 → 位次不可信，tuple 降 arr（元素 join，与语句级
    // $arrMutContainer 同口径）。
    validateCallableArg(args[0], `${method} comparator may not be callable`, {
      undefinedOk: true,
    });
    if (shape.k === "arr") {
      return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
    }
    const slots = shape.elements.map((el, i) => (isHole(i) ? undefAbs() : el));
    const isUndefLit = (el: Abs): boolean =>
      el.term?.op === "lit" && el.term.value === undefined;
    const isDefaultCmp =
      args[0] === undefined ||
      (!!asAbs(args[0])?.term && asAbs(args[0])!.term!.op === "lit" &&
        (asAbs(args[0])!.term as { value: unknown }).value === undefined);
    if (isDefaultCmp) {
      const comparable = slots.filter((el) => !isUndefLit(el));
      if (comparable.length >= 2 && comparable.some((el) => isSymbolAbs(el))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (slots.every((el) => el.term?.op === "lit")) {
        const vals = slots.map((el) => {
          const r = litValue(el);
          return r.ok ? r.value : undefined;
        });
        if (vals.every((v) => v === undefined || typeof v !== "object")) {
          const sortedVals = vals.filter((v) => v !== undefined).sort();
          const undefCount = vals.length - sortedVals.length;
          const els = [
            ...sortedVals.map((v) => $lit(v)),
            ...Array.from({ length: undefCount }, () => undefAbs()),
          ];
          return abs(
            { k: "tuple", elements: els },
            undefined,
            undefined,
            confJoin(arr.conf, "path"),
          );
        }
      }
    }
    const el = shape.elements.length
      ? shape.elements.reduce((x, y) => joinAbs(x, y))
      : unknown;
    return abs({ k: "arr", element: el }, undefined, undefined, confJoin(arr.conf, "path"));
  }
  if (method === "reverse") {
    // Bug 71：表达式位置镜像语句级 $arrMutContainer 语义（holes 随元素镜像
    // 翻转），返回反转后数组；抽象 arr 顺序未建模、元素不变
    if (shape.k === "tuple") {
      const len = shape.elements.length;
      const holesR = shape.holes ? shape.holes.map((h) => len - 1 - h) : undefined;
      return abs(
        {
          k: "tuple",
          elements: [...shape.elements].reverse(),
          holes: holesR && holesR.length > 0 ? holesR : undefined,
        },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
  }
  if (method === "toReversed") {
    // Bug 66：非变更拷贝——hole 位按 Get 语义写实 undefined（与 reverse 不同）
    if (shape.k === "tuple") {
      return abs(
        {
          k: "tuple",
          elements: [...shape.elements]
            .reverse()
            .map((el, i) => (((shape.holes ?? []).includes(shape.elements.length - 1 - i)) ? undefAbs() : el)),
        },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
  }
  if (method === "flat") {
    // Bug 66：depth 经 ToIntegerOrInfinity（symbol/bigint → 确定 TypeError；
    // 抽象 → may）。字面量 depth 递归展开（缺省/undefined → 1；负数/NaN → 0
    // 即浅拷贝不展开）；抽象 depth 保守并「不展开」与「全展开」两域。
    validateIndexArg(args[0], "flat depth may not be convertible to a number");
    const depthRaw = toIOI(args[0]);
    const holeSet = new Set(holes);
    /** 递归展开：返回 null = 途中遇到抽象 arr（长度未知）→ 整体降 arr */
    const rec = (
      els: Abs[],
      hs: Set<number>,
      d: number,
    ): { els: Abs[]; degraded: boolean } | null => {
      const out: Abs[] = [];
      let degraded = false;
      for (let i = 0; i < els.length; i++) {
        if (hs.has(i)) continue; // 原生 flat 跳过 hole（不产 undefined）
        const el = els[i]!;
        if (d > 0 && el.shape.k === "tuple") {
          const sub = rec(
            el.shape.elements,
            new Set(el.shape.holes ?? []),
            d - 1,
          );
          if (sub === null) return null;
          out.push(...sub.els);
          degraded = degraded || sub.degraded;
          continue;
        }
        if (d > 0 && el.shape.k === "arr") return null;
        out.push(el);
      }
      return { els: out, degraded };
    };
    if (shape.k === "arr") {
      // 抽象数组：元素可能本身是数组（展开并入其元素域）也可能原样保留
      const es = shape.element.shape;
      const innerEls =
        es.k === "tuple"
          ? es.elements.length
            ? es.elements.reduce((x, y) => joinAbs(x, y))
            : unknown
          : es.k === "arr"
            ? es.element
            : undefined;
      const el = innerEls !== undefined ? joinAbs(shape.element, innerEls) : shape.element;
      return abs({ k: "arr", element: el }, undefined, undefined, "partial");
    }
    if (depthRaw === null) {
      // 抽象 depth：0..∞ 皆可能 → 元素域 = 浅层元素 ∪ 全展开元素
      recordMayThrow({
        kind: "TypeError",
        cause: "flat depth may not be convertible to a number",
      });
      const shallow = rec(shape.elements, holeSet, 0);
      const deep = rec(shape.elements, holeSet, Number.MAX_SAFE_INTEGER);
      if (shallow !== null && deep !== null) {
        const el = [...shallow.els, ...deep.els].reduce((x, y) => joinAbs(x, y));
        return abs({ k: "arr", element: el }, undefined, undefined, "partial");
      }
      return unknown;
    }
    const depth = depthRaw === undefined ? 1 : Math.max(depthRaw, 0);
    const r = rec(shape.elements, holeSet, depth);
    if (r === null) {
      // 含抽象 arr 展开：长度未知 → arr（元素 join）
      const shallow = rec(shape.elements, holeSet, 0);
      const el = shallow && shallow.els.length
        ? shallow.els.reduce((x, y) => joinAbs(x, y))
        : unknown;
      return abs({ k: "arr", element: el }, undefined, undefined, "partial");
    }
    if (r.degraded) {
      const el = r.els.length ? r.els.reduce((x, y) => joinAbs(x, y)) : unknown;
      return abs({ k: "arr", element: el }, undefined, undefined, "partial");
    }
    return abs(
      { k: "tuple", elements: r.els },
      undefined,
      undefined,
      confJoin(arr.conf, "path"),
    );
  }
  if (method === "toSpliced") {
    // Bug 66：start/skipCount 经 ToIntegerOrInfinity（symbol/bigint → 确定
    // TypeError；抽象 → may）；skipCount 缺省 = len-start；items 原样插入
    // （值实参不转换）；窗口 clamp（OOB 不抛——与 with 不同）
    validateIndexArg(args[0], "toSpliced start may not be convertible to a number");
    validateIndexArg(args[1], "toSpliced skipCount may not be convertible to a number");
    const items = args.slice(2);
    if (shape.k === "tuple") {
      const st = toIOI(args[0]);
      const dc = args[1] === undefined ? undefined : toIOI(args[1]);
      if (st === null || dc === null) {
        // 抽象窗口：任意删除都可能 → 元素 ∪ items join 降 arr
        const parts = [...shape.elements.filter((_, i) => !isHole(i)), ...items];
        const el = parts.length ? parts.reduce((x, y) => joinAbs(x, y)) : unknown;
        return abs({ k: "arr", element: el }, undefined, undefined, "partial");
      }
      const len = shape.elements.length;
      const a = st === undefined ? 0 : st < 0 ? Math.max(len + st, 0) : Math.min(st, len);
      const skip = dc === undefined ? len - a : Math.max(0, Math.min(dc, len - a));
      const solid = (el: Abs, i: number): Abs => (isHole(i) ? undefAbs() : el);
      const els = [
        ...shape.elements.slice(0, a).map(solid),
        ...items,
        ...shape.elements.slice(a + skip).map((el, i) => solid(el, a + skip + i)),
      ];
      return abs(
        { k: "tuple", elements: els },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    const parts = [shape.element, ...items];
    return abs(
      { k: "arr", element: parts.reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      "partial",
    );
  }
  if (method === "with") {
    // Bug 66：index 经 ToIntegerOrInfinity（symbol/bigint → 确定 TypeError）；
    // OOB 字面量（idx ∉ [0, len)，负数自尾相对）→ 确定 RangeError；抽象下标
    // → may RangeError + 每位 join(value)；with 写实 → 该位不再是 hole
    validateIndexArg(args[0], "with index may not be convertible to a number");
    const v = args[1] ?? undefAbs();
    if (shape.k === "tuple") {
      const iv = toIOI(args[0]) ?? 0;
      if (iv === null) {
        recordMayThrow({ kind: "RangeError", cause: "with index may be out of range" });
        return abs(
          { k: "tuple", elements: shape.elements.map((el) => joinAbs(el, v)) },
          undefined,
          undefined,
          "partial",
        );
      }
      const len = shape.elements.length;
      const idx = iv < 0 ? len + iv : iv;
      if (idx < 0 || idx >= len) throw new NudoThrow(errorTypeAbs("RangeError"));
      // 原生 with 逐位 CreateDataProperty——非目标 hole 也写实 undefined
      const els = shape.elements.map((el, i) =>
        i === idx ? v : isHole(i) ? undefAbs() : el,
      );
      return abs(
        { k: "tuple", elements: els },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    return abs(
      { k: "arr", element: joinAbs(shape.element, v) },
      undefined,
      undefined,
      "partial",
    );
  }
  if (method === "concat") {
    // Bug 66：数组实参展开、其余原样追加（Symbol.isConcatSpreadable 未建模）；
    // 任一实参为抽象 arr → 结果长度未知降 arr。hole 保留（原生 concat 走
    // HasProperty/CreateDataProperty——接收者与 tuple 实参的 hole 平移存活）
    if (shape.k === "tuple") {
      const out: Abs[] = [...shape.elements];
      const holesC = new Set(holes);
      let degraded = false;
      for (const a of args) {
        const aa = asAbs(a) ?? unknown;
        if (aa.shape.k === "tuple") {
          const argHoles = aa.shape.holes ?? [];
          const base = out.length;
          for (let i = 0; i < aa.shape.elements.length; i++) {
            if (argHoles.includes(i)) holesC.add(base + i);
          }
          out.push(...aa.shape.elements);
        } else if (aa.shape.k === "arr") {
          out.push(aa.shape.element);
          degraded = true;
        } else out.push(aa);
      }
      if (degraded) {
        const el = out.length ? out.reduce((x, y) => joinAbs(x, y)) : unknown;
        return abs({ k: "arr", element: el }, undefined, undefined, "partial");
      }
      const holesOut = [...holesC];
      return abs(
        {
          k: "tuple",
          elements: out,
          holes: holesOut.length > 0 ? holesOut : undefined,
        },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    const parts = [shape.element, ...args.map((a) => {
      const aa = asAbs(a) ?? unknown;
      return aa.shape.k === "arr" || aa.shape.k === "tuple"
        ? aa.shape.k === "arr"
          ? aa.shape.element
          : (aa.shape.elements.length ? aa.shape.elements.reduce((x, y) => joinAbs(x, y)) : unknown)
        : aa;
    })];
    return abs(
      { k: "arr", element: parts.reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      "partial",
    );
  }
  if (method === "slice") {
    // Bug 66：start/end 经 ToIntegerOrInfinity（symbol/bigint → 确定 TypeError；
    // 抽象 → may）；字面量窗口精确子元组（holes 随窗口平移保留）
    validateIndexArg(args[0], "slice start may not be convertible to a number");
    validateIndexArg(args[1], "slice end may not be convertible to a number");
    if (shape.k === "tuple") {
      const st = toIOI(args[0]);
      const en = toIOI(args[1]);
      if (st === null || en === null) {
        const el = shape.elements.length
          ? shape.elements.reduce((x, y) => joinAbs(x, y))
          : unknown;
        return abs({ k: "arr", element: el }, undefined, undefined, "partial");
      }
      const len = shape.elements.length;
      const s = st === undefined ? 0 : st < 0 ? Math.max(len + st, 0) : Math.min(st, len);
      const e = en === undefined ? len : en < 0 ? Math.max(len + en, 0) : Math.min(en, len);
      if (e <= s) {
        return abs({ k: "tuple", elements: [] }, undefined, undefined, confJoin(arr.conf, "exact"));
      }
      const holesS = (shape.holes ?? [])
        .filter((h) => h >= s && h < e)
        .map((h) => h - s);
      return abs(
        {
          k: "tuple",
          elements: shape.elements.slice(s, e),
          holes: holesS.length > 0 ? holesS : undefined,
        },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
  }
  if (method === "indexOf" || method === "lastIndexOf") {
    // Bug 66：严格等号扫描（hole 跳过——原生 HasProperty 语义；NaN !== NaN）；
    // fromIndex 经 ToIntegerOrInfinity（symbol/bigint → 确定 TypeError；
    // 抽象 → may）；全字面量可判 → 精确下标或 -1，否则 number path
    validateIndexArg(args[1], `${method} fromIndex may not be convertible to a number`);
    if (shape.k === "tuple") {
      const els = shape.elements;
      const search = args[0];
      const searchLit =
        search !== undefined && search.term?.op === "lit" ? litValue(search) : undefined;
      const hasLitSearch = search !== undefined && search.term?.op === "lit";
      const from = toIOI(args[1]);
      if (from === null) return unknownIdx();
      const len = els.length;
      if (!hasLitSearch || !els.every((el, i) => isHole(i) || el.term?.op === "lit")) {
        // 抽象 search 或抽象元素：可能命中任意位（空元组除外）
        if (len === 0 || els.every((_, i) => isHole(i))) return $lit(-1);
        return unknownIdx();
      }
      const sv = searchLit!.ok ? searchLit!.value : undefined;
      const eq = (el: Abs): boolean | undefined => {
        const r = litValue(el);
        if (!r.ok) return undefined;
        return r.value === sv; // 严格等号（NaN !== NaN 由 === 自然成立）
      };
      if (method === "indexOf") {
        let start = from === undefined ? 0 : from < 0 ? Math.max(len + from, 0) : Math.min(from, len - 1);
        for (let i = start; i < len; i++) {
          if (isHole(i)) continue;
          const t = eq(els[i]!);
          if (t === undefined) return unknownIdx();
          if (t) return $lit(i);
        }
        return $lit(-1);
      }
      let start = from === undefined ? len - 1 : from < 0 ? len + from : Math.min(from, len - 1);
      for (let i = start; i >= 0; i--) {
        if (isHole(i)) continue;
        const t = eq(els[i]!);
        if (t === undefined) return unknownIdx();
        if (t) return $lit(i);
      }
      return $lit(-1);
    }
    return unknownIdx();
  }
  if (method === "includes") {
    return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
  }
  // C1.4：语句重绑走 $arrMutContainer（容器）；表达式位置按 JS 语义返回 length
  if (method === "push" || method === "unshift") {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  if (method === "pop") {
    if (shape.k === "tuple") {
      return shape.elements.length > 0
        ? (shape.elements[shape.elements.length - 1] ?? unknown)
        : undefAbs();
    }
    if (shape.k === "arr") return joinAbs(shape.element, undefAbs());
  }
  if (method === "shift") {
    if (shape.k === "tuple" && shape.elements.length > 0) {
      return shape.elements[0] ?? unknown;
    }
    if (shape.k === "arr") return joinAbs(shape.element, undefAbs());
  }
  if (method === "at") {
    // ToIntegerOrInfinity：缺省/undefined/null/NaN → 0；true → 1；'1' → 1；
    // 1.9 → 1；±∞ → OOB undefined。抽象下标 join 全部元素 ∪ undefined。
    // Bug 67：symbol/bigint 下标确定 TypeError（shape 判定——无 lit 项）；
    // 抽象下标 → may TypeError 后走保守 join
    validateIndexArg(args[0], "at index may not be convertible to a number");
    const iv = toIntegerOrInfinityLit(args[0]);
    if (shape.k === "tuple") {
      const els = shape.elements;
      if (iv === undefined) {
        if (els.length === 0) return undefAbs();
        return joinAbs(els.reduce((a, b) => joinAbs(a, b)), undefAbs());
      }
      const idx = iv < 0 ? els.length + iv : iv;
      if (idx >= 0 && idx < els.length) return els[idx] ?? unknown;
      return undefAbs();
    }
    if (shape.k === "arr") return joinAbs(shape.element, undefAbs());
  }
  return undefined;
}

/** super.method()：从父类起找（跳过自身覆盖） */
export function $invokeSuper(
  thisVal: Abs,
  childName: string,
  method: string,
  args: Abs[],
): Abs {
  // Bug 79：super.m() 是方法调用（普通调用面）——new.target 归 undefined
  return withNewTargetReset(() => {
    const child = getEvalClass(childName);
    const parentName = child?.superName;
    if (!parentName) return unknown;
    const m = findMethod(parentName, method);
    if (!m) return unknown;
    return m(thisVal, ...args);
  });
}

/** 类实例方法内 super.p / super[k] 属性读（Bug 14）：父类原型链上的
 *  访问器以 this 调用；实例字段/自有槽不在查找面（super 读的是原型）。
 *  方法作为值（super.m 未调用）不做 fn Abs 投影——诚实 unknown。 */
export function $getSuper(thisVal: Abs, childName: string, key: Abs): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return unknown;
  const parentName = getEvalClass(childName)?.superName;
  if (!parentName) return unknown;
  const acc = findClassAccessor(parentName, k);
  if (acc?.get) return acc.get(thisVal);
  return unknown;
}

/** 类实例方法内 super[k](args) 计算键调用（Bug 14）：ToPropertyKey 后沿父类链派发 */
export function $invokeSuperKey(
  thisVal: Abs,
  childName: string,
  key: Abs,
  args: Abs[],
): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return unknown;
  const parentName = getEvalClass(childName)?.superName;
  if (!parentName) return unknown;
  const m = findMethod(parentName, k);
  if (!m) return unknown;
  return withNewTargetReset(() => m(thisVal, ...args));
}

/**
 * 对象字面量方法内 super 派发（Bug 19）：home object 的原型（运行时
 * 侧表，setProtoAbs 记录）沿链查找方法/访问器（排除自有——否则覆盖方法
 * 自递归），以接收者 thisVal 调用/求值。链未建模（无显式原型设定 /
 * Object.prototype 面）→ 诚实 unknown。
 */
const SUPER_PROTO_CHAIN_LIMIT = 8;

function superProtoOf(o: Abs): Abs | undefined {
  return o.shape.k === "obj" ? getProtoAbs(o) : undefined;
}

/** super.m() / super[k]()：原型链方法查找 + receiver 注入调用 */
export function $invokeSuperObj(thisVal: Abs, key: Abs, args: Abs[]): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return unknown;
  let cur = superProtoOf(thisVal);
  let hops = 0;
  while (cur && hops++ < SUPER_PROTO_CHAIN_LIMIT) {
    if (cur.shape.k === "obj") {
      const slot = getSlot(cur.shape.slots, k);
      const impl = slot ? getFnImpl(slot.value) : undefined;
      if (impl) {
        return withNewTargetReset(() =>
          impl.bindThis ? $call(slot!.value, [thisVal, ...args]) : $call(slot!.value, args),
        );
      }
    }
    cur = superProtoOf(cur);
  }
  return unknown;
}

/** super.v / super[k]：原型链属性读（访问器 getter 以 this 调用；数据槽直读） */
export function $getSuperObj(thisVal: Abs, key: Abs): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return unknown;
  let cur = superProtoOf(thisVal);
  let hops = 0;
  while (cur && hops++ < SUPER_PROTO_CHAIN_LIMIT) {
    if (cur.shape.k === "obj") {
      const acc = lookupObjAccessor(cur, k);
      if (acc?.get) return acc.get(thisVal);
      const slot = getSlot(cur.shape.slots, k);
      if (slot) return slot.value;
    }
    cur = superProtoOf(cur);
  }
  return unknown;
}

export function $thisGet(thisVal: Abs, key: string): Abs {
  if (thisVal.shape.k === "brand") {
    const inner = thisVal.shape.shape;
    if (inner.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      if (slot) return slot.value;
    }
  }
  return unknown;
}

export function $thisSet(thisVal: Abs, key: string, value: Abs): Abs {
  if (thisVal.shape.k === "brand") {
    const inner = thisVal.shape.shape;
    const slots = inner.shape.k === "obj" ? { ...inner.shape.slots } : {};
    setSlot(slots, key, { value: asAbsVal(value) });
    return abs(
      {
        k: "brand",
        name: thisVal.shape.name,
        shape: objOf(slots),
      },
      thisVal.term,
      thisVal.pred,
      confJoin(thisVal.conf, value.conf),
    );
  }
  return unknown;
}

/** 解构默认值：undefined（含 sum 成员 / 可能缺失）时用 default 并入非 undefined 部分 */
export function $orDefault(v: Abs, dflt: () => Abs): Abs {
  // 实参缺失：transpile 占位参数收到 JS undefined（非 Abs）
  if (v === undefined) return asAbsVal(dflt());
  if (isDefinitelyUndefinedAbs(v)) return asAbsVal(dflt());
  // sum / optional 可能含 undefined → JS 用 default 替换该成员，域是 dflt ∪ non-undefined
  if (v.shape.k === "sum") {
    const d = asAbsVal(dflt());
    const parts: Abs[] = [];
    let sawUndef = false;
    for (const m of v.shape.members) {
      if (isDefinitelyUndefinedAbs(m)) {
        sawUndef = true;
        continue;
      }
      parts.push(m);
    }
    if (!sawUndef) return v;
    if (parts.length === 0) return d;
    let joined = parts[0]!;
    for (let i = 1; i < parts.length; i++) joined = joinAbs(joined, parts[i]!);
    return joinAbs(joined, d);
  }
  return v;
}

function isDefinitelyUndefinedAbs(v: Abs | undefined): boolean {
  if (!v) return false;
  if (v.term?.op === "lit" && v.term.value === undefined) return true;
  // unknown + lit(undefined) 的历史折叠形（tagged：.ok 且 value===undefined 才是 lit(undefined)）
  const r = litValue(v);
  if (v.shape.k === "unknown" && r.ok && r.value === undefined) return true;
  return false;
}

function isNullishAbs(v: Abs): boolean {
  // 仅明确 null/undefined 字面量；对象等无 term 不算 nullish
  if (!v || v.term?.op !== "lit") return false;
  const lv = v.term.value;
  return lv === null || lv === undefined;
}

/** 可选链 a?.b：nullish 短路为 undefined 字面量。非 nullish 臂的属性读对
 *  非 nullish 值原生不抛 → silent（不记 any may-throw，Bug 3） */
export function $optionalGet(o: Abs, key: string): Abs {
  if (isNullishAbs(o)) {
    return abs(
      { k: "unknown" },
      { op: "lit", value: undefined },
      undefined,
      "exact",
    );
  }
  return $get(o, key, { silent: true });
}

/** 可选链 a?.m()：nullish 短路为 undefined */
export function $optionalInvoke(thisVal: Abs, method: string, args: Abs[]): Abs {
  if (isNullishAbs(thisVal)) {
    return abs(
      { k: "unknown" },
      { op: "lit", value: undefined },
      undefined,
      "exact",
    );
  }
  return $invoke(thisVal, method, args);
}

/** 静态方法：cls.staticMethod(args) */
export function $staticInvoke(cls: Abs, method: string, args: Abs[]): Abs {
  // Bug 79：静态方法调用是普通调用面——new.target 归 undefined
  return withNewTargetReset(() => {
    const spec = specOf(cls);
    const className = spec?.name ?? (cls.shape.k === "brand" ? cls.shape.name : undefined);
    // Bug 18：静态方法沿 superName 继承链查找（空派生类 B.m() 不断链）
    const m = className ? findStaticMethod(className, method) : undefined;
    if (!m) return unknown;
    const recordName = className ? `${className}.${method}` : method;
    let result: Abs = unknown;
    let threw = false;
    try {
      result = m(...args);
      return result;
    } catch (e) {
      threw = true;
      result = throwPayloadOf(e);
      throw e;
    } finally {
      noteEvalCallRecord({ fnName: recordName, args, result, threw });
    }
  });
}

/** 计算属性写：o[kAbs] = v。非字面量 key → open + index join（不得写成字面槽 "?"） */
export function $setKey(o: Abs, key: Abs, value: Abs): Abs {
  // ToPropertyKey：null/undefined/boolean 字面量 → "null"/"undefined"/"true"
  const pk = propertyKeyOf(key);
  const k = pk !== undefined ? pk : litValue(key);
  if (typeof k === "string" || typeof k === "number") {
    const ks = String(k);
    // 对象字面量计算键 `{['__proto__']: v}` 是自有数据属性（CreateDataProperty），
    // 不是 `o.__proto__ = v` 的 setter。与 $set 分流。
    if (ks === "__proto__" && o.shape.k === "obj") {
      setSlot((o.shape as { slots: Record<string, { value: Abs }> }).slots, ks, {
        value: asAbsVal(value),
      });
      o.conf = confJoin(o.conf, value.conf);
      clearStaleTermPred(o);
      return o;
    }
    return $set(o, ks, value);
  }
  const val = asAbsVal(value);
  if (o.shape.k === "brand") {
    const inner = $setKey(o.shape.shape, key, value);
    return abs(
      { k: "brand", name: o.shape.name, shape: inner },
      o.term,
      o.pred,
      confJoin(o.conf, value.conf),
    );
  }
  if (o.shape.k !== "obj") {
    return abs(
      {
        k: "obj",
        slots: {},
        index: { key: unknown, value: val },
        open: true,
      },
      undefined,
      undefined,
      confJoin("path", value.conf),
    );
  }
  const shape = o.shape as { slots: Record<string, { value: Abs; optional?: boolean }>; index?: { key: Abs; value: Abs }; open?: boolean };
  const prevIndex = shape.index?.value;
  const indexVal = prevIndex ? joinAbs(prevIndex, val) : val;
  const next = objOf({ ...shape.slots }, {
    index: { key: shape.index?.key ?? unknown, value: indexVal },
    open: true,
  });
  next.conf = confJoin(o.conf, value.conf);
  return next;
}
