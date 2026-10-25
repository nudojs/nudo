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
 * - Bug 152：实参可以是 **thunk**（`() => [args]`）——调用点成员**先于实参**
 *   求值（原生 CallExpression 顺序：引用取值（getter 在此触发）→ 实参 →
 *   调用）。thunk 形态：$invoke 先读成员（预读），再求实参，最后派发；
 *   派发复用预读值（不再二次读 ⇒ getter 只跑一次）。预读对 sum（union）
 *   接收者跳过（派发按成员各读一次，预读会重复触发 getter）。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown, litValue, strLit, isBigPrim } from "../../abs.ts";
import { joinAbs, getSlot, propertyKeyOf } from "../../objects.ts";
import { TYPED_ARRAY_CALLBACK_METHODS, builtinSuperCtorOf, brandHasProtoMember, classChainHasHole, evalClassChain, BUILTIN_BRAND_METHODS, chainProtoSlotOf, findStaticClassAccessor } from "../runtime/members.ts";
import { typedArrayElementOf } from "../../builtins/shared.ts";
import { typedArrayEnumKeyView } from "../../builtins/object/enum-entries.ts";
import { MAX_CONCRETE_LOOP_ITERS } from "../runtime/loop-budget.ts";
import { $get, $lit, namespaceNameOf, callAtFunctionBoundary } from "../runtime.ts";
import { withNewTargetReset, undef, asAbsVal } from "../runtime/state.ts";
import { $call } from "../call.ts";
import { callHostGlobalFn } from "../calls.ts";
import { getFnImpl, absFunction, hostFnCtorFacet, isAbsApplyResult } from "../../abs-fn.ts";
import { evalNamespaceCall, evalBuiltinInstanceMethod, isSymbolAbs, stringOfSymbol, evalPromiseMethod, boxedPrimitiveValue, sumHasPrimMember, evalArrayStatic, collectionIteratorAbs, abstractSeqIteratorAbs, protoBrandAbs } from "../../builtins.ts";
import { isErrorCtorName } from "../../builtins/error.ts";
import {
  validateCallableArg,
  setRawArgNormalizer,
} from "../../hof.ts";
import { privateNameGuard } from "../runtime/containers.ts";
// 直连 member.ts（不经 containers barrel）：本模块体加载期即回调本 setter，
// vite SSR 下 barrel 的 re-export 不是实例化期可用绑定（原单文件拓扑中
// setter 是本模块提升函数声明）。barrel 间接层会在此处拿到 undefined。
import { setProtoMethodDispatch, type ClassMethodOrigin } from "../runtime/containers/member.ts";
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
  ARRAY_PROTO_METHOD_NAMES,
  recordMemberDiag,
  STRING_METHODS,
  NUMBER_PROTO_METHODS,
  BOOLEAN_PROTO_METHODS,
  SYMBOL_PROTO_METHODS,
} from "../member-diag.ts";
import { errorTypeAbs, throwPayloadOf, recordMayThrow } from "../may-throw.ts";
import { isNullishLitAbs } from "../../surface.ts";
import { lookupObjAccessor } from "../../accessors.ts";
import { NudoThrow, $collectionForEach } from "../runtime.ts";
import { callAbsMethod } from "../../methods.ts";
import {
  classNameOfValue,
  ensureFnParentName,
  getEvalClass,
  registerEvalClass,
} from "../class-registry.ts";

import { invokeArrMethod } from "./invoke-arr.ts";
import {
  findMethod,
  findStaticMethod,
  instanceOwnFaceHasMember,
  chainHasStaticMember,
  fnAbsCtorProtoOf,
  constructClass,
  markBindCtorFacet,
  bindCtorFacetOf,
} from "./declare.ts";
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

/**
 * Bug 85（+ Bug 882）：实参归一化——函数声明绑定是裸宿主函数（statement.ts
 * 直发 host function），作实参流入 Abs 解引用点 → 内部 TypeError 冒进
 * may-throw ⇒ L2 假红。此处统一归一化实参（函数边界 prologue 的
 * `$absVal` 同口径，copy-on-write：全 Abs 时不分配新数组）。callee 位
 * （thisVal）不动——宿主函数直调路径依赖裸值 apply。
 *
 * Bug 882：同一归一化口径也服务**普通调用面**（具名导入 / 直接调用）——
 * algebra 层 `hof.ts` 的 `setRawArgNormalizer` 注册本门面用的 `asAbsVal`，
 * 两侧共用同一门面 ⇒ 同一宿主函数恒同一 Abs 身份 ⇒ 两种调用口径一致。
 */
export function normalizeCallArgs(args: Abs[]): Abs[] {
  let norm = args;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as unknown;
    if (!(a && typeof a === "object" && "shape" in a)) {
      if (norm === args) norm = args.slice();
      norm[i] = asAbsVal(a);
    }
  }
  return norm;
}

// Bug 882：把「裸宿主值 → Abs」的归一化门面注册给 algebra 层（hof.ts 是
// algebra 叶子，不 import exec，避免 hof ↔ exec 环；同款注册式，与
// setApplyCallbackHost / setHostGlobalCallBridge 一致）。
setRawArgNormalizer(asAbsVal);

/** 实例方法调用：沿继承链；类 Abs 上回落 staticMethods；obj 上回落属性函数 */
export function $invoke(
  thisVal: Abs,
  method: string,
  args: Abs[] | (() => Abs[]),
  loc?: [number, number],
): Abs {
  // Bug 152：实参 thunk（`() => [args]`）——调用点成员**先于实参**求值
  // （原生 CallExpression：引用取值（getter 触发）→ 实参 → 调用）。
  // 发射面（transpile/expr/call.ts）把实参包成 thunk 传入：此处**先读
  // 成员**（预读，getter 在此跑），**再**求实参，最后派发；派发复用预读
  // 值（generic 臂不再二次读 ⇒ getter 只跑一次）。
  // 预读对 sum（union）接收者跳过：派发按成员各读一次（$invokeInner 的
  // sum 臂），预读会与成员读重复（getter 跑两次）。
  let preRead: Abs | undefined;
  let argList: Abs[];
  if (typeof args === "function") {
    if (thisVal?.shape?.k !== "sum") {
      preRead = $get(thisVal, method, { silent: true });
    }
    argList = args();
  } else {
    argList = args;
  }
  // Bug 85：函数声明绑定是裸宿主函数（statement.ts 直发 host function），
  // 作实参流入 Object/Reflect 静态、$in、JSON.stringify、强制转换全局的
  // Abs 解引用点 → 内部 TypeError 冒泡（无 try 折 unknown / 有 try 被用户
  // catch 吞成引擎错误消息）。此处统一归一化实参（函数边界 prologue 的
  // $absVal 同口径，copy-on-write：全 Abs 时不分配新数组）。callee 位
  // （thisVal）不动——宿主函数直调路径依赖裸值 apply
  const normArgs = normalizeCallArgs(argList);
  // Bug 79：方法调用是普通调用面——调用期间 new.target 读 undefined
  return withNewTargetReset(() => $invokeInner(thisVal, method, normArgs, loc, preRead));
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
 *  unknown 是 fail-closed 令牌，不记 may-throw）。
 *  Bug 152：实参 thunk 形态（`() => [args]`）——键求值后**先读成员**再求
 *  实参（原生顺序：键 → 引用取值 → 实参 → 调用）。 */
export function $invokeKey(
  thisVal: Abs,
  key: Abs,
  args: Abs[] | (() => Abs[]),
  loc?: [number, number],
): Abs {
  const k = invokeKeySlotOf(key);
  if (k === undefined) {
    // 键不可折叠：诚实 unknown。实参仍须求值（原生：实参在调用前求值）——
    // thunk 形态须显式触发（副作用不丢）。
    if (typeof args === "function") args();
    return unknown;
  }
  if (k === "@@iterator") {
    const it = iteratorFaceOf(thisVal);
    if (it !== undefined) {
      if (typeof args === "function") args();
      return it;
    }
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
  /** Bug 152：调用点预读值（成员已在实参之前读过——getter 已触发）；未预读
   *  （非 thunk 实参 / sum 接收者）→ 走既有 $get 读。 */
  preRead?: Abs,
): Abs {
  // 私有方法调用（"#" 键）：foreign-receiver brand check
  // （原生 PrivateCall：接收者必须是声明类实例）
  privateNameGuard(thisVal, method);
  // Function.prototype.call/apply/bind：fn Abs **或** 求值引擎 JS 函数（P1）
  // 派发体见 invokeCallApplyBind；undefined = 接收者不可调用（非 fn / 无可
  // 调用 impl / 非类值的普通对象）⇒ 继续后续面（原生此处同样读属性再调用）。
  if (method === "call" || method === "apply" || method === "bind") {
    const callBindR = invokeCallApplyBind(thisVal, method, args);
    if (callBindR !== undefined) return callBindR;
  }
  // 宿主 JS 命名空间对象（Math/Number/JSON…）→ Abs builtin 表
  if (!thisVal || typeof thisVal !== "object" || !("shape" in thisVal)) {
    return invokeNamespaceStatic(thisVal, method, args);
  }
  // Bug 208：内建原型对象上的**自有写**优先于内建方法表（原生 own → prototype
  // 查找序；实现见 invokeProtoOwnWrite）。位置：各内建派发臂之前（promise /
  // regexp / brand / prim / 数组 / 通用槽位面前）——先于一切内建实现。
  const protoOwnR = invokeProtoOwnWrite(thisVal, method, args);
  if (protoOwnR !== undefined) return protoOwnR;
  // Promise 实例方法（then/catch/finally）：映射 resolved 通道
  if (thisVal.shape.k === "eff" && thisVal.shape.eff === "promise") {
    const pr = evalPromiseMethod(method, thisVal, args);
    if (pr !== undefined) return pr;
  }
  // union：只在「持有该方法」的成员上派发，再 join（string|Buffer.split
  // 不应因 Buffer 分支无 split 而整体 unknown）。成员判据 / 缺失诊断见
  // invokeUnionReceiver（Bug 263 / Bug 1045 后续）。
  if (thisVal.shape.k === "sum") {
    return invokeUnionReceiver(thisVal, method, args, loc);
  }
  // RegExp brand exec/test（字面量 pattern 精确执行）
  {
    const reR = execRegexBrand(thisVal, method, args);
    if (reR !== undefined) return reR;
  }
  // brand 接收者：装箱 prim → TypedArray HOF → 内建 brand 方法（含内建父链 /
  // Map·Set forEach）→ 类值静态面（先于实例方法面）→ 用户类实例方法面。
  // 分面实现见 invokeBrandReceiver；undefined = 本面未接管（落通用槽位面）。
  const brandR = invokeBrandReceiver(thisVal, method, args, loc);
  if (brandR !== undefined) return brandR;
  // prim 接收者（bigint / number / boolean）：字面量精确折叠 + 抽象臂保守；
  // 未接管的其它方法不在此 return（继续后续诊断面）。实现见 invokePrimitive。
  const primR = invokePrimitive(thisVal, method, args);
  if (primR !== undefined) return primR;
  // 数组/元组方法
  const arrR = invokeArrayReceiver(thisVal, method, args);
  if (arrR !== undefined) return arrR;
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
  // 属性上的可调用值（require namespace / 对象方法）；method 诊断由下方统一报。
  // Bug 56：protoMethod kind（方法值读通道产物）跳过——$call 不传 receiver，
  // 回环 dispatch 会在 undefined 接收者上假定抛（copyWithin 假 throw）；
  // 借用调用走 $invoke 的 call/apply 分支（receiver 传递正确）。
  // Bug 152：预读值优先——调用点已在实参之前读过成员（getter 已触发），
  // 复用它不再二次读（getter 只跑一次）。判定与调用记录见 invokePropertyValue。
  const prop = preRead !== undefined ? preRead : $get(thisVal, method, { silent: true });
  const propR = invokePropertyValue(thisVal, method, args, prop, loc);
  if (propR !== undefined) return propR;
  // 缺失方法终判 / may-throw / 成员诊断（顺序与判据见 invokeUnresolvedMember）
  return invokeUnresolvedMember(thisVal, method, prop, loc);
}

// ===========================================================================
// $invokeInner 分面 helper（同文件内提取）。返回 undefined = 本面未接管，
// 交回 dispatcher 继续下一面；非 undefined = 该面的最终结果（含 throws）。
// 顺序与 $invokeInner 的顶层守卫严格一致：call/apply/bind → 命名空间静态 →
// 内建原型自有写 → promise → union → RegExp → brand（TA HOF / 内建方法 /
// 类值静态 / 实例方法）→ prim → array → Symbol / string-regex / 方法表 →
// 属性可调用值 → 缺失诊断。参数 loc / preRead 显式传递，预读值只消费一次。
// ===========================================================================

/**
 * Function.prototype.call/apply/bind 派发面（P1）。
 *
 * undefined = 接收者不在可调用面（既非宿主函数，也非 fn Abs / 挂 impl 的
 * 成员值 / 可构造类值）⇒ 交回 dispatcher 继续后续面（原生此时同样按普通
 * 成员读 + 调用处理，例如 `({call: 1}).call()`）。
 */
function invokeCallApplyBind(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
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
        if (lv.ok) {
          // Bug 258：原生 CreateListFromArrayLike 按 **length** 取实参
          // （ToLength → 逐下标 Get）——此前 array-like 实参一律只折
          // **1 个**未知实参（`f.apply(null,{length:2,0:1,1:2})` 原生传
          // 2 个，引擎只传 1 个 ⇒ 实参面塌陷）。
          // length 是字面量 ⇒ 按槽面逐项读（下标缺席 = undefined，原生
          // Get 缺席属性同）；length 抽象 ⇒ 不可判 → [unknown] 保守。
          const raw = lv.value;
          const n = typeof raw === "number" ? raw : Number(raw);
          if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
            const count = Math.trunc(n);
            const out: Abs[] = [];
            for (let i = 0; i < count; i++) {
              const slot = getSlot(s.slots, String(i));
              if (slot && !slot.optional) {
                out.push(slot.value);
              } else {
                // 缺席下标：原生 Get → undefined；open 槽面（索引域未知）
                // → 不可判 ⇒ unknown
                out.push(s.index ? unknown : undef());
              }
            }
            return out;
          }
        }
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
    const hostBoundFn = absFunction(
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
    // Bug 253：bind 产物的 [[Construct]]——原生 `new (f.bind(thisArg,
    // ...bound))()` 走**目标的 [[Construct]]**：以 newTarget.prototype 建
    // 新实例、绑定实参前置、this = 新实例（**忽略**绑定的 thisArg）。
    // 引擎此前 bind 产物只带 apply 钩子 ⇒ $new 复用 apply ⇒ 目标构造器在
    // this === boundThis（常为 null）上执行 ⇒ `new B()` 假抛 TypeError。
    // 构造 facet 走 declare.ts 的模块级 WeakMap 侧表（不改公共类型
    // AbsFnImpl——它在 algebra/index.ts / core/src/index.ts 导出）。
    markBindCtorFacet(hostBoundFn, {
      instName: () => {
        const n = (thisVal as { name?: string }).name || "Object";
        // 与 $new 的宿主函数分支同口径：铸实例 brand 前注册链键
        // （instanceof / 原型槽沿链解析）。
        if (!getEvalClass(n)) registerEvalClass({ name: n });
        return n;
      },
      proto: () => protoBrandAbs((thisVal as { name?: string }).name || "Object"),
      construct: (instance, callArgs) =>
        callAtFunctionBoundary(() => fn.apply(instance as never, [...bound, ...callArgs])),
    });
    return hostBoundFn;
  }
  if (thisVal && typeof thisVal === "object" && "shape" in thisVal) {
    const fnImpl = getFnImpl(thisVal);
    const isCallable = thisVal.shape.k === "fn" || fnImpl !== undefined;
    // Bug 253：类值（class A）也可 bind —— 原生 `A.bind(null, 3)` 走
    // Function.prototype.bind（类值是构造器，产物**可构造**：`new B()` 造
    // 的是 A 的实例）。引擎此前类值不落在 isCallable 面 ⇒ `A.bind` 读面
    // 折 undefined ⇒ `new B()` 假抛 TypeError。
    const isClassValue = thisVal.shape.k === "brand" && thisVal.shape.ctor === true;
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
    }
    if (isCallable || isClassValue) {
      const boundThis = args[0];
      const bound = args.slice(1);
      // Bug 9：bind 产物可构造性随目标（fn facet 传播；类 brand 可构造）
      const tShape = (thisVal as Abs).shape;
      const boundCtor =
        tShape.k === "fn" ? tShape.ctor : tShape.k === "brand" ? true : undefined;
      const absBoundFn = absFunction(
        boundFnParams(thisVal, bound.length),
        {
          apply: (callArgs) =>
            callAtFunctionBoundary(() =>
              $call(thisVal, [...bound, ...callArgs], boundThis),
            ),
        },
        boundCtor !== undefined ? { ctor: boundCtor } : undefined,
      );
      // Bug 253：bind 产物的 [[Construct]]（同宿主函数臂——facet 走 declare.ts
      // 的模块级 WeakMap 侧表）：原生 new bound() 造的是**目标**的实例
      // （this = 新实例、绑定实参前置、忽略绑定的 thisArg）。
      const targetName =
        tShape.k === "brand" || tShape.k === "fn" ? tShape.name : undefined;
      markBindCtorFacet(absBoundFn, {
        instName: () => {
          if (tShape.k === "brand") {
            return classNameOfValue(thisVal) ?? targetName ?? "Anonymous";
          }
          return targetName ?? ensureFnParentName(thisVal);
        },
        proto: () => {
          if (tShape.k === "brand") {
            const cn = classNameOfValue(thisVal) ?? targetName;
            return cn ? protoBrandAbs(cn) : undefined;
          }
          return fnAbsCtorProtoOf(thisVal, targetName ?? ensureFnParentName(thisVal));
        },
        construct: (instance, callArgs) => {
          // bind 套 bind：委托内层 facet（绑定实参前置）
          const inner = bindCtorFacetOf(thisVal);
          if (inner) return inner.construct(instance, [...bound, ...callArgs]);
          const targetImpl = getFnImpl(thisVal);
          if (targetImpl?.apply) {
            const r = targetImpl.apply(
              targetImpl.bindThis
                ? [instance, ...bound, ...callArgs]
                : [...bound, ...callArgs],
              instance,
            );
            return isAbsApplyResult(r) ? r.abs : r;
          }
          // 类值目标：走类构造链（原生 new bound() 造的是目标类的实例）
          const cn = classNameOfValue(thisVal);
          if (cn) return constructClass(cn, instance, [...bound, ...callArgs]);
          return $call(thisVal, [...bound, ...callArgs], instance);
        },
      });
      return absBoundFn;
    }
  }
  return undefined;
}

/**
 * 宿主 JS 命名空间对象（Math / Number / JSON / Object / Reflect …）的静态
 * 方法派发面（调用方已确认 thisVal 不是 Abs 对象）。
 */
function invokeNamespaceStatic(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs {
  const ns = namespaceNameOf(thisVal);
  if (ns === "Object" && method === "assign") {
    return runtimeAssignObject(args);
  }
  const r = ns ? evalNamespaceCall(ns, method, args) : undefined;
  if (r !== undefined) return r;
  // Bug 264：命名空间对象上调用**不存在**的静态方法 ⇒ 原生确定抛
  // TypeError（`Math.clamp is not a function` / `JSON.foo is not a
  // function`）——此前回落 unknown 且**不记 throws** ⇒ L2 门禁假绿
  // （引擎声称「不可能抛」，原生恒抛）。
  // 判据用宿主对象自身的属性查找（含原型链）：成员**缺席** ⇒ 定抛；
  // 成员在场但**不是函数**（`Math.PI()`）⇒ 原生同抛 ⇒ 定抛；
  // 成员在场且是函数但引擎未建模 ⇒ 保守回落 unknown（不假抛）。
  // 宿主命名空间对象既有普通对象（Math / JSON / Reflect）也有**函数**
  // （Object / Number / Symbol / BigInt / Promise …）⇒ 两种 typeof 都要认。
  if (
    ns !== undefined &&
    thisVal !== null &&
    (typeof thisVal === "object" || typeof thisVal === "function")
  ) {
    const host = thisVal as unknown as Record<string, unknown>;
    if (!(method in host)) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (typeof host[method] !== "function") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  return unknown;
}

/**
 * Bug 208：内建原型对象上的**自有写**优先于内建方法表（原生 own → prototype
 * 查找序：原型对象上的自有数据属性遮住内建方法面）——`Array.prototype.push
 * = fn` 后 `a.push(2)` / `"a".toUpperCase()` 走用户写的 fn；改成非函数则
 * 调用定抛 TypeError（`a.push is not a function`）。此前内建方法表直接命中，
 * 用户的写在**调用面**被完全遮蔽（读面同理，归 containers/member.ts）。
 * 位置：各内建派发臂之前（promise / regexp / brand / prim / 数组 / 通用
 * 槽位面前）——先于一切内建实现。
 */
function invokeProtoOwnWrite(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
  const protoOwn = builtinProtoOwnWrite(thisVal, method);
  if (protoOwn !== undefined) {
    if (!isCallableValue(protoOwn)) throw new NudoThrow(errorTypeAbs("TypeError"));
    return $call(protoOwn, args, thisVal);
  }
  return undefined;
}

/**
 * union 接收者：只在「持有该方法」的成员上派发，再 join（string|Buffer.split
 * 不应因 Buffer 分支无 split 而整体 unknown）。
 *
 * Bug 263：成员判据按**方法名**（memberLikelyHasMethod）⇒ number 侧
 * 的 toFixed / toPrecision 等不再被提前排除（值域不再塌成 unknown）；
 * 被判「确定没有该方法」的成员（prim 原型方法表外，如 string 上的
 * toFixed）⇒ 原生调用 undefined ⇒ **该分支定抛 TypeError** ⇒ 记
 * may-throw（soft，catch 可吸收）并跳过该成员（该分支不贡献值）。
 *
 * Bug 1045 后续（S16）：sum 成员可以是 **fn**（构造器 —— 多个 env 名合并
 * 后 `Response` 是两个构造器声明的并集）⇒ fn 的静态成员挂在 fn 的 slots 上
 * （dual-facet）⇒ 判据见 memberLikelyHasMethod 的 fn 分支。
 */
function invokeUnionReceiver(
  thisVal: Abs,
  method: string,
  args: Abs[],
  loc?: [number, number],
): Abs {
  const s = thisVal.shape;
  // 调用方已按 k === "sum" 分流；此处重述守卫仅为类型收窄（行为不变）。
  if (s.k !== "sum") return unknown;
  const results: Abs[] = [];
  for (const m of s.members) {
    if (memberLikelyHasMethod(m, method)) {
      results.push($invoke(m, method, args, loc));
      continue;
    }
    // 该成员确定没有此方法 ⇒ 原生该分支抛 TypeError（记 throws 域）
    // notePrimMemberMissing 只认 prim 接收者 ⇒ fn 臂由 noteFnStaticMemberMissing 接手
    if (!notePrimMemberMissing(m, method, "method", loc)) {
      noteFnStaticMemberMissing(m, method, loc);
    }
  }
  if (results.length === 0) return unknown;
  return results.reduce((a, b) => joinAbs(a, b));
}

/** 数组 / 元组接收者方法面（invokeArrMethod 为单一事实源） */
function invokeArrayReceiver(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
  const k = thisVal.shape.k;
  if (k !== "arr" && k !== "tuple") return undefined;
  return invokeArrMethod(thisVal, method, args);
}

/**
 * Bug 36：TypedArray 原型回调族（forEach/map/filter/reduce/reduceRight/
 * every/some/find/findIndex/findLast/findLastIndex）。TA 实例是 $new 兜底
 * 的空 brand（长度/条目不建模），evalBuiltinInstanceMethod 与
 * BUILTIN_BRAND_METHODS 此前皆无 TA 条目——HOF 调用落 $get → undef →
 * unknown：回调静默不跑（副作用计数器折 wrong-exact 0）、GetCallback
 * 校验缺失（非函数回调不抛、L2 假阴）。按抽象数组视图复用数组 HOF
 * 机器（invokeArrMethod，单一事实源）：元素域 = TYPED_ARRAY_ELEMENT 的
 * prim（BigInt64/BigUint64 → bigint），各分支内置 validateCallableArg
 *（零迭代也定抛）+ 代表元素回调执行（副作用/抛错传播）+ 返回面对齐
 * 数组口径。回调收到的第 3 实参（数组本尊）是本视图而非 TA brand——
 * instanceof 面的诚实不精确（长度未建模同源）。map 原生结果 = 同族
 * TA，元素经 ToNumber/ToBigInt 收敛回元素 prim（回调返回 string 不渗入
 * 元素域）；回调返回 symbol/number↔bigint 交 ConvertThrow 面未建模
 *（同长度口径，接受）。
 *
 * undefined = 非 TA / 非回调族方法 ⇒ 落内建 brand 方法面。
 */
function invokeTypedArrayCallback(
  thisVal: Abs,
  brandName: string,
  method: string,
  args: Abs[],
): Abs | undefined {
  const taElem = typedArrayElementOf(brandName);
  if (!taElem || !TYPED_ARRAY_CALLBACK_METHODS.has(method)) return undefined;
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
  if (taR === undefined) return undefined;
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

/**
 * 内建 brand 实例方法面：直查 builtin 表 → 含内建父的类链 owner →
 * Map/Set forEach（条目表回调）。undefined = 未命中（落类值 / 实例方法面）。
 */
function invokeBuiltinBrandMethod(
  thisVal: Abs,
  brandName: string,
  method: string,
  args: Abs[],
): Abs | undefined {
  // 内建 brand 实例方法（Date/RegExp/Map/Set/Error 家族）：统一经 builtin 表分派。
  // 此前只对 Map/Set 调 evalBuiltinInstanceMethod，Date.getTime 等落到
  // findMethod 未命中 → 折 lit(undefined)，Number.isNaN(getTime()) 假 false。
  const viaBuiltin = evalBuiltinInstanceMethod(brandName, method, thisVal, args);
  if (viaBuiltin !== undefined) return viaBuiltin;
  // 含内建父的类链（class MyMap extends Map {}）：实例 brand 名是**派生类名**
  // ⇒ 上面的直查落空 ⇒ `.get` / `.size` / `.has` 折 unknown（族 02 遗留
  // 「含内建父的类链保守不判」——假阴性）。沿类链找首个**内建 owner**（内建
  // 方法表按内建名建键——与读面 builtinOwnerOf 同口径）按该 owner 派发。
  // 用户面优先：链上有同名**用户方法**时归用户面（原生派生类覆盖内建成员）。
  const chainBuiltinOwner = builtinChainOwner(brandName, method);
  if (chainBuiltinOwner !== undefined) {
    const viaChainBuiltin = evalBuiltinInstanceMethod(chainBuiltinOwner, method, thisVal, args);
    if (viaChainBuiltin !== undefined) return viaChainBuiltin;
  }
  // C1：Map/Set forEach（条目表回调）
  if ((brandName === "Map" || brandName === "Set") && method === "forEach") {
    // Bug 31：GetCallback 前置校验（空接收者零迭代也要抛）——Bug 55
    // 数组 HOF 同口径；此前回调可调用性只在 invokeCb 内经 $call 逐条目
    // 触发，空 Map/Set 与对象回调形态静默不抛（L2 假阴）。
    validateCallableArg(args[0], `${brandName}.prototype.forEach callback may not be callable`);
    const r = $collectionForEach(thisVal, args[0]);
    if (r !== undefined) return r;
  }
  return undefined;
}

/**
 * Bug 1035：**类值接收者**（`A.m()`）的静态面派发（调用方已确认接收者是
 * 该类值）。undefined = 静态**访问器**在场 ⇒ 交回通用派发面（成员读 +
 * 调用；通用面复用预读值 preRead，不重复触发 getter）。
 */
function dispatchClassValueStatic(
  thisVal: Abs,
  brandName: string,
  method: string,
  args: Abs[],
  loc?: [number, number],
): Abs | undefined {
  // 类值**自有槽**（静态字段 / 动态写 `A.f = fn`）——原生静态成员挂
  // 构造器**自身**（own）⇒ own 优先于原型链（静态字段遮住继承来的
  // 静态方法）。值可调用 ⇒ 按原生调用（this = 类值）；不可调用 ⇒
  // 原生 `A.f is not a function` 定抛。
  const ownSlot = classValueOwnSlot(thisVal, method);
  if (ownSlot !== undefined) {
    if (!isCallableValue(ownSlot)) throw new NudoThrow(errorTypeAbs("TypeError"));
    return $call(ownSlot, args, thisVal);
  }
  // Bug 18：静态方法沿 superName 继承链查找（空派生类 B.m() 不断链）。
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
  // 静态**访问器**（static get m(){}）——成员存在（原生 `A.m` 走 getter
  // 读到值再调用）⇒ 不得判缺席 ⇒ 交回通用派发面（成员读 + 调用：
  // 通用面用预读值 preRead，不重复触发 getter ⇒ 访问器先于实参的
  // 求值序保持）。
  if (findStaticClassAccessor(brandName, method) !== undefined) {
    // 存在 → 落通用派发面（**不**走实例方法表）
    return undefined;
  }
  if (!CLASS_VALUE_INHERITED_NAMES.has(method)) {
    // 类值上无此成员 ⇒ 原生 `A.m is not a function` ⇒ 定抛 TypeError
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  return undefined;
}

/**
 * Bug 244 / P4a：**实例接收者**的方法面——原型/实例上的方法写（monkey-patch）
 * 优先于注册表方法体；注册表命中按调用点记录；缺席时按 static-only 证明
 * 定抛。undefined = 本面未接管（落通用槽位 / 诊断面）。
 */
function dispatchInstanceMethod(
  thisVal: Abs,
  brandName: string,
  method: string,
  args: Abs[],
  loc?: [number, number],
): Abs | undefined {
  // Bug 244：实例 / 原型上的**方法写**（monkey-patch）优先于注册表
  // 方法体——原生查找序 own → prototype。写侧（$set / $thisSet /
  // Object.defineProperty）把值落进 brand 内层 obj 槽面（实例 = 实例
  // brand 的内层 obj；原型对象 = protoBrandAbs(name) 的内层 obj），
  // 读面（chainProtoSlotOf）看得见，但**派发面此前只查注册表** ⇒
  // `A.prototype.m = fn` / `a.m = fn` / `this.m = fn` 全部失效
  // （跑的还是注册表里的旧方法体 ⇒ monkey-patch 静默无效）。写成
  // 非函数 ⇒ 原生定抛 TypeError（`a.m is not a function`）。
  // 域限**注册用户类**（内建 brand 的原型写语义归 Bug 208 的
  // builtinProtoOwnWrite；内建实例自有写的缺口不在本片）。
  if (getEvalClass(brandName) !== undefined) {
    const written = userClassWrittenMember(thisVal, brandName, method);
    if (written !== undefined) {
      if (!isCallableValue(written)) throw new NudoThrow(errorTypeAbs("TypeError"));
      return $call(written, args, thisVal);
    }
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
  return undefined;
}

/**
 * brand 接收者派发面（顺序即原生查找序）：
 * 装箱 prim → TypedArray 回调族 → 内建 brand 方法（含内建父链 / Map·Set
 * forEach）→ **类值静态面优先于实例方法面** → 用户类实例方法面。
 * undefined = 本面未接管（落通用槽位面 / 缺失诊断）。
 */
function invokeBrandReceiver(
  thisVal: Abs,
  method: string,
  args: Abs[],
  loc?: [number, number],
): Abs | undefined {
  const s = thisVal.shape;
  if (s.k !== "brand" || !s.name) return undefined;
  const brandName = s.name;
  // Bug 22：装箱 brand（new String/Number/Boolean / Object(prim)）实例方法
  // → 拆箱 [[PrimitiveValue]] 后走 prim 方法面（charAt/toFixed/… 的字面量
  // 折叠与抽象臂全复用；valueOf/toString 原生语义即包装原始值的同名方法）
  const boxedPrim = boxedPrimitiveValue(thisVal);
  if (boxedPrim) {
    return $invokeInner(boxedPrim, method, args, loc);
  }
  const taR = invokeTypedArrayCallback(thisVal, brandName, method, args);
  if (taR !== undefined) return taR;
  const builtinR = invokeBuiltinBrandMethod(thisVal, brandName, method, args);
  if (builtinR !== undefined) return builtinR;
  // Bug 1035：**类值接收者**（`A.m()`）的派发**先查静态面**。
  //
  // 原生：类值是构造器函数，`A.m` 沿构造器 [[Prototype]] 链解析（= 静态
  // 方法面）；**实例方法面不在其链上**（实例方法挂 A.prototype）。此前
  // 先查实例方法表 ⇒ 同名 static + 实例方法并存时跑错方法体
  // （`A.m()` 跑实例体）⇒ 抛错方向**双向反转**：该抛不抛（类值上无该
  // 静态成员时原生 `A.m is not a function` 定抛，引擎却跑实例体不抛）
  // / 不该抛却抛。
  if (classNameOfValue(thisVal as object) === brandName) {
    return dispatchClassValueStatic(thisVal, brandName, method, args, loc);
  }
  return dispatchInstanceMethod(thisVal, brandName, method, args, loc);
}

/**
 * bigint 字面量：toString(radix)/valueOf 精确折叠——字面量实参真执行，
 * 非法 radix 原生 RangeError / 符号实参 TypeError 硬抛（catch 可吸收）。
 * undefined = 未接管的其它方法（继续后续诊断路径）。
 */
function invokeBigintPrim(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
  const s = thisVal.shape;
  if (s.k !== "prim" || s.type !== "bigint") return undefined;
  const bvR = litValue(thisVal);
  const bv = bvR.ok ? (bvR.value as bigint | undefined) : undefined;
  if (typeof bv === "bigint") {
    if (method === "valueOf") return thisVal;
    // toLocaleString：BigInt 原型真方法（M3 白名单成员）——宿主 ICU 真执行
    //（千分位随 locale 精确；此前落通用路径折 "[object BigInt]" 假精确）；
    // 实参参与（Bug 251）：locales 走宿主 CanonicalizeLocaleList 校验——
    // null → TypeError、非法 language tag → RangeError；number/bool/
    // bigint/symbol 实参原生被忽略（默认 locale）——与 Number 臂同口径
    if (method === "toLocaleString") {
      const argAbs = args[0];
      // symbol 实参宿主忽略（ToObject 路径，不抛）⇒ 不记 may
      if (argAbs !== undefined && argAbs.term?.op !== "lit" && !isSymbolAbs(argAbs)) {
        // Bug 251：locales 不可判 —— 可能是非法 language tag → may RangeError
        recordMayThrow({
          kind: "RangeError",
          cause: "BigInt.prototype.toLocaleString locales may be an invalid language tag",
        });
        return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      }
      const avR = argAbs === undefined ? undefined : litValue(argAbs);
      const av = avR?.ok ? avR.value : undefined;
      try {
        const impl = BigInt.prototype as unknown as Record<string, (...a: unknown[]) => string>;
        const hostArgs: unknown[] = argAbs !== undefined ? [av] : [];
        return strLit(Reflect.apply(impl.toLocaleString, bv, hostArgs) as string);
      } catch (e) {
        if (e instanceof TypeError) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
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
  return undefined;
}

/**
 * number 字面量：toString(radix)/toFixed/toExponential/toPrecision/valueOf
 * 精确折叠——字面量实参真执行（ToIntegerOrInfinity 截断、NaN→缺省等由原生
 * 处理），非法参数硬抛 RangeError、符号实参硬抛 TypeError；抽象实参保守。
 * 未接管的其它方法不得在此 return——继续后续诊断路径（no-method）。
 */
function invokeNumberPrim(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
  const s = thisVal.shape;
  if (s.k !== "prim" || s.type !== "number") return undefined;
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
    if (argAbs !== undefined && argAbs.term?.op !== "lit" && !isSymbolAbs(argAbs)) {
      // Bug 251：locales 实参不可判 —— 可能是非法 language tag
      // （`(1.5).toLocaleString(tag)` 原生 RangeError）⇒ may RangeError
      // （symbol 实参宿主忽略 ⇒ 不记 may）
      if (method === "toLocaleString") {
        recordMayThrow({
          kind: "RangeError",
          cause: "Number.prototype.toLocaleString locales may be an invalid language tag",
        });
      }
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
    const avR = argAbs === undefined ? undefined : litValue(argAbs);
    const av = avR?.ok ? avR.value : undefined;
    try {
      const impl = Number.prototype as unknown as Record<string, (...a: unknown[]) => string>;
      if (method === "toLocaleString") {
        // Bug 251：走**宿主 toLocaleString**（ICU）——此前重定向宿主 toString
        // ⇒ 值错（丢千分位 / -0 / 指数形态：1234567.5 → "1234567.5"，
        // 原生 "1,234,567.5"）。locales 实参透传 ⇒ 宿主
        // CanonicalizeLocaleList 校验（null → TypeError、非法 tag →
        // RangeError；number/bool/bigint/symbol 原生被忽略 ⇒ 默认 locale）。
        const localeArgs: unknown[] = argAbs !== undefined ? [av] : [];
        return strLit(Reflect.apply(impl.toLocaleString!, nv, localeArgs) as string);
      }
      const radixArgs: unknown[] = av === undefined ? [] : [av];
      return strLit(Reflect.apply(impl.toString!, nv, radixArgs) as string);
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
  return undefined;
}

/** boolean 字面量：toString/valueOf；undefined = 未接管 */
function invokeBooleanPrim(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
  const s = thisVal.shape;
  if (s.k !== "prim" || s.type !== "boolean") return undefined;
  if (method === "valueOf") return thisVal;
  if (method === "toString" || method === "toLocaleString") {
    const bvR = litValue(thisVal);
    const bv = bvR.ok ? bvR.value : undefined;
    if (typeof bv === "boolean") return strLit(String(bv));
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  return undefined;
}

/**
 * prim 接收者方法面（bigint → number → boolean，遵循原实现的判定顺序）。
 * undefined = 本面未接管 ⇒ 继续 Symbol / 字符串表 / 通用槽位 / 诊断面。
 */
function invokePrimitive(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
  const bigintR = invokeBigintPrim(thisVal, method, args);
  if (bigintR !== undefined) return bigintR;
  const numberR = invokeNumberPrim(thisVal, method, args);
  if (numberR !== undefined) return numberR;
  return invokeBooleanPrim(thisVal, method, args);
}

/**
 * 属性上的可调用值（require namespace / 对象方法）派发面。
 * undefined = 属性缺失 / 非函数 impl / protoMethod kind（方法值读通道）⇒
 * 交给缺失方法诊断面。
 *
 * 调用方已按 Bug 152 传入调用点预读值 prop（getter 只触发一次）。
 */
function invokePropertyValue(
  thisVal: Abs,
  method: string,
  args: Abs[],
  prop: Abs,
  loc?: [number, number],
): Abs | undefined {
  const impl = prop && typeof prop === "object" && "shape" in (prop as object)
    ? getFnImpl(prop as Abs)
    : undefined;
  if (!impl || impl.kind === "protoMethod") return undefined;
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
  return undefined;
}

/**
 * 缺失方法终判 / may-throw / 成员诊断面（调用方已确认属性值不可调用）。
 *
 * 顺序与原实现一致：结构不可调用 → 注册用户类静态证明（callSite）→ 已知
 * 形状封闭面（knownSurface）→ bigint 封闭原型面 → 软诊断（prim / nullish /
 * any / unknown）。硬抛与软抛口径逐条保持。
 */
function invokeUnresolvedMember(
  thisVal: Abs,
  method: string,
  prop: Abs,
  loc?: [number, number],
): Abs {
  // 结构上确定不可调用（null-proto 缺失名 / 闭 exact 对象非 OP 名缺失 /
  // 字面量非函数槽）→ 原生 TypeError hard throw（catch 可吸收）
  if (definitelyUncallableMember(thisVal, method)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // Bug 194 S19（调用面）：读不到**可调用**目标 → 原生 TypeError
  // （`a.m is not a function`）。两种情形原生同抛：
  //  - 方法确实不存在：`delete X.prototype.m` 之后（读面 / in 面已正确，
  //    调用面此前折 unknown ⇒ L2 门禁假绿），或从未定义的方法
  //    （`a.neverDefined()`）；
  //  - 方法在但值不是函数（`a.m = undefined`）。
  // 读面**不抛**（读 `a.m` 得 undefined 不抛）——本块只作用于调用面。
  if (callSiteHasNoCallableTarget(thisVal, method, prop)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // Bug 265：**非 prim / 非 obj** 接收者（数组元组 / 内建 brand）上调用
  // 确实不存在的方法 ⇒ 原生恒抛 TypeError。缺失方法终判链此前只覆盖
  // prim / obj / 注册用户类实例（callSiteHasNoCallableTarget）⇒ 这两类
  // 接收者一律折 unknown 且**不记 may-throw** ⇒ L2 门禁假绿。
  // 与 P4a 分支**同口径**（都记 hard throw，catch 可吸收）。
  if (knownSurfaceMemberAbsent(thisVal, method, loc)) {
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

/**
 * Bug 265：已知形状接收者上的「确定不存在」方法 → 原生 TypeError。
 *
 * 「缺失方法终判」链此前只覆盖 prim（notePrimMemberMissing，soft）/ obj
 * （definitelyUncallableMember）/ 注册用户类实例（callSiteHasNoCallableTarget）
 * ——**非 prim / 非 obj** 的两类已知形状接收者此前一律折 unknown 且不记
 * may-throw（原生恒抛 TypeError）⇒ L2 门禁假绿。
 *
 * 缺席可证的形状（**封闭**的原型可调用面——表外名即原生不存在）：
 * - tuple / arr：Array.prototype 的可调用自有名是封闭的 38 个（node v26
 *   `Object.getOwnPropertyNames(Array.prototype)` 实测，与
 *   ARRAY_PROTO_METHOD_NAMES 逐名相等）⇒ 表外名确定不存在；
 * - 内建 brand：BUILTIN_BRAND_METHODS 是该 brand 原型可调用面的全列
 *   （node v26 对拍：各 brand 原型可调用名 ⊆ 表内，差集仅 "constructor"
 *   ——已由 OBJECT_PROTO_NAMES 覆盖）⇒ 表外名确定不存在。
 *
 * 保守边界（命中即不抛，缺席不可证）：
 * - 注册用户类实例：域不同（callSiteHasNoCallableTarget 判，且要求继承链
 *   每环都是注册用户类）——不在此重复判定；
 * - 表外内建 brand（原型面不完备）/ 继承链有洞（classChainHasHole）；
 * - 接收者自有面在场（instanceOwnFaceHasMember：ctor `this.m = fn` 写入
 *   的承载者 / 实例字段——字段值可能是函数）；
 * - Object.prototype 上的用户 monkey-patch（引擎已建模的自有写）。
 */
function knownSurfaceMemberAbsent(
  recv: Abs,
  method: string,
  loc?: [number, number],
): boolean {
  const s = recv.shape;
  if (s.k === "tuple" || s.k === "arr") {
    if (OBJECT_PROTO_NAMES.has(method)) return false;
    if (ARRAY_PROTO_METHOD_NAMES.has(method)) return false;
    if (builtinProtoOwnSlot("Object", method) !== undefined) return false;
    recordMemberDiag({
      kind: "method",
      name: method,
      receiver: "array",
      line: loc?.[0],
      column: loc?.[1],
    });
    return true;
  }
  if (s.k === "brand") {
    const brandName = s.name;
    // 注册用户类：域不同（callSiteHasNoCallableTarget）——不在此重复判定
    if (getEvalClass(brandName) !== undefined) return false;
    // 表外内建 brand：原型面不完备 → 缺席不可证
    if (BUILTIN_BRAND_METHODS[brandName] === undefined) return false;
    if (classChainHasHole(brandName)) return false;
    if (brandHasProtoMember(brandName, method)) return false;
    if (OBJECT_PROTO_NAMES.has(method)) return false;
    if (instanceOwnFaceHasMember(recv, brandName, method)) return false;
    if (builtinProtoOwnSlot("Object", method) !== undefined) return false;
    recordMemberDiag({
      kind: "method",
      name: method,
      receiver: brandName,
      line: loc?.[0],
      column: loc?.[1],
    });
    return true;
  }
  return false;
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

/**
 * Bug 263：union 成员是否持有该方法（**按方法名**判定，不再只认 string）。
 *
 * 原判据 `memberLikelyHasMethod` 的 `method` 形参**根本没被使用**：判据实际
 * 是「这个形态大概有方法」而不是「这个形态有【这个】方法」⇒
 * - number / boolean / bigint / symbol 成员上的方法（toFixed / toPrecision /
 *   toExponential / toString(radix) / toLocaleString…）在 union 上一律被判
 *   「missing」⇒ 成员被**提前排除**⇒ 值域塌成 unknown（且 L2 门禁把「成员
 *   不支持该方法」误报成「成员缺方法」——误导诊断点名的是 string 侧）；
 * - string 成员被**无条件放行**⇒ string 上根本不存在的方法（如 toFixed）
 *   也被判「有」⇒ 派发到 string 成员 ⇒ 报「missing on string receiver」。
 *
 * 新判据：prim 成员按**该类型原型的真实方法表**（member-diag.ts 的
 * STRING_METHODS / NUMBER_PROTO_METHODS / …）判定；表外名 ⇒ 该成员**确定**
 * 没有此方法 ⇒ 原生调用 undefined ⇒ 该分支定抛 TypeError（调用方据此同时
 * 记 may-throw 并跳过该成员——该分支不贡献值）。判据不足（表未覆盖的形态 /
 * 非 prim 形态）⇒ **保守放行**（让 $invoke 自己判），不提前排除。
 */
/**
 * Bug 263：prim 原型的**真实**方法表（按 prim 类型）——union 成员判定用。
 * 表源与 notePrimMemberMissing 同源（member-diag.ts）⇒ 读面「确定缺失」
 * 判定与 union 派发判定**同口径**（不出现两套方法名清单）。
 */
const PRIM_PROTO_METHODS: Record<string, ReadonlySet<string>> = {
  string: STRING_METHODS,
  number: NUMBER_PROTO_METHODS,
  boolean: BOOLEAN_PROTO_METHODS,
  symbol: SYMBOL_PROTO_METHODS,
  bigint: BIGINT_PROTO_METHODS,
};

/**
 * Bug 244：注册用户类实例上的**成员写**（自有槽 → 原型链数据槽）。
 *
 * 原生属性查找序 own → prototype ⇒ 写在实例 / 原型上的成员**遮住**类
 * 注册表里的方法体（注册表 = 引擎对原型对象方法面的模型；用户写上去的
 * 是原型对象 / 实例上的**自有属性**，优先级更高）。
 *
 * - 自有槽：实例 brand 的内层 obj 槽（`a.m = fn` / ctor `this.m = fn`）；
 * - 原型链数据槽：`A.prototype.m = fn` 落 protoBrandAbs("A") 的内层 obj，
 *   祖先类原型上的写同样生效（原生沿 [[Prototype]] 链上溯）。
 *
 * 缺席返回 undefined（走注册表方法体）。
 */
function userClassWrittenMember(
  recv: Abs,
  brandName: string,
  method: string,
): Abs | undefined {
  const s = recv.shape;
  if (s.k === "brand") {
    const inner = s.shape;
    if (inner?.shape.k === "obj") {
      const own = getSlot(inner.shape.slots, method);
      if (own && !own.optional) return own.value;
    }
  }
  const proto = chainProtoSlotOf(brandName, method, 0);
  if (proto !== undefined) return proto;
  return undefined;
}

/**
 * Bug 1035：类值（构造器）**自有槽**上的成员——静态字段 / 动态写
 * `A.f = fn`（原生静态成员挂构造器自身 = own ⇒ own 优先于原型链）。
 * 缺席返回 undefined。
 */
function classValueOwnSlot(recv: Abs, method: string): Abs | undefined {
  const s = recv.shape;
  if (s.k !== "brand") return undefined;
  const inner = s.shape;
  if (inner?.shape.k !== "obj") return undefined;
  const slot = getSlot(inner.shape.slots, method);
  if (slot && !slot.optional) return slot.value;
  return undefined;
}

/**
 * Bug 1035：类值沿 [[Prototype]] 链恒可得的成员（Function.prototype +
 * Object.prototype）——`A.call` / `A.apply` / `A.bind` / `A.toString` /
 * `A.hasOwnProperty` / `A.valueOf` …。这些名**不得**判「缺席」（原生沿
 * 构造器链可得）⇒ 不定抛 TypeError。
 */
const CLASS_VALUE_INHERITED_NAMES: ReadonlySet<string> = new Set([
  ...OBJECT_PROTO_NAMES,
  "call",
  "apply",
  "bind",
  "@@hasInstance",
]);

/**
 * Bug 1045 后续（S16）：fn 形状的**静态面**判据（dual-facet 事实源）。
 *
 * 构造器 / 静态成员挂在 fn 的 `shape.slots` 上（`Response.json` /
 * `Array.isArray` / `Number.isFinite` …）——fn 的**实例面**在 prototype 上，
 * 与静态面**不同槽**（故本判据只看静态面，不掺实例面）。
 *
 * 三态返回（判据强度必须分清，判不准 ≠ 确定没有）：
 * - `true`：静态槽里有该名 ⇒ 可派发；
 * - `false`：静态槽**明确不含**该名 ⇒ 确定没有（原生读 undefined ⇒ 调用 TypeError）；
 * - `undefined`：**没有静态槽信息** ⇒ 判据不足 ⇒ 保守放行（不可判不可抛）。
 *
 * 「没有 slots」与「slots 为空对象」的区别（本判据采用的口径）：
 * - `shape.slots === undefined` ⇒ 该 fn **没有静态面模型**（判据不足）⇒ 放行；
 *   （env 声明里没挂 slots 的构造器、宿主桥接 fn 都落这里）
 * - `shape.slots` 存在但**为空对象** ⇒ 静态面模型为**空**（该 fn 确定没有任何
 *   静态成员）⇒ 表外名**确定缺席** ⇒ 不放行。
 *
 * optional 槽（读面可能缺席 ⇒ `joinAbs(value, undefined)`）⇒ 判据不足 ⇒ 放行。
 */
function fnStaticFaceHas(m: Abs, method: string): boolean | undefined {
  const sh = m.shape;
  if (sh.k !== "fn") return undefined;
  const slots = sh.slots;
  if (slots === undefined) return undefined; // 无静态面模型 → 判据不足
  const slot = getSlot(slots, method);
  if (slot === undefined) return false; // 静态面模型在场且不含该名 → 确定没有
  if (slot.optional) return undefined; // 槽可能缺席 → 判据不足
  return true;
}

/**
 * Bug 1045 后续（S16）：sum 成员是 **fn** 且静态面**确定不含**该名 ⇒ 原生该
 * 分支读 undefined ⇒ 调用定抛 TypeError ⇒ 记 may-throw（soft，catch 可吸收）
 * + 成员诊断（与 prim 臂 notePrimMemberMissing 同口径；后者只认 prim 接收者，
 * fn 臂此前**不记** ⇒ sum 里 fn 成员的原生抛被吞掉）。
 *
 * 判据不足（fn 无静态面模型 / 槽 optional）⇒ **不记**（宁可宽，不可凭空造
 * may-throw ⇒ 假红）。
 */
function noteFnStaticMemberMissing(
  m: Abs,
  method: string,
  loc?: [number, number],
): boolean {
  const sh = m.shape;
  if (sh.k !== "fn") return false;
  if (fnStaticFaceHas(m, method) !== false) return false; // 有该名 / 判据不足 → 不记
  // Function.prototype / Object.prototype 名沿函数对象恒可得 ⇒ 不得判缺席
  if (CLASS_VALUE_INHERITED_NAMES.has(method)) return false;
  const recv = sh.name ?? "fn";
  recordMemberDiag({
    kind: "method",
    name: method,
    receiver: recv,
    line: loc?.[0],
    column: loc?.[1],
  });
  recordMayThrow({
    kind: "TypeError",
    cause: `method '${method}' missing on ${recv} receiver (calling undefined)`,
    recv,
    name: method,
    line: loc?.[0],
    column: loc?.[1],
  });
  return true;
}

function memberLikelyHasMethod(m: Abs, method: string): boolean {
  const k = m.shape.k;
  if (k === "prim") {
    // Object.prototype 名经装箱恒有（(1).toString / "a".hasOwnProperty）
    if (OBJECT_PROTO_NAMES.has(method)) return true;
    const table = PRIM_PROTO_METHODS[(m.shape as { type?: string }).type ?? ""];
    if (!table) return true; // 判据不足 → 保守放行
    return table.has(method);
  }
  if (k === "fn") {
    // Bug 1045 后续（S16）：fn = 构造器 / dual-facet 全局（Response / Array…）
    // —— 静态成员挂 fn 的 slots 上。旧判据无 fn 分支 ⇒ 落尾部 `return false`
    // ⇒ 「确定没有此方法」⇒ 被跳过 ⇒ 合并 fn 全局的静态成员调用
    // （`Response.json(x)`）折 unknown（精度回退，族 36 引入）。
    //
    // Function.prototype / Object.prototype 名沿函数对象恒可得
    // （`Response.toString()` / `Response.call()` 原生不抛）⇒ 不得判缺席。
    if (CLASS_VALUE_INHERITED_NAMES.has(method)) return true;
    const has = fnStaticFaceHas(m, method);
    if (has === undefined) return true; // 判据不足 → 保守放行
    return has;
  }
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
//
// Bug 256（ES2023 §22.1.3）：`String.prototype` 上**只有** `toString` /
// `valueOf` 要品牌检查（thisStringValue），其余 30 个方法都是 **generic**
// （RequireObjectCoercible + ToString）⇒ 整条把 "String" 列进本表会让借用
// 调用定抛 TypeError（原生 `String.prototype.toUpperCase.call(1)` → "1"）。
// ⇒ 表分两层：BRAND_CHECK_PROTOS（整个原型都要品牌）+ BRAND_CHECK_METHODS
// （只有列出的方法要品牌；未列方法按 generic 走）。
//
// Bug 261：`Error.prototype.toString` 是**普通方法**（无品牌检查——只读
// this.name / this.message）⇒ Error 家族**不进**品牌检查面。
const BRAND_CHECK_PROTOS = new Set([
  "Number", "Boolean", "Symbol", "BigInt",
  "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet",
]);
/** 方法级品牌检查（proto 名 → 要品牌的方法名集合；未列方法 = generic） */
const BRAND_CHECK_METHODS: Record<string, ReadonlySet<string>> = {
  String: new Set(["toString", "valueOf"]),
};
/** prim 型 home（member.ts :832 的 protoMethodValueAbs(type, key)）→ brand 名 */
const PRIM_HOME_BRAND: Record<string, string> = {
  number: "Number",
  string: "String",
  boolean: "Boolean",
  bigint: "BigInt",
  symbol: "Symbol",
};
/**
 * (home, method) 是否走品牌检查；是则返回**期望的接收者 brand 名**。
 *
 * 表驱动（Bug 256 / 261）：原型级表 → 方法级表 → prim home 映射。
 * 表外的 home（Object / Array / Error 家族 / 用户类）一律**不**品牌检查。
 */
function brandCheckBrandOf(home: string, name: string): string | undefined {
  if (BRAND_CHECK_PROTOS.has(home)) return home;
  if (BRAND_CHECK_METHODS[home]?.has(name)) return home;
  const mapped = PRIM_HOME_BRAND[home];
  if (mapped === undefined) return undefined;
  if (BRAND_CHECK_PROTOS.has(mapped)) return mapped;
  if (BRAND_CHECK_METHODS[mapped]?.has(name)) return mapped;
  return undefined;
}
/** Array.prototype 写方法（**字符串**接收者上原生定抛；读方法走物化泛型） */
const ARRAY_MUTATOR_METHODS = new Set([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin",
]);
/**
 * Array.prototype 的「就地操作并返回 this」方法（Bug 267）——与「返回新数组」
 * 的方法（slice / map / filter / concat / with / toSorted…）分族。
 */
const ARRAY_INPLACE_METHODS = new Set(["sort", "reverse", "fill", "copyWithin"]);
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

/**
 * Bug 256：generic String 方法的接收者 **ToString** 投影（ES2023 §22.1.3：
 * RequireObjectCoercible(this) + ToString(this)）。
 *
 * - string prim → 自身；
 * - number / boolean / bigint **字面量** → 精确字符串（`toUpperCase.call(1)`
 *   原生 "1"）；
 * - symbol prim → ToString 恒抛 TypeError（原生同）；
 * - 其它（对象 / 抽象 prim）→ ToPrimitive 结果不可判 ⇒ 抽象 string prim。
 */
function genericStringRecv(recv: Abs): Abs {
  const s = recv.shape;
  if (s.k === "prim") {
    const t = (s as { type?: string }).type;
    if (t === "string") return recv;
    if (t === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    const lv = litValue(recv);
    if (lv.ok && lv.value !== null && lv.value !== undefined) {
      const v = lv.value;
      if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
        return strLit(String(v));
      }
    }
  }
  return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
}

/**
 * Bug 261：`Error.prototype.toString` 的 **generic** 语义（ES2023 §20.5.2.2）——
 * 无品牌检查：只读 this.name / this.message（缺省 "Error" / ""）⇒ 可借用给
 * 任意**对象**接收者（原生 `Error.prototype.toString.call({name:"X",message:"y"})`
 * → "X: y"）。
 *
 * 原始值接收者原生定抛 TypeError（V8 / node：`Error.prototype.toString called on
 * incompatible receiver`——该方法要求 this 是对象）。
 *
 * @param part 单个属性的取值投影：string = 精确值；null = 缺席 / undefined
 *   （走缺省）；undefined = 不可判（抽象值）。
 */
function errorToStringPart(part: Abs | undefined): string | null | undefined {
  if (part === undefined) return null;
  const lv = litValue(part);
  if (!lv.ok) return undefined;
  const v = lv.value;
  if (v === undefined) return null;
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return undefined;
}

/** Bug 261：generic Error.prototype.toString 的实现（只读 name / message 两槽）。 */
function genericErrorToString(recv: Abs): Abs {
  if (recv.shape.k === "prim" || isNullishLitAbs(recv)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const namePart = errorToStringPart($get(recv, "name", { silent: true }));
  const msgPart = errorToStringPart($get(recv, "message", { silent: true }));
  if (namePart === undefined || msgPart === undefined) {
    // 抽象取值 → 不可判 ⇒ 抽象 string（不折假值）
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  const name = namePart === null ? "Error" : namePart;
  const msg = msgPart === null ? "" : msgPart;
  // ES2021+ / V8：名空 → 只回消息；消息空 → 只回名；否则 "name: msg"
  if (name === "") return strLit(msg);
  if (msg === "") return strLit(name);
  return strLit(`${name}: ${msg}`);
}

/** Error 家族实例（brand）——沿既有 brand 面（"Error: m"），不走 generic 路。 */
function isErrorBrandRecv(recv: Abs): boolean {
  return recv.shape.k === "brand" && isErrorCtorName(recv.shape.name);
}

/**
 * 接收者是否**数组 exotic**（IsArray(O) 为真）——Bug 262：`concat` 只在
 * IsArray(O) 为真时才展开 this；`Array.prototype` 本身是数组 exotic
 * （其 length 为 0）⇒ 走数组派发而非「整体作为元素」。
 */
function isArrayExoticRecv(recv: Abs): boolean {
  return recv.shape.k === "brand" && recv.shape.name === "Array.prototype";
}

// ---------------------------------------------------------------------------
// Bug 193/196：用户类方法值的**摘下 / 借用**调用——按「方法体 + this = 接收者」
// ---------------------------------------------------------------------------
/**
 * Bug 193/196：用户类方法体定位——**按方法体**（注册表的实例 / 静态方法记录），
 * **不按接收者的成员表反查被调用者**。
 *
 * 原生：方法值是**函数**，`m()` / `m.call(recv)` 跑的就是那个函数体，
 * `this` = 调用位给的接收者（摘下调用时 `this` 恒 undefined）。此前派发按
 * `$invoke(recv, name, args)`——即**在接收者的成员表里反查同名方法**⇒
 * 接收者不是本类实例时（外来对象 / undefined）一律「取不到方法」⇒ 假抛
 * TypeError（FALSE-THROW）：`const m = new A().m; m()` 原生恒不抛。
 *
 * 静态 / 实例同名并存时按接收者形态定夺（类值 → 静态体；实例 → 实例体）；
 * 两者并存且接收者形态不可判（外来对象 / undefined）⇒ 不可判（返回
 * undefined，交回通用派发面保守处理，不猜）。
 */
function userClassMethodBody(
  home: string,
  name: string,
  recv: Abs,
  origin?: ClassMethodOrigin,
): ((thisVal: Abs, ...args: Abs[]) => Abs) | undefined {
  if (!getEvalClass(home)) return undefined;
  const instBody = findMethod(home, name);
  const statBody = findStaticMethod(home, name);
  if (!instBody && !statBody) return undefined;
  if (instBody && statBody) {
    // Bug 1041：同名 static + 实例方法并存时，**方法值的来源侧**是决定
    // 依据（原生：`A.m` 取到的是构造器上的**静态**方法、`a.m` 取到的是
    // 原型上的**实例**方法——两个不同函数对象）。来源侧随方法值传到派发
    // 面（member.ts 的 classMethodValueAbs → protoMethodDispatch 的
    // origin 参数）⇒ 摘下调用（接收者恒 undefined）不再「不可判」
    // ⇒ 此前一律折「取不到方法」⇒ 假抛 TypeError（FALSE-THROW）。
    if (origin === "static") return statBody;
    if (origin === "inst") return instBody;
    const clsName = classNameOfValue(recv as object);
    if (clsName !== undefined) return statBody; // 类值接收者 → 静态体
    if (recv.shape.k === "brand") return instBody; // 实例接收者 → 实例体
    return undefined; // 形态不可判（外来对象 / undefined 接收者）
  }
  return instBody ?? statBody;
}

// ---------------------------------------------------------------------------
// Bug 208：内建原型对象上的**自有写**优先于内建方法表
// ---------------------------------------------------------------------------
/** Abs 值是否可调用（fn 形状或挂了 impl 的宿主成员值） */
function isCallableValue(a: Abs): boolean {
  if (!a || typeof a !== "object" || !("shape" in a)) return false;
  if (a.shape.k === "fn") return true;
  return getFnImpl(a) !== undefined;
}

/**
 * Bug 194 S19：Abs 值是否**确定**不可调用（非「可能不可调用」）——调用面
 * 定抛 TypeError 的读面证据。
 *
 * - fn 形状 / 挂了 impl → 可调用；
 * - any / sum（并集）→ 不可判（并集里可能有可调用成员）；
 * - unknown 形状：只有 term 是**字面量**时才算确定（undef() = unknown
 *   形状 + lit undefined；LiteralValue 不含函数 ⇒ 字面量必非可调用）；
 *   无 term 的 unknown（推导失败）→ 不可判；
 * - 其余（prim / obj / brand / arr / tuple / eff …）→ 确定不可调用。
 */
function isDefinitelyNotCallableValue(a: Abs): boolean {
  if (isCallableValue(a)) return false;
  const k = a.shape.k;
  if (k === "any" || k === "sum") return false;
  if (k === "unknown") {
    const t = a.term;
    return !!t && t.op === "lit";
  }
  return true;
}

/**
 * 含内建父的类链（class MyMap extends Map {}）：**内建 owner** 解析。
 *
 * 派生类实例的 brand 名是**派生类名**（graft 产物），内建方法表按**内建名**
 * 建键 ⇒ 直查落空（`.get` / `.size` / `.has` 折 unknown = 族 02 遗留「含内建
 * 父的类链保守不判」——假阴性，非假抛）。沿类链找首个**内建 owner**（内建方法
 * 表命中该方法名），按该 owner 派发（读面 containers/member.ts 的
 * builtinOwnerOf 同口径：两面必须一致）。
 *
 * 用户面优先：链上（派生类及其中间用户类）有同名**用户方法**时归用户面
 * （原生派生类覆盖内建成员——class M extends Set { add(x){…} }）。
 */
function builtinChainOwner(brandName: string, method: string): string | undefined {
  let first = true;
  for (const name of evalClassChain(brandName)) {
    if (first) {
      first = false;
      // 派生类自身不是内建 owner（其 brand 名是派生类名）
      continue;
    }
    const methods = BUILTIN_BRAND_METHODS[name];
    if (!methods || !methods.has(method)) continue;
    // 用户面优先：链上有同名用户方法 ⇒ 不走内建派发
    if (findMethod(brandName, method)) return undefined;
    return name;
  }
  return undefined;
}

/**
 * Bug 194 S19：继承链上**每一环**都是注册用户类（原型面建模完备）。
 *
 * 链上有内建父类（`class MyDate extends Date {}`）时，原型面含内建真实原型
 * 方法——BUILTIN_BRAND_METHODS 非全列 ⇒「缺席」不可证 ⇒ 保守不判。
 * 链洞（extends 未注册父类）同理不可证。
 */
function classChainAllUserClasses(brandName: string): boolean {
  for (const name of evalClassChain(brandName)) {
    if (!getEvalClass(name)) return false;
  }
  return true;
}

/**
 * Bug 194 S19：注册用户类的原型链上是否有该键的**访问器**。
 *
 * `Object.defineProperty(X.prototype, "m", {get(){…}})` 装的 getter 住原型
 * 对象的访问器侧表——既不在 spec.accessors（类声明的 getter），也不在
 * chainProtoSlotOf 的数据槽面。调用面判定「方法缺席」时须排除它（访问器
 * 的返回值可能可调用 ⇒ 原生不抛）。
 */
function classProtoChainHasAccessor(brandName: string, key: string): boolean {
  for (const name of evalClassChain(brandName)) {
    if (!getEvalClass(name)) continue; // 只看注册用户类的原型对象
    const pb = protoBrandAbs(name);
    const inner = pb.shape.k === "brand" ? pb.shape.shape : undefined;
    if (!inner || inner.shape.k !== "obj") continue;
    if (lookupObjAccessor(inner, key)) return true;
  }
  return false;
}

/**
 * Bug 194 S19：调用面「读不到可调用目标」判定（仅**注册用户类**的实例域）。
 *
 * 原生口径：调用点拿不到**可调用**目标时定抛 TypeError（`a.m is not a
 * function`）——方法不存在（`delete X.prototype.m` 之后 / 从未定义）或
 * 方法在但值不是函数，两种情形同抛。
 *
 * 判定域限定为注册用户类的实例（getEvalClass 命中）且**继承链每一环都是
 * 注册用户类**：用户类的原型面是建模完备的（方法注册表 + 类声明访问器 +
 * 原型数据槽 + 继承链），缺席可证。内建 brand 的真实原型方法面
 * （BUILTIN_BRAND_METHODS 非全列）与内建父类链不在此域——保守不抛（避免
 * 假抛 false positive）。
 */
function callSiteHasNoCallableTarget(recv: Abs, method: string, readValue: Abs): boolean {
  const brandName = recv.shape.k === "brand" ? recv.shape.name : undefined;
  if (brandName === undefined) return false;
  // 类值接收者（A.m()）走静态派发面——不在此判定
  if (classNameOfValue(recv as object) === brandName) return false;
  // 非注册类（内建 brand / 宿主桥接类）→ 原型面不完备，缺席不可证
  if (getEvalClass(brandName) === undefined) return false;
  // 继承链每一环都得是注册用户类（链上有内建父类 / 链洞 → 缺席不可证）
  if (!classChainAllUserClasses(brandName)) return false;
  // Object.prototype 名恒可得（a.toString() 原生不抛）
  if (OBJECT_PROTO_NAMES.has(method)) return false;
  // 原型链数据槽 / 原型访问器上装了该键 → 成员在场（其值可能可调用）
  if (classProtoChainHasAccessor(brandName, method)) return false;
  // 方法在整个原型链上缺席（注册表 + 类声明访问器 + 原型数据槽）且接收者
  // 自有面无同名成员（ctor `this.m = fn` 写入的承载者 / 实例字段）→
  // 原生 TypeError
  if (!brandHasProtoMember(brandName, method) && !instanceOwnFaceHasMember(recv, brandName, method)) {
    return true;
  }
  // 方法在场但读到的值确定非可调用（undefined / 非函数字面量）→ 原生同抛
  return isDefinitelyNotCallableValue(readValue);
}

/** 内建原型对象（`X.prototype`）内层 obj 的自有槽取值 */
function builtinProtoOwnSlot(ctorName: string, method: string): Abs | undefined {
  const pb = protoBrandAbs(ctorName);
  const inner = pb.shape.k === "brand" ? pb.shape.shape : undefined;
  if (inner?.shape.k !== "obj") return undefined;
  const slot = getSlot(inner.shape.slots, method);
  return slot && !slot.optional ? slot.value : undefined;
}

/**
 * Bug 208：接收者的**内建原型 owner** 名（实例 brand / prim 装箱类型 /
 * 闭对象 → Object / 数组 → Array / promise → Promise）——用于查内建原型
 * 对象上的自有写。注册类（用户类）不在此列：用户类的原型写语义归 Bug 244。
 */
function builtinProtoOwnerOf(recv: Abs): string | undefined {
  const s = recv.shape;
  if (s.k === "brand") return s.name;
  if (s.k === "prim") return PRIM_HOME_BRAND[s.type];
  if (s.k === "obj") return "Object";
  if (s.k === "arr" || s.k === "tuple") return "Array";
  if (s.k === "eff") return s.eff === "promise" ? "Promise" : undefined;
  return undefined;
}

/**
 * Bug 208：接收者自身**没有**同名自有槽时，内建原型链上的自有写取值。
 *
 * 原生属性查找序（own → prototype）：原型对象上的自有数据属性**遮住**内建
 * 方法面——`Array.prototype.push = fn` 后 `a.push(2)` 走用户写的 fn；改成
 * 非函数则调用定抛 TypeError（`a.push is not a function`）。此前内建方法表
 * 直接命中，用户的写被完全遮蔽（读面 / 调用面都不认）。
 */
function builtinProtoOwnWrite(recv: Abs, method: string): Abs | undefined {
  // 接收者自有槽优先（原生 own 先于 prototype）——有则不查原型。
  const s = recv.shape;
  if (s.k === "brand") {
    const inner = s.shape;
    if (inner?.shape.k === "obj") {
      const own = getSlot(inner.shape.slots, method);
      if (own && !own.optional) return undefined;
    }
  } else if (s.k === "obj") {
    const own = getSlot(s.slots, method);
    if (own && !own.optional) return undefined;
  }
  const owner = builtinProtoOwnerOf(recv);
  if (owner === undefined) return undefined;
  for (const n of evalClassChain(owner)) {
    if (getEvalClass(n)) continue; // 用户类：原型写语义归 Bug 244（不在本片）
    const v = builtinProtoOwnSlot(n, method);
    if (v !== undefined) return v;
  }
  return undefined;
}

setProtoMethodDispatch((home, name, thisVal, args, origin) => {
  const recv: Abs = thisVal ?? $lit(undefined);
  // Bug 193/196：用户类方法值（classMethodValueAbs 产物）的摘下 / 借用调用
  // ——按**方法体 + this = 接收者**执行（原生：方法值是函数，调用它就跑那个
  // 函数体；this = 调用位给的接收者，摘下调用时恒 undefined）。此前按接收者
  // 的成员表反查被调用者（$invoke(recv,name,args)）⇒ 非本类实例的接收者
  // 一律「取不到方法」⇒ 假抛 TypeError（FALSE-THROW）。
  {
    const body = userClassMethodBody(home, name, recv, origin);
    if (body) {
      // 私有名（#m）：接收者 brand 校验（原生 PrivateCall——接收者须是
      // 声明类实例）
      privateNameGuard(recv, name);
      let result: Abs = unknown;
      let threw = false;
      try {
        result = body(recv, ...args);
        return result;
      } catch (e) {
        threw = true;
        result = throwPayloadOf(e);
        throw e;
      } finally {
        noteEvalCallRecord({ fnName: `${home}.${name}`, args, result, threw });
      }
    }
  }
  // Bug 208：内建原型对象上的**自有写**优先于内建方法表——`Array.prototype
  // .push = fn` 后 `Array.prototype.push.call(arr, x)` 走用户写的 fn；改成
  // 非函数则定抛 TypeError（原生 `X.prototype.m is not a function`）。
  {
    const own = builtinProtoOwnSlot(home, name);
    if (own !== undefined) {
      if (!isCallableValue(own)) throw new NudoThrow(errorTypeAbs("TypeError"));
      return $call(own, args, recv);
    }
  }
  // Bug 108：brand-checking 内建原型的借用调用——home 与接收者 brand 不匹配
  // 定抛 TypeError（原生 thisNumberValue/thisStringValue/… 前置校验：
  // Number.prototype.valueOf.call("5") 折 "5" 是假精确）。Object.prototype
  // （任意接收者合法）与 Array.prototype（上方物化 array-like）保持泛型。
  // Proxy 接收者（get/apply 陷阱可换壳）与 any/unknown/sum 不可判 → 不抛。
  // Bug 256 / 261：**表驱动**（brandCheckBrandOf）——String.prototype 上只有
  // toString / valueOf 要品牌（其余 30 个是 generic）；Error 家族不进品牌面
  // （Error.prototype.toString 是普通方法）。
  {
    const homeBrand = brandCheckBrandOf(home, name);
    if (homeBrand !== undefined) {
      const recvBrand = borrowedRecvBrandOf(recv);
      const ok = recvBrand === undefined || recvBrand === homeBrand;
      if (!ok) throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  // Bug 256：String.prototype 的 **generic** 方法（ES2023 §22.1.3）——
  // RequireObjectCoercible(this) + ToString(this) ⇒ 可借用给任何非 nullish
  // 接收者（原生 `String.prototype.toUpperCase.call(1)` → "1"；整条品牌检查
  // ⇒ 定抛 TypeError 假红）。品牌方法（toString / valueOf）已在上面定抛。
  if (
    (home === "String" || home === "string") &&
    !BRAND_CHECK_METHODS["String"]!.has(name)
  ) {
    const rs = recv.shape;
    const recvIsStr = rs.k === "prim" && (rs as { type?: string }).type === "string";
    if (!recvIsStr) {
      // nullish → RequireObjectCoercible 定抛（原生 TypeError）
      if (isNullishLitAbs(recv)) throw new NudoThrow(errorTypeAbs("TypeError"));
      // brand 接收者（装箱 String / 用户类实例 / Error 实例…）沿既有 brand 面
      if (rs.k !== "brand") {
        return $invoke(genericStringRecv(recv), name, args);
      }
    }
  }
  // Bug 261：Error.prototype.toString 是 **generic** 方法（无品牌检查）——
  // 只读 this.name / this.message ⇒ 借用给任意对象接收者（原生
  // `Error.prototype.toString.call({name:"X",message:"y"})` → "X: y"；
  // 此前整族进品牌检查面 ⇒ 定抛 TypeError 假红）。Error 实例沿既有 brand 面
  //（"Error: m"）。
  if (isErrorCtorName(home) && name === "toString" && !isErrorBrandRecv(recv)) {
    return genericErrorToString(recv);
  }
  if (home === "Array" && recv.shape.k !== "tuple" && recv.shape.k !== "arr") {
    const recvIsStrPrim =
      recv.shape.k === "prim" && (recv.shape as { type?: string }).type === "string";
    // Bug 259：mutator（push/pop/…）只在**字符串**接收者上原生定抛
    //（ToObject("ab") 的 length 不可写——node 实测
    // Array.prototype.push.call("ab",1) → TypeError: Cannot assign to read
    // only property 'length'）。其它原始值（number / boolean / bigint /
    // symbol）ToObject 后是**普通可扩展对象**（length 0）⇒ mutator 正常
    // 成功（node 实测 push.call(5,1) → 1、pop.call(5) → undefined）——此前
    // 一刀切定抛 ⇒ 假抛（L2 门禁假红）。读方法（slice/join/at/…）保持泛型。
    if (recvIsStrPrim && ARRAY_MUTATOR_METHODS.has(name)) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // Bug 254（端到端接线）：mutator（push/pop/shift/…）在**数组样对象**接收者
    // （`{length, 0: …}`）上，原生是**就地改接收者**（写 length 与索引槽），
    // 返回值按数组语义算。此前本臂把接收者**物化成副本**再派发 ⇒ 写落副本 ⇒
    // `push.call({length:0},5)` 之后 `o.length` 仍 0、`o[0]` 仍 undefined。
    // ⇒ mutator 走**原接收者**（invokeArrMethod 的泛型接收者臂 → $arrMutContainer
    // → mutateArrayLike 就地写），其余读方法保持物化通道。
    if (ARRAY_MUTATOR_METHODS.has(name) && recv.shape.k === "obj") {
      const direct = invokeArrMethod(recv, name, args);
      if (direct !== undefined) return direct;
    }
    // Bug 267：sort / reverse / fill / copyWithin 是「就地操作并返回 this」
    // ⇒ 非数组接收者上**返回接收者本身**（原生 `Array.prototype.sort.call({a:1})`
    // → {a:1}）；此前走物化通道 ⇒ 折成**空数组**（内容 + 身份全丢）。
    // 原始值接收者：原生返回 ToObject(prim) 包装对象（引擎无该形态）⇒ unknown。
    if (ARRAY_INPLACE_METHODS.has(name)) {
      if (recv.shape.k === "prim") return unknown;
      return recv;
    }
    // Bug 262：concat **不是**泛型数组算法——规范只把 this 的元素拷进结果，
    // 且前提是 IsArray(O) 为真；否则 this **整体作为第一个元素**追加
    //（原生 `Array.prototype.concat.call("ab")` → ["ab"]（长度 1）；此前按
    // 数组展开 → 长度 2、首元素 "a" ⇒ 元素数 / 首元素全错）。
    if (name === "concat" && !isArrayExoticRecv(recv)) {
      const seed = abs({ k: "tuple", elements: [recv] }, undefined, undefined, "exact");
      return $invoke(seed, name, args);
    }
    // Bug 268：with 在**原始值**接收者上原生定抛 RangeError（ToObject(prim)
    // 的 length = 0 ⇒ 下标必越界；node 实测 with.call(1,0,2) → RangeError:
    // Invalid index : 0；with.call(1,-1,2) → RangeError: Invalid index : -1
    // ——RelativeIndex 负值钳到 0（max(len+index, 0)）⇒ 任何下标都越界）——
    // 此前落 `return unknown`（不记抛 ⇒ L2 门禁假绿）。
    if (name === "with" && recv.shape.k === "prim" && !recvIsStrPrim) {
      const idx = args[0];
      if (idx !== undefined && (isSymbolAbs(idx) || isBigPrim(idx))) {
        // ToIntegerOrInfinity(symbol / bigint) 原生定抛 TypeError
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      const lv = idx === undefined ? undefined : litValue(idx);
      if (lv === undefined || !lv.ok) {
        recordMayThrow({
          kind: "RangeError",
          cause: "Array.prototype.with index may be out of range on a primitive receiver",
        });
        return unknown;
      }
      throw new NudoThrow(errorTypeAbs("RangeError"));
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
    // 其它原始值接收者（number / boolean / bigint / symbol）→ ToObject(prim)：
    // length 0 的**普通可扩展对象**（mutator 正常成功；写落到临时包装对象
    // 后即丢——原生同）。此前落 `return unknown`（连 push.call(5,1) → 1 都
    // 折不出来）。
    if (recv.shape.k === "prim") {
      const boxed = abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
      return $invoke(boxed, name, args);
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
