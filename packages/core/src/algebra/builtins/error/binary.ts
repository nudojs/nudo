/**
 * 二进制缓冲族：ArrayBuffer/SharedArrayBuffer/DataView/TypedArray 构造
 * （makeXxxAbs）+ ToIndex 校验机制（classifyToIndex/enforceToIndex/
 * toIndexLiteralValue）+ %TypedArray%.from/of 静态面（evalTypedArrayStatic）
 * + set-like 实参校验（enforceSetMethodArg，GetSetRecord 三读）。
 *
 * Invariants:
 * - ToIndex 三档（Bug 41/63）：range/type → NudoThrow；may →
 *   recordMayThrow(RangeError)（值域不变）；数值折叠与 ok 档同口径
 *  （nullish/NaN/良性 valueOf → 0，字面量 trunc(ToNumber(v))）。
 * - 构造实参存 brand 槽（Bug 15：byteLength/maxByteLength/resizable|growable、
 *   DataView byteOffset/byteLength、TA length）——字面量 ToIndex 精确折叠、
 *   抽象 → number 域；resizable/growable 三分（absent/present/
 *   undecidable）不得假折 false；TA length 槽 enumerable:false（枚举视图空）。
 * - ctor/实例方法的越界档（Bug 35/38：DV off+len > bufLen、resize > max、
 *   TA set off+srcLen > tgtLen）读这些槽判 definite RangeError，组合不可判
 *   → may；消费方在 dispatch.ts。
 * - TA from 不做 iterable 校验（非可迭代非 array-like 原生折空数组不抛，
 *   与 Map/Set ctor 口径不同）；mapFn IsCallable 前置 + tuple items 逐元素
 *   执行（Bug 37 对齐 Array.from）；of 逐项过元素转换（number ToNumber /
 *   bigint ToBigInt——enforceTaBigIntItem）。
 * - set-like 校验（Bug 28）：IsObject / ToNumber(.size) 非 NaN / .has·.keys
 *   callable 三读——Set/Map brand 天然合法、闭 obj 逐槽（无 size 槽定抛）、
 *   open obj/fn/any/unknown/sum → may。
 */

import type { Abs } from "../../abs.ts";
import { abs, numLit, litValue, boolLit, bool, unknown } from "../../abs.ts";
import { objOf, getSlot } from "../../objects.ts";
import { isSetAbs, isMapAbs } from "../../collections.ts";
import { validateCallableArg, applyCallbackValue } from "../../hof.ts";
import { pTrue } from "../../pred.ts";
import { defaultLeakBudget } from "../../leak.ts";
import { emptyEnv } from "../../ast-env.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { setPropFlags } from "../invariants.ts";
import { isSymbolAbs } from "../symbol.ts";
import {
  numPrim,
  boolPrim,
  mayCoerceThrowOperand,
  isBigintPrimAbs,
  typedArrayElementOf,
} from "../shared.ts";

import { isNullishLit, isDefinitelyUndefinedArg } from "./error-family.ts";

/** ES ToIndex 校验分类（ArrayBuffer length / DataView byteOffset·byteLength） */
type ToIndexClass = { k: "ok" } | { k: "range" } | { k: "type" } | { k: "may" };

const MAX_TO_INDEX = 2 ** 53 - 1;

/**
 * Bug 41/63：ES ToIndex —— ToNumber 后整数值 < 0 或 > 2^53-1 → RangeError；
 * symbol/bigint 的 ToNumber → TypeError；NaN/nullish → 0 合法；对象经
 * valueOf（良性惯例）→ NaN → 0 合法；any/unknown/抽象 prim → may。
 */
function classifyToIndex(a: Abs | undefined): ToIndexClass {
  if (!a || isNullishLit(a)) return { k: "ok" }; // 缺省/nullish：ToNumber → NaN → 0
  const s = a.shape;
  if (s.k === "prim") {
    // shape-first：symbol 恒无 lit term（JS 无 symbol 字面量），先查形态
    if (s.type === "symbol") return { k: "type" };
    const vR = litValue(a);
    if (!vR.ok) return { k: "may" }; // 抽象 prim（约束参数）：值未知
    const v = vR.value;
    if (v === undefined || v === null) return { k: "ok" }; // ToNumber → NaN → 0
    if (typeof v === "bigint") return { k: "type" }; // ToNumber(bigint) 原生 TypeError
    const n = Number(v); // number/string/boolean 的 ToNumber（含 "8"/"-1" 字符串折算）
    if (Number.isNaN(n)) return { k: "ok" }; // "abc"/undefined 字符串 → NaN → 0
    if (n === Infinity || n === -Infinity) return { k: "range" };
    const t = Math.trunc(n);
    return t < 0 || t > MAX_TO_INDEX ? { k: "range" } : { k: "ok" };
  }
  if (s.k === "any" || s.k === "unknown") return { k: "may" };
  if (s.k === "sum") {
    for (const m of s.members) {
      const c = classifyToIndex(m);
      // 有坏成员但可能取好成员 → 整体 may（不 definite）
      if (c.k !== "ok") return { k: "may" };
    }
    return { k: "ok" };
  }
  return { k: "ok" }; // obj/fn/brand/tuple/arr/eff：valueOf 良性 → 0
}

/** ToIndex 校验落地：range/type → NudoThrow；may → recordMayThrow(RangeError) */
export function enforceToIndex(a: Abs | undefined, what: string): void {
  const c = classifyToIndex(a);
  if (c.k === "range") throw new NudoThrow(errorTypeAbs("RangeError"));
  if (c.k === "type") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (c.k === "may") {
    recordMayThrow({ kind: "RangeError", cause: `${what} may be negative or invalid (ToIndex)` });
  }
}

/**
 * Bug 15：ToIndex 数值折叠（与 classifyToIndex ok 档同口径的数值面）：
 * 字面量 prim → trunc(ToNumber(v))；nullish/NaN → 0；抽象/对象形态 →
 * undefined（域不可折，调用方落 number 域）。type/range 档已由 enforceToIndex
 * 先行抛出，这里不再重复判定。
 */
export function toIndexLiteralValue(a: Abs | undefined): number | undefined {
  if (!a) return 0;
  // nullish 字面量（shape k:"unknown" + lit term）→ ToNumber → NaN → 0
  if (a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined)) return 0;
  const s = a.shape;
  if (s.k !== "prim") return undefined;
  if (s.type === "symbol") return undefined;
  // 直接读 term（litValue 对 lit undefined 返回 not-ok——undefined 是哨兵）
  if (a.term?.op !== "lit") return undefined;
  const v = a.term.value;
  if (v === undefined || v === null) return 0;
  if (typeof v === "bigint") return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.trunc(n);
}

/**
 * Bug 15 补（review）：options.maxByteLength 三分可判性。
 * - absent：无 options / nullish 字面量（node v26 实测 `new ArrayBuffer(8, null)`
 *   同 undefined —— 不抛、非 resizable）/ 闭对象无自有槽 / 槽为字面量
 *   undefined —— ES2024 `Get(options,"maxByteLength")` 返回 undefined
 *   （缺省 ≡ 显式 undefined）⇒ 非 resizable，maxByteLength = byteLength
 *   （native 实测：`new ArrayBuffer(8,{maxByteLength:undefined}).resizable === false`）；
 * - present：闭对象自有非-undefined 槽 ⇒ resizable，走 ToIndex 校验 + 折叠
 *   （null 槽值 ≠ undefined：ToIndex(null)=0，0 < byteLength → RangeError）；
 * - undecidable：open obj / any / unknown / sum —— 运行时可能带任意
 *   maxByteLength，不得折叠 false（false precision）。
 */
type BufferOptionsClass =
  | { k: "absent" }
  | { k: "present"; value: Abs }
  | { k: "undecidable" };

function classifyBufferOptions(options: Abs | undefined): BufferOptionsClass {
  if (!options) return { k: "absent" };
  if (options.term?.op === "lit" && (options.term.value === null || options.term.value === undefined)) {
    return { k: "absent" };
  }
  const s = options.shape;
  if (s.k === "obj" && s.open !== true) {
    const slot = getSlot(s.slots, "maxByteLength");
    if (slot === undefined) return { k: "absent" };
    if (slot.value.term?.op === "lit" && slot.value.term.value === undefined) return { k: "absent" };
    return { k: "present", value: slot.value };
  }
  if (s.k === "any" || s.k === "unknown" || s.k === "sum" || (s.k === "obj" && s.open === true)) {
    return { k: "undecidable" };
  }
  // 其余闭形态（prim/tuple/arr/fn/brand…）：ToObject 后无 maxByteLength 键 → absent
  return { k: "absent" };
}

/**
 * Bug 41：new ArrayBuffer(length) —— length 过 ToIndex：负数/±∞/超 2^53-1 →
 * RangeError；symbol/bigint → TypeError（ToNumber）；缺省/NaN → 0 合法。
 * Bug 15：构造实参存入 brand 槽（字面量 ToIndex 精确折叠、抽象 → number 域）：
 * byteLength / maxByteLength（options.maxByteLength，缺省 ≡ byteLength）/
 * resizable（present → true；absent → false；undecidable → boolean 域）。
 * Review 补：present 且 maxByteLength < byteLength → RangeError（native 实测）；
 * 任一侧抽象 → 该比较 may-throw。
 */
export function makeArrayBufferAbs(len: Abs | undefined, options?: Abs | undefined): Abs {
  enforceToIndex(len, "ArrayBuffer length");
  const oc = classifyBufferOptions(options);
  const bl = toIndexLiteralValue(len);
  let maxV: number | undefined;
  if (oc.k === "present") {
    enforceToIndex(oc.value, "ArrayBuffer maxByteLength");
    maxV = toIndexLiteralValue(oc.value);
    if (maxV !== undefined && bl !== undefined) {
      if (maxV < bl) throw new NudoThrow(errorTypeAbs("RangeError"));
    } else {
      recordMayThrow({ kind: "RangeError", cause: "ArrayBuffer maxByteLength may be less than byteLength" });
    }
  } else if (oc.k === "undecidable") {
    recordMayThrow({ kind: "RangeError", cause: "ArrayBuffer maxByteLength may be negative or invalid (ToIndex)" });
    recordMayThrow({ kind: "RangeError", cause: "ArrayBuffer maxByteLength may be less than byteLength" });
  }
  const slots: Record<string, { value: Abs }> = {
    byteLength: { value: bl !== undefined ? numLit(bl) : numPrim("path") },
    maxByteLength: {
      value:
        oc.k === "absent"
          ? bl !== undefined ? numLit(bl) : numPrim("path")
          : maxV !== undefined ? numLit(maxV) : numPrim("path"),
    },
    resizable: { value: oc.k === "absent" ? boolLit(false) : oc.k === "undecidable" ? boolPrim() : boolLit(true) },
  };
  return abs({ k: "brand", name: "ArrayBuffer", shape: objOf(slots) }, undefined, undefined, "path");
}

/**
 * Bug 15：new SharedArrayBuffer(length, options?) —— ArrayBuffer 同款 ToIndex
 * 校验 + 槽构造（byteLength/maxByteLength/growable；SAB 是 growable 不是
 * resizable——原型无 resizable 访问器）。Review 补同 makeArrayBufferAbs：
 * maxByteLength 缺省/显式 undefined ≡ 非 growable；present 且
 * maxByteLength < byteLength → RangeError；undecidable → boolean 域不折 false。
 */
export function makeSharedArrayBufferAbs(len: Abs | undefined, options?: Abs | undefined): Abs {
  enforceToIndex(len, "SharedArrayBuffer length");
  const oc = classifyBufferOptions(options);
  const bl = toIndexLiteralValue(len);
  let maxV: number | undefined;
  if (oc.k === "present") {
    enforceToIndex(oc.value, "SharedArrayBuffer maxByteLength");
    maxV = toIndexLiteralValue(oc.value);
    if (maxV !== undefined && bl !== undefined) {
      if (maxV < bl) throw new NudoThrow(errorTypeAbs("RangeError"));
    } else {
      recordMayThrow({ kind: "RangeError", cause: "SharedArrayBuffer maxByteLength may be less than byteLength" });
    }
  } else if (oc.k === "undecidable") {
    recordMayThrow({ kind: "RangeError", cause: "SharedArrayBuffer maxByteLength may be negative or invalid (ToIndex)" });
    recordMayThrow({ kind: "RangeError", cause: "SharedArrayBuffer maxByteLength may be less than byteLength" });
  }
  const slots: Record<string, { value: Abs }> = {
    byteLength: { value: bl !== undefined ? numLit(bl) : numPrim("path") },
    maxByteLength: {
      value:
        oc.k === "absent"
          ? bl !== undefined ? numLit(bl) : numPrim("path")
          : maxV !== undefined ? numLit(maxV) : numPrim("path"),
    },
    growable: { value: oc.k === "absent" ? boolLit(false) : oc.k === "undecidable" ? boolPrim() : boolLit(true) },
  };
  return abs({ k: "brand", name: "SharedArrayBuffer", shape: objOf(slots) }, undefined, undefined, "path");
}

/**
 * Bug 63：new DataView(buffer, byteOffset?, byteLength?) —— buffer 必须
 * ArrayBuffer/SharedArrayBuffer（其余闭形态确定 TypeError，any/unknown/
 * open obj/union → may）；byteOffset/byteLength 过 ToIndex（负 → RangeError）。
 * Bug 35：ctor bounds——byteOffset/byteLength 越出 buffer.byteLength →
 * 定抛 RangeError；组合不可判 → may；byteLength 显式 undefined ≡ 缺省
 * （填满缓冲区）。
 */
export function makeDataViewAbs(
  buf: Abs | undefined,
  off: Abs | undefined,
  len: Abs | undefined,
): Abs {
  if (!buf || isNullishLit(buf)) {
    throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省/nullish ≡ 非 buffer
  }
  const k = buf.shape.k;
  const isBufferBrand =
    k === "brand" && (buf.shape.name === "ArrayBuffer" || buf.shape.name === "SharedArrayBuffer");
  if (isBufferBrand) {
    // 合法 buffer：仅做 ToIndex 校验
  } else if (k === "any" || k === "unknown" || k === "sum" || (k === "obj" && buf.shape.open === true)) {
    recordMayThrow({ kind: "TypeError", cause: "DataView buffer may not be an ArrayBuffer" });
  } else {
    // prim/tuple/arr/fn/eff/闭对象/其余 brand：确定非 ArrayBuffer
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  enforceToIndex(off, "DataView byteOffset");
  enforceToIndex(len, "DataView byteLength");
  // Bug 35：byteLength 显式 undefined ≡ 缺省（原生构造器先判 undefined 再
  // ToIndex——new DataView(buf, 2, undefined).byteLength 是 bufLen−off 而非
  // ToIndex(undefined)=0，node 实测 6；null 仍走 ToIndex → 0）。
  const lenDefaulted = isDefinitelyUndefinedArg(len);
  // Bug 15：byteOffset/byteLength 存入 brand 槽（字面量 ToIndex 折叠、抽象 →
  // number 域）。byteLength 缺省 = buffer 的 byteLength 槽 − byteOffset
  // （buffer 为 ArrayBuffer/SharedArrayBuffer brand 时可读其槽）。
  const offV = off !== undefined ? toIndexLiteralValue(off) : 0;
  const bufBrand = isBufferBrand && buf.shape.k === "brand" ? buf.shape : undefined;
  const bufInner = bufBrand ? bufBrand.shape : undefined;
  const bufLenAbs = bufInner && bufInner.shape.k === "obj" ? getSlot(bufInner.shape.slots, "byteLength")?.value : undefined;
  const bufLenV = bufLenAbs !== undefined ? toIndexLiteralValue(bufLenAbs) : undefined;
  const lenV =
    !lenDefaulted && len !== undefined
      ? toIndexLiteralValue(len)
      : offV !== undefined && bufLenV !== undefined
        ? Math.max(0, bufLenV - offV)
        : undefined;
  // Bug 35 ctor bounds：byteOffset > buffer.byteLength 或（显式长度时）
  // byteOffset + byteLength > buffer.byteLength → 定抛 RangeError（node 实测
  // new DataView(buf8, 9) / (buf8, 4, 8) / (buf8, 100) 均 RangeError）；
  // 组合不可判 → may RangeError。缺省长度臂 = 填满缓冲区恒不越界，仅
  // byteOffset 需判；off=0 的缺省长度（含 any buffer 的 new DataView(x)）
  // 恒安全不记 may。
  if (offV !== undefined && bufLenV !== undefined) {
    if (offV > bufLenV) throw new NudoThrow(errorTypeAbs("RangeError"));
    if (!lenDefaulted) {
      if (lenV !== undefined) {
        if (offV + lenV > bufLenV) throw new NudoThrow(errorTypeAbs("RangeError"));
      } else {
        recordMayThrow({ kind: "RangeError", cause: "DataView byteLength may exceed the buffer bounds" });
      }
    }
  } else if (!(offV === 0 && lenDefaulted)) {
    recordMayThrow({ kind: "RangeError", cause: "DataView byteOffset/byteLength may exceed the buffer bounds" });
  }
  const slots: Record<string, { value: Abs }> = {
    byteOffset: { value: offV !== undefined ? numLit(offV) : numPrim("path") },
    byteLength: { value: lenV !== undefined ? numLit(lenV) : numPrim("path") },
  };
  return abs({ k: "brand", name: "DataView", shape: objOf(slots) }, undefined, undefined, "path");
}

/**
 * Bug 21：new <TA>(length) —— length 实参过 ToIndex（与 makeArrayBufferAbs
 * 同口径：负/±∞/超 2^53-1 → RangeError；symbol/bigint → TypeError；缺省/
 * NaN/截断小数合法）。抽象长度除 may RangeError 外还 may TypeError（any 载体
 * 可能是 Symbol——ToNumber 定抛）。iterable/array-like/对象实参走 ToPrimitive
 * 良性惯例 → 不抛（长度不建模，值域 imprecision 非 wrong-exact）。evalBuiltinNew
 * （Abs 面）与 $new 宿主分支共用本 builder。Bug 38 补：数字 length 形态
 * （单 prim 实参）length 入槽（非可枚举），set 的越界档据此可判。
 * Bug 101 补：buffer 形态（args[0] 是 ArrayBuffer/SharedArrayBuffer brand）
 * 走 makeTypedArrayFromBuffer——镜像 makeDataViewAbs 的 ToIndex + 对齐 +
 * 越界 bounds 检查。Bug 131 补：tuple/arr 源逐项元素转换（.of 同款）。
 * Bug 125 载体：字面量源形态（tuple）length 槽 = elements.length（hole
 * 计入，node 实测 new Uint8Array([1,,3]).length === 3），enumerable:false
 * ——keys/values/entries/gOPN/for-in 精确投影与 freeze/seal 非空定抛的
 * 消费面（methods.ts/enum-entries.ts/iterate.ts）读内层 length 槽。
 */
export function makeTypedArrayAbs(name: string, args: Abs[]): Abs {
  const len = args[0];
  // Bug 101：buffer 形态（new Uint8Array(buf, off?, len?)）——先于 length
  // 路径分派（buffer brand 不是数字长度；原生该形态做 ToIndex/对齐/越界
  // 校验，而非把 args[0] 当长度）
  if (
    len &&
    len.shape.k === "brand" &&
    (len.shape.name === "ArrayBuffer" || len.shape.name === "SharedArrayBuffer")
  ) {
    return makeTypedArrayFromBuffer(name, len, args[1], args[2]);
  }
  // ToIndex 三档复用 enforceToIndex（range/type 定抛 / may → may RangeError）；
  // may 档额外记 may TypeError——any/obj 载体可能取 Symbol（ToNumber 定抛）
  enforceToIndex(len, "typed array length");
  if (classifyToIndex(len).k === "may" && mayCoerceThrowOperand(len)) {
    recordMayThrow({ kind: "TypeError", cause: "typed array length ToNumber may throw (Symbol/BigInt)" });
  }
  // Bug 38：数字 length 形态入槽（new <TA>(8).length === 8——原生非可枚举
  // 自有数据属性；字面量 ToIndex 折叠，抽象数字 → number 域；iterable/
  // buffer 形态长度不建模无槽——buffer 形态例外见上方分派）。%TypedArray%.
  // prototype.set 的越界档（offset + srcLen > targetLen）据此可判。
  // length 槽标 enumerable:false——for-in / Object.keys 枚举视图保持空
  //（原生同）。
  const slots: Record<string, { value: Abs }> = {};
  let lenSlotExactForm = false;
  if (len && len.shape.k === "prim" && args.length === 1) {
    lenSlotExactForm = true;
    const lenV = toIndexLiteralValue(len);
    slots.length = { value: lenV !== undefined ? numLit(lenV) : numPrim("path") };
  } else if (len && len.shape.k === "tuple") {
    // Bug 125 载体：字面量源形态——elements.length 计长（hole 计入）。
    // 只对闭 tuple 精确计长；rest 尾段（open 元组）长度不可判不入槽。
    if (!len.shape.rest) {
      lenSlotExactForm = true;
      slots.length = { value: numLit(len.shape.elements.length) };
    }
  }
  // Bug 131：tuple/arr 源逐项元素转换（与 .of 同款：number 家族拒 symbol/
  // bigint 项、bigint 家族走 enforceTaBigIntItem；抽象项 → may）。此前构造
  // 面完全跳过元素转换 → new Uint8Array([1n]) 的 throws 域 never（假 total，
  // 原生定抛 TypeError）。长度/值域 imprecision 保持既有口径。
  if (len && (len.shape.k === "tuple" || len.shape.k === "arr")) {
    enforceTaItemConversion(name, len);
  }
  const inner = objOf(slots);
  if (lenSlotExactForm) setPropFlags(inner, "length", { enumerable: false });
  return abs({ k: "brand", name, shape: inner }, undefined, undefined, "path");
}

/** TypedArray 家族 BYTES_PER_ELEMENT（Bug 101 bounds/对齐/长度折叠用） */
const TA_BYTES_PER_ELEMENT: Record<string, number> = {
  Int8Array: 1,
  Uint8Array: 1,
  Uint8ClampedArray: 1,
  Int16Array: 2,
  Uint16Array: 2,
  Float16Array: 2,
  Int32Array: 4,
  Uint32Array: 4,
  Float32Array: 4,
  Float64Array: 8,
  BigInt64Array: 8,
  BigUint64Array: 8,
};

/**
 * Bug 101：new <TA>(buffer, byteOffset?, byteLength?) —— 镜像 makeDataViewAbs
 * （Bug 35 ctor bounds）：byteOffset/byteLength 过 ToIndex（负/超界 →
 * RangeError、symbol/bigint → TypeError）；byteOffset 越出 buffer.byteLength
 * 或 % BYTES_PER_ELEMENT !== 0（对齐）或 off + len*BPE > bufLen → 定抛
 * RangeError（node 实测 new Uint8Array(buf8,9) / (buf8,2,100) / Int32(buf8,6)
 * 均 RangeError）；组合不可判 → may RangeError。byteLength 显式 undefined ≡
 * 缺省（填满缓冲区，ToIndex(undefined)=0 同 DataView 口径）。字面量组合折
 * length 槽（显式 lenV / 缺省 floor((bufLen-offV)/BPE)，enumerable:false）。
 */
function makeTypedArrayFromBuffer(
  name: string,
  buf: Abs,
  off: Abs | undefined,
  len: Abs | undefined,
): Abs {
  const bpe = TA_BYTES_PER_ELEMENT[name] ?? 1;
  enforceToIndex(off, `${name} byteOffset`);
  enforceToIndex(len, `${name} length`);
  // byteLength 显式 undefined ≡ 缺省（同 makeDataViewAbs：先判 undefined
  // 再 ToIndex——new Uint8Array(buf, 4, undefined) 长度填满尾段）
  const lenDefaulted = len === undefined || isDefinitelyUndefinedArg(len);
  const offV = off !== undefined ? toIndexLiteralValue(off) : 0;
  const bufBrand = buf.shape.k === "brand" ? buf.shape : undefined;
  const bufInner = bufBrand ? bufBrand.shape : undefined;
  const bufLenAbs =
    bufInner && bufInner.shape.k === "obj"
      ? getSlot(bufInner.shape.slots, "byteLength")?.value
      : undefined;
  const bufLenV = bufLenAbs !== undefined ? toIndexLiteralValue(bufLenAbs) : undefined;
  const lenV = !lenDefaulted && len !== undefined ? toIndexLiteralValue(len) : undefined;
  if (offV !== undefined && bufLenV !== undefined) {
    // 越界先于对齐（node 报错序：Int32(buf8,12) 报越界、Int32(buf8,6) 报对齐）
    if (offV < 0 || offV > bufLenV) throw new NudoThrow(errorTypeAbs("RangeError"));
    if (bpe > 1 && offV % bpe !== 0) throw new NudoThrow(errorTypeAbs("RangeError"));
    if (!lenDefaulted) {
      if (lenV !== undefined) {
        if (lenV < 0 || offV + lenV * bpe > bufLenV) {
          throw new NudoThrow(errorTypeAbs("RangeError"));
        }
      } else {
        recordMayThrow({ kind: "RangeError", cause: `${name} length may exceed the buffer bounds` });
      }
    }
  } else if (!(offV === 0 && lenDefaulted)) {
    recordMayThrow({ kind: "RangeError", cause: `${name} byteOffset/length may exceed the buffer bounds` });
  }
  // length 槽：可折则折（显式 lenV / 缺省尾段 floor；buffer 形态原生非
  // 可枚举自有数据属性，同数字形态口径）
  const slots: Record<string, { value: Abs }> = {};
  const foldLen =
    !lenDefaulted && lenV !== undefined
      ? lenV
      : lenDefaulted && offV !== undefined && bufLenV !== undefined
        ? Math.floor((bufLenV - offV) / bpe)
        : undefined;
  if (foldLen !== undefined) slots.length = { value: numLit(foldLen) };
  const inner = objOf(slots);
  if (slots.length) setPropFlags(inner, "length", { enumerable: false });
  return abs({ k: "brand", name, shape: inner }, undefined, undefined, "path");
}

/**
 * Bug 131：TypedArray 单项元素转换检查（elem 为家族元素域）：
 * number 家族 ToNumber（symbol prim / bigint prim / bigint 字面量 → 定抛
 * TypeError；抽象项（any/obj/fn/brand/sum 载体）→ may TypeError）；
 * bigint 家族 ToBigInt（enforceTaBigIntItem：number/symbol/nullish 字面量
 * 定抛、string 字面量 StringToBigInt、抽象项 may）。
 * hole/undefined 项合法（ToNumber(undefined)=NaN → 0）。
 */
function enforceTaItem(it: Abs, elem: "number" | "bigint"): void {
  if (elem === "bigint") {
    enforceTaBigIntItem(it);
    return;
  }
  if (isSymbolAbs(it) || isBigintPrimAbs(it)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (it.term?.op === "lit" && typeof it.term.value === "bigint") {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (it.term?.op !== "lit" && mayCoerceThrowOperand(it)) {
    recordMayThrow({ kind: "TypeError", cause: "TypedArray item ToNumber may throw (Symbol/BigInt)" });
  }
}

/**
 * Bug 131：TypedArray 构造源逐项元素转换（tuple 逐元素；arr 检查单代表
 * 元素域——bigint prim 域 → 定抛、unknown → may）。.of/.from/构造共用。
 */
function enforceTaItemConversion(name: string, items: Abs): void {
  const elem = typedArrayElementOf(name);
  if (elem === undefined) return;
  if (items.shape.k === "tuple") {
    for (const el of items.shape.elements) enforceTaItem(el, elem);
    return;
  }
  if (items.shape.k === "arr") {
    enforceTaItem(items.shape.element, elem);
  }
}

/** Bug 27：可能取 null/undefined 的抽象实参（ToObject 定抛面）——any/unknown
 * （nullish 字面量挂 k:"unknown"+lit，由 isNullishLit 定抛分支处理）/含
 * 可能 nullish 臂的 sum；prim（非 nullish 值域）/obj/tuple/arr/fn/brand 恒非。 */
export function mayBeNullishOperand(a: Abs | undefined): boolean {
  if (!a || isNullishLit(a)) return false;
  const k = a.shape.k;
  if (k === "any" || k === "unknown") return true;
  if (k === "sum") {
    return (a.shape as { k: "sum"; members: Abs[] }).members.some(mayBeNullishOperand);
  }
  return false;
}

/**
 * Bug 28：set-like `.size` 槽的 ToNumber 分类（GetSetRecord 第一读）。
 * ok = 数值可折（number/string/bool 字面量、null→0、抽象 bool）；
 * nan = NaN 定抛（undefined 字面量、NaN、不可解析 string 字面量）；
 * type = ToNumber 定抛 TypeError（symbol/bigint 形态）；
 * may = 抽象 number/string（可能 NaN）/对象强转路径不可判。
 * 注意 nullish 字面量挂 k:"unknown"+lit（isNullishLit 同口径）：
 * ToNumber(null)=0 合法、ToNumber(undefined)=NaN 定抛。
 */
function classifySetArgSizeNumber(v: Abs): "ok" | "nan" | "type" | "may" {
  if (isNullishLit(v)) {
    // isNullishLit 保证 lit term；此处显式收窄仅为类型（行为不变）
    const t = v.term;
    return t?.op === "lit" && t.value === null ? "ok" : "nan";
  }
  const s = v.shape;
  if (s.k === "prim") {
    if (s.type === "symbol") return "type"; // shape-first：symbol 恒无 lit term
    const r = litValue(v);
    if (!r.ok) {
      // 抽象 prim：bool 恒 0/1；抽象 number 可能 NaN、string 可能不可解析
      return s.type === "boolean" ? "ok" : "may";
    }
    const val = r.value;
    if (typeof val === "bigint") return "type"; // ToNumber(bigint) 原生 TypeError
    return Number.isNaN(Number(val)) ? "nan" : "ok"; // number/string/bool 折算
  }
  return "may"; // obj/tuple/arr/fn/brand/sum/any/unknown：valueOf 路径不可判
}

/**
 * Bug 28：ES2025 Set 方法实参的 GetSetRecord 校验（union/intersection/
 * difference/symmetricDifference/isSubsetOf/isSupersetOf/isDisjointFrom
 * 共用，node 实测）。原生三读：① 非对象 → "argument must be an object"
 * TypeError；② ToNumber(arg.size) 为 NaN 或 ToNumber 抛（symbol/bigint）
 * → TypeError；③ arg.has / arg.keys 非 callable → TypeError。Set/Map
 * brand 天然合法；tuple/arr/闭 obj 无 size 槽 → 定抛（.size 读取
 * undefined → NaN）；闭 obj 带 size 槽 → 逐槽三读（数值 size + 可调用
 * has/keys 全过才放行——duck-typed set-like 原生合法）；open obj/fn/
 * 其他 brand/any/unknown/sum/eff → may（可能有数值 size + 可调用槽，
 * 如自定义 set-like 类实例）。
 */
export function enforceSetMethodArg(a: Abs | undefined, method: string): void {
  const what = `Set.prototype.${method} argument`;
  if (!a || isNullishLit(a) || a.shape.k === "prim") {
    throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省/nullish/prim：非对象
  }
  const k = a.shape.k;
  if (k === "tuple" || k === "arr") {
    throw new NudoThrow(errorTypeAbs("TypeError")); // .size 读取 undefined → NaN
  }
  // Set/Map brand：数值 size + 可调用 has/keys 由构造保证 → 全定合法
  if (isSetAbs(a) || isMapAbs(a)) return;
  if (k === "obj") {
    const s = a.shape as Extract<Abs["shape"], { k: "obj" }>;
    if (s.open === true || s.index) {
      recordMayThrow({
        kind: "TypeError",
        cause: `${what} .size may be NaN / .has .keys may not be callable (open object)`,
      });
      return;
    }
    const sizeSlot = getSlot(s.slots, "size");
    if (!sizeSlot) throw new NudoThrow(errorTypeAbs("TypeError")); // 无 size 槽 → NaN
    if (sizeSlot.optional) {
      recordMayThrow({ kind: "TypeError", cause: `${what} .size may be absent (NaN)` });
    } else {
      const c = classifySetArgSizeNumber(sizeSlot.value);
      if (c === "nan" || c === "type") throw new NudoThrow(errorTypeAbs("TypeError"));
      if (c === "may") {
        recordMayThrow({ kind: "TypeError", cause: `${what} .size may be NaN` });
      }
    }
    for (const name of ["has", "keys"] as const) {
      const slot = getSlot(s.slots, name);
      if (!slot) throw new NudoThrow(errorTypeAbs("TypeError")); // undefined 非 callable
      if (slot.optional) {
        recordMayThrow({ kind: "TypeError", cause: `${what} .${name} may not be callable` });
        continue;
      }
      validateCallableArg(slot.value, `${what} .${name} may not be callable`);
    }
    return;
  }
  // fn/brand(非 Set/Map)/any/unknown/sum/eff：set-like 可能（不可判）→ may
  if (mayCoerceThrowOperand(a) || k === "eff") {
    recordMayThrow({
      kind: "TypeError",
      cause: `${what} .size may be NaN / .has .keys may not be callable`,
    });
  }
}

/**
 * Bug 27：ToBigInt 单项校验（bigint 域 of 的逐项面，与 evalBigIntStatic 的
 * value 档同口径）：bigint/boolean 字面量合法；number/symbol/nullish 字面量
 * 与 symbol prim → 定抛 TypeError；string 字面量 StringToBigInt（非法 →
 * SyntaxError）；prim number → may TypeError、prim string → may SyntaxError；
 * 闭对象无 valueOf/toString 自有槽 → ToPrimitive 恒 "[object Object]" →
 * 定抛 SyntaxError；其余（any/带强转槽 obj/fn/brand/sum/tuple…）→ may。
 */
function enforceTaBigIntItem(it: Abs): void {
  if (it.term?.op === "lit") {
    const v = it.term.value;
    if (typeof v === "bigint" || typeof v === "boolean") return; // ToBigInt 全定
    if (typeof v === "number" || typeof v === "symbol" || v === null || v === undefined) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (typeof v === "string") {
      try {
        BigInt(v);
      } catch {
        throw new NudoThrow(errorTypeAbs("SyntaxError"));
      }
    }
    return; // 其余对象字面量：ToPrimitive 良性惯例 → 下方保守面不重复记
  }
  if (isSymbolAbs(it)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (it.shape.k === "prim") {
    const t = (it.shape as { type?: string }).type;
    if (t === "number") {
      recordMayThrow({ kind: "TypeError", cause: "TypedArray.of item ToBigInt(Number) may throw" });
    } else if (t === "string") {
      recordMayThrow({ kind: "SyntaxError", cause: "TypedArray.of item StringToBigInt may throw" });
    }
    return; // bigint/boolean prim：ToBigInt 全定
  }
  if (
    it.shape.k === "obj" &&
    (it.shape as { open?: boolean }).open !== true &&
    !getSlot((it.shape as { slots: Record<string, { value: Abs }> }).slots, "valueOf") &&
    !getSlot((it.shape as { slots: Record<string, { value: Abs }> }).slots, "toString")
  ) {
    throw new NudoThrow(errorTypeAbs("SyntaxError"));
  }
  recordMayThrow({ kind: "TypeError", cause: "TypedArray.of item ToBigInt may throw (Symbol/Number via ToPrimitive)" });
  recordMayThrow({ kind: "SyntaxError", cause: "TypedArray.of item StringToBigInt may throw" });
}

/**
 * Bug 27：%TypedArray%.from / .of 静态面（12 家族，TYPED_ARRAY_ELEMENT 键）：
 * - from：items 过 ToObject——null/undefined 字面量 → 定抛 TypeError（原生
 *   "object null is not iterable"）；可能 nullish 的抽象 → may TypeError。
 *   非可迭代非 array-like 对象（含 Symbol() 装箱、number prim）原生折空
 *   数组不抛——不做 iterable 校验（与 Map/Set ctor 口径不同）。元素转换
 *   （Bug 131）：无 mapper 检查源项、有 mapper 检查映射结果（原生 mapper
 *   先于转换）——tuple 逐项 / arr 单代表域 / 其余抽象源 may。
 *   mapFn IsCallable 前置校验 + tuple items 的 mapper 逐元素执行（Bug 37，
 *   validateCallableArg/applyCallbackValue 对齐 Array.from 口径）。
 * - of：逐项过元素转换——number 域 ToNumber（symbol/bigint → 定抛
 *   TypeError、抽象 may）；bigint 域 ToBigInt（enforceTaBigIntItem）。
 * 值域：元素域 brand（长度/内容不建模，$idx 走 TYPED_ARRAY_ELEMENT 投影）。
 */
export function evalTypedArrayStatic(
  name: string,
  method: string,
  args: Abs[],
): Abs | undefined {
  const elem = typedArrayElementOf(name);
  if (elem === undefined) return undefined;
  const brand = () => abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "path");
  if (method === "from") {
    const items = args[0];
    if (items && isNullishLit(items)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (items && mayBeNullishOperand(items)) {
      recordMayThrow({ kind: "TypeError", cause: "TypedArray.from items ToObject may throw (null/undefined)" });
    }
    // Bug 37：? GetMethod(mapFn) 前置校验——对齐 Array.from（Bug 49）口径：
    // 原生 mapFn 先于任何元素映射过 IsCallable（空 items 也抛）。缺省/严格
    // undefined → 无 mapper；null/prim/闭 obj/tuple → 确定 TypeError；
    // any/unknown/open obj/含不可调用臂 sum → may TypeError
    validateCallableArg(args[1], "TypedArray.from mapFn may not be callable", {
      undefinedOk: true,
    });
    // 合法 mapper + 字面量元素（tuple items）：逐元素执行——副作用/体内
    // 抛错传播落地（对齐 Array.from 的 mapOne；元素转换与值域不建模，
    // brand 元素域投影同 Bug 27 口径）。抽象 items 元素未知，不执行。
    // isDefinitelyUndefinedArg：严格 undefined 字面量 ≡ 无 mapper（原生同，
    // validateCallableArg 的 undefinedOk 豁免同口径——不重蹈 Array.from
    // 对 undefined-lit mapper 误执行的覆辙）
    const mapFn = args[1];
    const hasMapper = !!mapFn && !isDefinitelyUndefinedArg(mapFn);
    // Bug 131：元素转换（原生 from：mapFn 结果再过 ToNumber/ToBigInt 入
    // 元素）——无 mapper 时检查源项；有 mapper 时检查映射结果（先 mapper
    // 后转换，Uint8Array.from([1n], () => 0) 原生不抛）。tuple 逐项；
    // arr 单代表域；其余抽象源（迭代器/brand）映射结果 unknown → may。
    if (hasMapper && items && items.shape.k === "tuple") {
      const els = (items.shape as { elements: Abs[] }).elements;
      for (let i = 0; i < els.length; i++) {
        enforceTaItem(
          applyCallbackValue(mapFn, [els[i]!, numLit(i)], emptyEnv(), pTrue, defaultLeakBudget),
          elem,
        );
      }
    } else if (items && (items.shape.k === "tuple" || items.shape.k === "arr")) {
      enforceTaItemConversion(name, items);
    } else if (hasMapper && items) {
      enforceTaItem(unknown, elem);
    }
    return brand();
  }
  if (method === "of") {
    for (const it of args) {
      if (elem === "bigint") {
        enforceTaBigIntItem(it);
        continue;
      }
      // number 域：ToNumber——symbol（shape 恒无 lit）/bigint 字面量/抽象
      // bigint prim → 定抛 TypeError；any/obj/fn/brand/sum 抽象项 → may
      if (isSymbolAbs(it) || isBigintPrimAbs(it)) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (it.term?.op === "lit" && typeof it.term.value === "bigint") {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (it.term?.op !== "lit" && mayCoerceThrowOperand(it)) {
        recordMayThrow({ kind: "TypeError", cause: "TypedArray.of item ToNumber may throw (Symbol/BigInt)" });
      }
    }
    return brand();
  }
  return undefined;
}
