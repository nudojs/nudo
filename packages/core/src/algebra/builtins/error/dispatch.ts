/**
 * 品牌总分派：evalBuiltinNew（new X(...)）与 evalBuiltinInstanceMethod
 * （brand 实例方法）+ DataView/TypedArray 实例方法族（evalDataViewMethod /
 * taLengthSlotLit / taSetSourceLength / brandObjSlots）。
 *
 * Invariants:
 * - 两入口是内建构造/实例方法的总分派（exec $new 宿主分支与 Abs 面
 *   evalBuiltinNew 共用各域 builder；未建模名/方法 → undefined 走通用
 *   回退，不得折精确值）。
 * - TA set 三段校验（Bug 38）：ToIndex(offset) + ToObject(source) +
 *   off+srcLen > tgtLen 越界——长度读 binary 域构造入槽的 length 槽
 *  （makeTypedArrayAbs 数字形态）/ taSetSourceLength（tuple 元数/字符串
 *   长度/TA 源槽/装箱折 0）；成功恒返 undefined，元素拷贝值域不建模。
 * - ArrayBuffer.resize（Bug 39）：resizable 槽 false 字面量定抛
 *   TypeError；成功臂 byteLength 槽**原地更新**（$set 引用语义惯例——
 *   别名同步）；transfer/grow/slice 不在此扩 scope。
 * - DataView get/set 族（Bug 35）：byteOffset 过 ToIndex + off+bits/8 >
 *   viewLen 定抛 RangeError；读返回域按元素类型（bigint 家族 → bigint）。
 * - Error 家族 toString/toLocaleString = `${name}: ${message}`（槽已
 *   建模，空 message 只返 name）；Map/Set 方法族落 collections 条目机，
 *   迭代三件套经 iterator.ts 协议对象（collectionIteratorFor——**live
 *   视图**，Bug 198：新增条目被访问、删除条目被跳过；快照与 live 同投影，
 *   live 迭代器不登记静态元素侧表），Set ES2025 方法族先过 binary 域 set-like
 *   校验再 setMethodFold
 *  （不可折 → 集合运算诚实 unknown / is* 抽象 boolean）。
 */

import type { Abs } from "../../abs.ts";
import { abs, strLit, numLit, litValue, boolLit, bool, unknown } from "../../abs.ts";
import { getSlot, setSlot } from "../../objects.ts";
import {
  makeMapAbs,
  makeSetAbs,
  mapGetEntry,
  mapHasEntry,
  mapSetEntry,
  mapDeleteEntry,
  mapClearEntries,
  mapSizeAbs,
  setAddEntry,
  setHasEntry,
  setDeleteEntry,
  setClearEntries,
  setSizeAbs,
  setMethodFold,
  ctorArgDefinitelyInvalid,
  makeWeakCollectionAbs,
  classifyCanBeHeldWeakly,
} from "../../collections.ts";
import { undefAbs } from "../../hof.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { str, numPrim, boolPrim, typedArrayElementOf } from "../shared.ts";
import { makeArrayCtorAbs } from "../array.ts";
import { evalDateCtor, evalDateMethod } from "../date.ts";
import { evalRegExpCtor, evalRegExpMethod } from "../regexp.ts";
import { evalPromiseCtor } from "../promise.ts";

import {
  errorBrandAbs,
  isErrorCtorName,
  makeProxyAbs,
  isNullishLit,
  enforceCanBeHeldWeakly,
  isDefinitelyUndefinedArg,
} from "./error-family.ts";
import {
  makeArrayBufferAbs,
  makeSharedArrayBufferAbs,
  makeDataViewAbs,
  makeTypedArrayAbs,
  enforceToIndex,
  toIndexLiteralValue,
  mayBeNullishOperand,
  enforceSetMethodArg,
} from "./binary.ts";
import { makeUrlAbs } from "./web.ts";
import { makeBoxedAbs } from "./boxed.ts";
import { makeIntlFormatAbs } from "./intl.ts";
import {
  makeDynamicFunctionAbs,
  makeWeakRefAbs,
  makeFinalizationRegistryAbs,
} from "./misc-ctor.ts";
import {
  collectionIteratorFor,
} from "./iterator.ts";

/**
 * Bug 198：Map/Set 迭代三件套（keys / values / entries）= **live 视图**的
 * 协议对象——原生迭代器持条目指针：迭代期间**新增**的条目被访问、**删除**的
 * 条目被跳过（`const it = m.keys(); it.next(); m.delete("b"); it.next().done`
 * 原生 true，引擎快照口径折 false）。
 *
 * 投影与 live 视图的**同口径实现**都在 `builtins/error/iterator.ts` 的
 * `collectionIteratorFor`（project 闭包只有一份：Map 的 keys/values 给
 * 键/值，Set 的 entries 给 [el,el] 元组）——本文件此前自建了一份等价实现
 * （绕开 iterator.ts 的投影错配），S17 已改回**直调**。
 */

/** new X(...) */
export function evalBuiltinNew(className: string, args: Abs[]): Abs | undefined {
  // Bug 21：TypedArray 家族（TYPED_ARRAY_ELEMENT 表驱动）——length 实参
  // ToIndex 校验；$new 宿主分支共用 makeTypedArrayAbs
  if (typedArrayElementOf(className) !== undefined) {
    return makeTypedArrayAbs(className, args);
  }
  switch (className) {
    case "Date":
      return evalDateCtor(args);
    case "RegExp":
      return evalRegExpCtor(args);
    case "Function":
      // Bug 29：构造器形与调用形同口径（makeDynamicFunctionAbs 单一 builder）
      return makeDynamicFunctionAbs(args);
    case "Symbol":
      // new Symbol() 原生 TypeError
      throw new NudoThrow(errorTypeAbs("TypeError"));
    case "BigInt":
      // Bug 45：BigInt 无 [[Construct]]（.prototype 存在但不可构造）→ 确定
      // TypeError（与 Symbol 同口径）
      throw new NudoThrow(errorTypeAbs("TypeError"));
    case "Promise":
      return evalPromiseCtor(args);
    case "Array":
      return makeArrayCtorAbs(args);
    case "Number":
    case "Boolean":
    case "String":
      // Bug 22：装箱统一 makeBoxedAbs（[[PrimitiveValue]] 槽 + String 下标槽；
      // Number symbol 实参 ToNumber 确定 TypeError、any → may——builder 内记）
      return makeBoxedAbs(className, args[0]);
    case "Map":
      // C1.1：可选 entry 元组列表填充字面量映射；
      // 确定非法实参（prim 条目/非可迭代）→ NudoThrow(TypeError)
      // （evaluator $new 同口径；$catchVal 吸收 NudoThrow）
      if (ctorArgDefinitelyInvalid("Map", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeMapAbs(args[0]);
    case "Set":
      // C1.2：从 iterable 填充元素联合
      if (ctorArgDefinitelyInvalid("Set", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeSetAbs(args[0]);
    case "WeakMap":
    case "WeakSet":
      // Bug 15：Map/Set 同口径 iterable 校验；合法 → 空 brand（条目表不建模）
      return makeWeakCollectionAbs(className as "WeakMap" | "WeakSet", args[0]);
    case "WeakRef":
      // Bug 25：target CanBeHeldWeakly 校验（与 FCR.register 同口径）
      return makeWeakRefAbs(args[0]);
    case "FinalizationRegistry":
      // Bug 25：cleanupCallback IsCallable 前置校验（缺省同抛）
      return makeFinalizationRegistryAbs(args[0]);
    case "Proxy":
      // Bug 37：target/handler IsObject 校验
      return makeProxyAbs(args[0], args[1]);
    case "ArrayBuffer":
      // Bug 41：length 过 ToIndex（负/超界 → RangeError；symbol/bigint → TypeError）
      // Bug 15：options.maxByteLength 同校验；实参存槽
      return makeArrayBufferAbs(args[0], args[1]);
    case "SharedArrayBuffer":
      // Bug 15：SAB 同款 ToIndex 校验 + 槽构造（growable 面）
      return makeSharedArrayBufferAbs(args[0], args[1]);
    case "DataView":
      // Bug 63：buffer IsArrayBuffer + byteOffset/byteLength ToIndex
      return makeDataViewAbs(args[0], args[1], args[2]);
    case "URL":
      // Bug 85：input ToString + URL 解析校验（字面量真解析带 href 槽）
      return makeUrlAbs(args[0], args[1]);
    case "Intl.NumberFormat":
    case "Intl.DateTimeFormat":
      // Bug 44：makeIntlCtorAbs 的 fn name 按名派发——locale 校验构造
      return makeIntlFormatAbs(
        className === "Intl.NumberFormat" ? "NumberFormat" : "DateTimeFormat",
        args[0],
      );
    default:
      // C2.2：Error 家族 → name/message 槽
      if (isErrorCtorName(className)) {
        return errorBrandAbs(className, args);
      }
      return undefined;
  }
}

/**
 * Bug 35：DataView.prototype get/set 存取族元素位宽（getFloat16/setFloat16
 * 为 ES2025 面，node v26 已有——台账键同名登记）。
 */
const DATAVIEW_ACCESS_BITS: Record<string, number> = {
  getInt8: 8, getUint8: 8,
  getInt16: 16, getUint16: 16, getFloat16: 16,
  getInt32: 32, getUint32: 32, getFloat32: 32,
  getBigInt64: 64, getBigUint64: 64, getFloat64: 64,
  setInt8: 8, setUint8: 8,
  setInt16: 16, setUint16: 16, setFloat16: 16,
  setInt32: 32, setUint32: 32, setFloat32: 32,
  setBigInt64: 64, setBigUint64: 64, setFloat64: 64,
};

/**
 * Bug 35：DataView get/set 存取族——byteOffset 实参过 ToIndex（负 →
 * RangeError；缺省/undefined → 0），越界（offset + 元素宽 > 视图
 * byteLength 槽）→ 定抛 RangeError；组合不可判（抽象 offset / 视图长度
 * 折不出）→ may RangeError。读返回域按元素类型（number 家族 → number、
 * BigInt64/BigUint64 → bigint——元素值域未建模的诚实 prim 域），写恒
 * undefined；littleEndian 实参 ToBoolean 恒不抛不校验。
 */
function evalDataViewMethod(method: string, recv: Abs, args: Abs[]): Abs | undefined {
  // Bug 91：own-property 查表——DATAVIEW_ACCESS_BITS 是宿主普通对象，
  // 裸 `table[method]` 原型链取值令 Object.prototype 继承名（toString/
  // valueOf/hasOwnProperty/…）全部命中（host 函数 ≠ undefined），被当
  // 建模的字节偏移访问器：每个未建模方法折 number 域、Symbol/BigInt 实参
  // 假 TypeError / 假 may RangeError。表外名 → undefined（未接管）。
  const bits = Object.hasOwn(DATAVIEW_ACCESS_BITS, method) ? DATAVIEW_ACCESS_BITS[method] : undefined;
  if (bits === undefined) return undefined;
  const isBigint = method === "getBigInt64" || method === "getBigUint64";
  const isSet = method.startsWith("set");
  enforceToIndex(args[0], `DataView.prototype.${method} byteOffset`);
  const offV = toIndexLiteralValue(args[0]);
  const inner = recv.shape.k === "brand" ? recv.shape.shape : undefined;
  const viewLenAbs =
    inner && inner.shape.k === "obj" ? getSlot(inner.shape.slots, "byteLength")?.value : undefined;
  const viewLenV = viewLenAbs !== undefined ? toIndexLiteralValue(viewLenAbs) : undefined;
  if (offV !== undefined && viewLenV !== undefined) {
    if (offV + bits / 8 > viewLenV) throw new NudoThrow(errorTypeAbs("RangeError"));
  } else {
    recordMayThrow({ kind: "RangeError", cause: `DataView.prototype.${method} byteOffset may exceed the view bounds` });
  }
  if (isSet) return undefAbs();
  return isBigint
    ? abs({ k: "prim", type: "bigint" }, undefined, undefined, "path")
    : numPrim("path");
}

/** Bug 38：TA brand 的 length 槽数字折叠（makeTypedArrayAbs 数字形态入槽；
 * iterable/buffer 形态与抽象长度 → undefined，越界档落 may） */
function taLengthSlotLit(recv: Abs): number | undefined {
  if (recv.shape.k !== "brand") return undefined;
  const inner = (recv.shape as { shape: Abs }).shape;
  if (inner.shape.k !== "obj") return undefined;
  const lenA = getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "length")?.value;
  if (!lenA) return undefined;
  const v = litValue(lenA);
  return v.ok && typeof v.value === "number" ? v.value : undefined;
}

/**
 * Bug 38：set 源长度折叠（原生 array-like 的 Get(source,"length") →
 * ToLength 语义）：tuple 元数 / 字符串字面量长度 / TA 源 length 槽 / 装箱
 * prim 与无 length 槽闭对象折 0；其余（arr 抽象元素、open obj、any、抽象
 * length 槽、symbol 槽）不可判 → undefined（越界档落 may）。
 */
function taSetSourceLength(src: Abs): number | undefined {
  const k = src.shape.k;
  if (k === "tuple") return (src.shape as { elements: Abs[] }).elements.length;
  if (k === "prim") {
    if ((src.shape as { type?: string }).type === "string") {
      const v = litValue(src);
      return v.ok && typeof v.value === "string" ? v.value.length : undefined;
    }
    return 0; // number/bool/bigint/symbol 装箱无 length → ToLength(undefined)=0
  }
  if (k === "brand" && typedArrayElementOf((src.shape as { name?: string }).name ?? "") !== undefined) {
    return taLengthSlotLit(src);
  }
  if (k === "obj" && (src.shape as { open?: boolean }).open !== true) {
    const lenA = getSlot((src.shape as { slots: Record<string, { value: Abs }> }).slots, "length")?.value;
    if (!lenA) return 0; // 无 length 槽：Get → undefined → 0
    if (lenA.term?.op === "lit") {
      const v = lenA.term.value;
      if (v === null || v === undefined) return 0;
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
        const n = Number(v);
        if (Number.isNaN(n)) return 0;
        return Math.min(Math.max(Math.trunc(n), 0), Number.MAX_SAFE_INTEGER);
      }
    }
  }
  return undefined;
}

/** brand 内层 obj 槽表（非 obj 内层 → undefined） */
function brandObjSlots(recv: Abs): Record<string, { value: Abs }> | undefined {
  if (recv.shape.k !== "brand") return undefined;
  const inner = (recv.shape as { shape: Abs }).shape;
  return inner.shape.k === "obj"
    ? (inner.shape as { slots: Record<string, { value: Abs }> }).slots
    : undefined;
}

/** brand 实例方法（Date/RegExp/Map/Set/Error 家族/装箱拆箱后的 prim 面在外层） */
export function evalBuiltinInstanceMethod(
  brandName: string,
  method: string,
  recv: Abs,
  args: Abs[],
): Abs | undefined {
  if (brandName === "Date") return evalDateMethod(method, recv, args);
  if (brandName === "RegExp") return evalRegExpMethod(method, recv, args);
  // Bug 35：DataView get/set 存取族（bounds 校验 + 元素域返回）
  if (brandName === "DataView") return evalDataViewMethod(method, recv, args);
  // Bug 38：%TypedArray%.prototype.set(source, offset) —— 原生三段校验：
  // ① ToIndex(offset)（负/±∞/超 2^53-1 → RangeError；symbol/bigint →
  //    TypeError；抽象 → may RangeError，复用 enforceToIndex）；② ToObject
  //    (source)（nullish 字面量/缺省 → 定抛 TypeError；any/含 nullish 臂
  //    sum → may）；③ targetOffset + sourceLength > targetLength → RangeError
  //    ——target 长度读 makeTypedArrayAbs 的 length 槽（数字形态折叠），
  //    source 长度读 taSetSourceLength（tuple 元数/字符串长度/TA 源槽/装箱
  //    折 0）；任一侧不可判 → 保守 may。成功恒返 undefined；元素拷贝值域
  //    不建模（imprecision，同长度口径）。
  if (typedArrayElementOf(brandName) !== undefined && method === "set") {
    const offset = args.length > 1 ? args[1] : undefined;
    enforceToIndex(offset, "TypedArray.prototype.set offset");
    const src = args[0];
    if (!src || isNullishLit(src)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (mayBeNullishOperand(src)) {
      recordMayThrow({ kind: "TypeError", cause: "TypedArray.prototype.set source ToObject may throw (null/undefined)" });
    }
    const offV = toIndexLiteralValue(offset);
    const srcLen = taSetSourceLength(src);
    const tgtLen = taLengthSlotLit(recv);
    if (offV !== undefined && srcLen !== undefined && tgtLen !== undefined) {
      if (offV + srcLen > tgtLen) throw new NudoThrow(errorTypeAbs("RangeError"));
    } else {
      recordMayThrow({ kind: "RangeError", cause: "TypedArray.prototype.set may exceed target bounds" });
    }
    return undefAbs();
  }
  // Bug 39：ArrayBuffer.prototype.resize(newLength) —— ValidateAndApply：
  // ① resizable 槽 false 字面量 → 定抛 TypeError（原生先于 newLength 求值）；
  //    抽象 → may TypeError。② newLength 过 ToIndex（负/超界 → RangeError；
  //    symbol/bigint → TypeError；抽象 → may）。③ newLength > maxByteLength
  //    槽 → 定抛 RangeError；任一侧抽象 → may。成功臂：byteLength 槽原地
  //    更新（$set 引用语义惯例——别名同步；字面量折新值、抽象 → number
  //    域）；恒返 undefined。transfer/grow/slice 不扩 scope（另行任务）。
  if (brandName === "ArrayBuffer" && method === "resize") {
    const slots = brandObjSlots(recv);
    const resizableA = slots ? getSlot(slots, "resizable")?.value : undefined;
    const resR = resizableA ? litValue(resizableA) : undefined;
    const resizableLit = resR?.ok && typeof resR.value === "boolean" ? resR.value : undefined;
    if (resizableLit === false) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (resizableLit === undefined) {
      recordMayThrow({ kind: "TypeError", cause: "ArrayBuffer.prototype.resize buffer may not be resizable" });
    }
    enforceToIndex(args[0], "ArrayBuffer resize newLength");
    const newLen = toIndexLiteralValue(args[0]);
    const maxA = slots ? getSlot(slots, "maxByteLength")?.value : undefined;
    const maxV = maxA ? toIndexLiteralValue(maxA) : undefined;
    if (newLen !== undefined && maxV !== undefined) {
      if (newLen > maxV) throw new NudoThrow(errorTypeAbs("RangeError"));
    } else {
      recordMayThrow({ kind: "RangeError", cause: "ArrayBuffer resize newLength may exceed maxByteLength" });
    }
    if (slots) {
      setSlot(slots, "byteLength", { value: newLen !== undefined ? numLit(newLen) : numPrim("path") });
    }
    return undefAbs();
  }
  // Bug 42：URL.prototype.toJSON ≡ href（原生恒 string，total——与 Date 的
  // toJSON 同语义；toString 巧合路径之外补显式面）
  if (brandName === "URL") {
    if (method === "toJSON") {
      const inner = recv.shape.k === "brand" ? recv.shape.shape : undefined;
      const href =
        inner && inner.shape.k === "obj"
          ? getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "href")?.value
          : undefined;
      const hv = href ? litValue(href) : undefined;
      if (hv?.ok && typeof hv.value === "string") return strLit(hv.value);
      return str("path");
    }
    return undefined;
  }
  // Bug 10：Error 家族 toString/toLocaleString = `${name}: ${message}`
  // （name/message 槽已建模；原生空 message 只返 name）；valueOf 走
  // Object.prototype 恒等（既有路径，不在此接管）
  if (isErrorCtorName(brandName)) {
    switch (method) {
      case "toString":
      case "toLocaleString": {
        const inner = recv.shape.k === "brand" ? recv.shape.shape : undefined;
        const nameA = inner && inner.shape.k === "obj" ? getSlot(inner.shape.slots, "name")?.value : undefined;
        const msgA = inner && inner.shape.k === "obj" ? getSlot(inner.shape.slots, "message")?.value : undefined;
        const nameR = nameA ? litValue(nameA) : undefined;
        const msgR = msgA ? litValue(msgA) : undefined;
        const nv = nameR?.ok && typeof nameR.value === "string" ? nameR.value : undefined;
        const mv = msgR?.ok && typeof msgR.value === "string" ? msgR.value : undefined;
        if (nv !== undefined && mv !== undefined) {
          return strLit(mv === "" ? nv : `${nv}: ${mv}`);
        }
        return str("path");
      }
      default:
        return undefined;
    }
  }
  if (brandName === "Map") {
    switch (method) {
      case "get":
        return mapGetEntry(recv, args[0]);
      case "has":
        return mapHasEntry(recv, args[0]);
      case "set":
        return mapSetEntry(recv, args[0], args[1] ?? unknown);
      case "delete":
        return mapDeleteEntry(recv, args[0]);
      case "clear":
        return mapClearEntries(recv);
      case "size":
        return mapSizeAbs(recv);
      // Bug 23：迭代器三件套 → 带协议面的迭代器对象（条目表精确展开）
      // Bug 198：改走 **live 视图**（collectionIteratorFor）——原生 Map
      // 迭代器持条目指针：迭代期间**新增**的条目被访问、**删除**的条目被跳过
      // （`const it = m.keys(); it.next(); m.delete("b"); it.next().done` 原生
      // true，引擎快照口径折 false）。collectionIteratorAbs 的快照语义保留
      // 给静态视图（Array.from 等）。
      case "keys":
        return collectionIteratorFor(recv, "keys");
      case "values":
        return collectionIteratorFor(recv, "values");
      case "entries":
        return collectionIteratorFor(recv, "entries");
      default:
        return undefined;
    }
  }
  if (brandName === "Set") {
    switch (method) {
      case "has":
        return setHasEntry(recv, args[0]);
      case "add":
        return setAddEntry(recv, args[0] ?? unknown);
      case "delete":
        return setDeleteEntry(recv, args[0]);
      case "clear":
        return setClearEntries(recv);
      case "size":
        return setSizeAbs(recv);
      // Bug 23：Set keys ≡ values ≡ 元素序列；entries → [el, el] 条目
      // Bug 198：同 Map 三件套——改走 live 视图（新增条目被访问、删除条目跳过）
      case "keys":
      case "values":
        return collectionIteratorFor(recv, "values");
      case "entries":
        return collectionIteratorFor(recv, "entries");
      // Bug 28：ES2025 Set 方法族——实参 GetSetRecord 校验（非对象 /
      // .size NaN / .has·.keys 非 callable → TypeError）+ 值域折叠
      // （setMethodFold：双方条目表确切时 union 恒折、其余运算与 is*
      // 谓词全字面量折；不可折 → 集合运算诚实 unknown / is* 抽象 boolean）。
      case "union":
      case "intersection":
      case "difference":
      case "symmetricDifference":
      case "isSubsetOf":
      case "isSupersetOf":
      case "isDisjointFrom": {
        enforceSetMethodArg(args[0], method);
        const isPred =
          method === "isSubsetOf" || method === "isSupersetOf" || method === "isDisjointFrom";
        return setMethodFold(recv, method, args[0] as Abs) ?? (isPred ? boolPrim() : unknown);
      }
      default:
        return undefined;
    }
  }
  // Bug 12/22：WeakMap/WeakSet 实例方法——弱持有条目表不建模（key 身份
  // 不在分析域，makeWeakCollectionAbs 空 brand）：set/add 键过 CanBeHeldWeakly
  // （enforceCanBeHeldWeakly 与 FCR 同口径：prim/nullish 字面量与缺省 →
  // 确定 TypeError；symbol/对象形态合法弱键——注册 Symbol.for 原生抛、
  // 未注册不抛，Abs 无注册标记不可分，保守按合法；抽象 → may）；返回面
  // set/add → receiver（原生恒返 this，链式精确），get/has/delete 原生对
  // 非弱键不抛直返 undefined/false——确定非弱键可精确折，其余键条目表
  // 不建模：get → unknown、has/delete → 抽象 boolean。
  if (brandName === "WeakMap" || brandName === "WeakSet") {
    if (method === "set" || method === "add") {
      enforceCanBeHeldWeakly(args[0], `${brandName}.prototype.${method} key`);
      return recv;
    }
    if (method === "get" || method === "has" || method === "delete") {
      if (classifyCanBeHeldWeakly(args[0]).k === "def") {
        return method === "get" ? undefAbs() : boolLit(false);
      }
      return method === "get" ? unknown : boolPrim();
    }
    return undefined;
  }
  // Bug 43：FCR register/unregister 的 IsObject（CanBeHeldWeakly）校验——
  // 此前走空 brand 兜底不校验 target（L2 漏报）。FCR 实例是 $new 空 brand
  // 兜底产物（brand 名 "FinalizationRegistry"，$invokeInner 品牌派发直达）。
  if (brandName === "FinalizationRegistry") {
    switch (method) {
      case "register":
        // target 非弱键 → TypeError（node 实测 register(1,1)/('s',1)/(null,1)/
        // (undefined,1)/(true,1)/(1n,1) 抛；register(Symbol(),1)/({},1) 合法）；
        // heldToken 任意值合法（原生不校验）；unregisterToken 仅在给出且
        // 非 undefined 时同校验（SameValue(·,undefined) 豁免，null 仍抛）
        enforceCanBeHeldWeakly(args[0], "FinalizationRegistry.prototype.register target");
        if (!isDefinitelyUndefinedArg(args[2])) {
          enforceCanBeHeldWeakly(args[2], "FinalizationRegistry.prototype.register unregisterToken");
        }
        return undefAbs(); // 原生恒 undefined（may 档亦然——非抛臂返回面确定）
      case "unregister":
        // token 过 CanBeHeldWeakly（无 register 的 undefined 豁免——缺省/
        // undefined 字面量亦抛，node 实测）；cells 表未建模 → 保守 boolean
        enforceCanBeHeldWeakly(args[0], "FinalizationRegistry.prototype.unregister unregisterToken");
        return boolPrim();
      default:
        return undefined;
    }
  }
  return undefined;
}
